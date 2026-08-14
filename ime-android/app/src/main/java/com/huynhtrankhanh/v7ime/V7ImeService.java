package com.huynhtrankhanh.v7ime;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.res.Configuration;
import android.content.pm.ApplicationInfo;
import android.inputmethodservice.InputMethodService;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.SuggestionSpan;
import android.util.Log;
import android.view.KeyCharacterMap;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

public class V7ImeService extends InputMethodService {
    private static final String LOG_TAG = "V7Ime";
    private static final GenerationOwnership<V7ImeService> SERVICE_OWNERSHIP =
            new GenerationOwnership<>();
    private static final int DEFAULT_KEYBOARD_HEIGHT_DP = 160;
    private static final int MIN_KEYBOARD_HEIGHT_DP = 48;

    private final ExecutorService inferenceExecutor = Executors.newSingleThreadExecutor();
    private final KeyboardVisibilityController keyboardVisibilityController =
            new KeyboardVisibilityController();
    private final HardwareKeyActionResolver hardwareKeyActionResolver =
            new HardwareKeyActionResolver();
    private final TelexHardwareKeyPolicy telexHardwareKeyPolicy =
            new TelexHardwareKeyPolicy();
    private final HardwareKeyCapturePolicy hardwareKeyCapturePolicy =
            new HardwareKeyCapturePolicy();
    private final HardwareKeyPressOwnership hardwareKeyPressOwnership =
            new HardwareKeyPressOwnership();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private FrameLayout inputContainer;
    private volatile WebView webView;
    private boolean inferenceWarmupScheduled = false;
    private String preeditText = "";
    private String preeditGrammarSectionsJson = "[]";
    private final TelexPreeditState telexPreeditState = new TelexPreeditState();
    private final Deque<Integer> pendingPreeditLengths = new ArrayDeque<>();
    private final AtomicInteger inputGeneration = new AtomicInteger();
    private final AtomicLong hardwareEventSequence = new AtomicLong();
    private final AtomicInteger barrierSequence = new AtomicInteger();
    private final ConcurrentHashMap<Long, Integer> pendingTelexEvents =
            new ConcurrentHashMap<>();
    private final ConcurrentHashMap<Integer, PendingTelexBarrier> pendingTelexBarriers =
            new ConcurrentHashMap<>();
    // Main-thread-only queue. A Telex barrier owns all later physical events
    // until it has advanced the epoch and applied its editor/mode action.
    private final HardwareEventBarrierQueue<KeyEvent> hardwareEventBarrierQueue =
            new HardwareEventBarrierQueue<>();
    private final GenerationOwnership<WebView> inputViewOwnership =
            new GenerationOwnership<>();
    private int inputViewGeneration;
    private int serviceGeneration;
    private final AtomicInteger latestInferenceRequestId = new AtomicInteger(-1);
    // The native engine is process-wide, so retain its readiness across IME
    // service recreation and keyboard switching. Android can still reclaim
    // the process (and the memory-mapped model) when it is no longer relevant.
    private static volatile String inferenceModelId = "";
    private static volatile String inferenceModelState = "not_loaded";
    private static volatile String inferenceModelError = "";
    private String lastKeyEventSignature = "";
    private boolean enterActionDispatched = false;
    private volatile HardwareInputMode hardwareInputMode =
            HardwareInputMode.V7_PLOVER;
    private volatile boolean telexHasPreedit = false;
    private volatile boolean rawOutlineMode = false;

    private static final class PendingTelexBarrier {
        final int generation;
        final Runnable afterFinalize;

        PendingTelexBarrier(int generation, Runnable afterFinalize) {
            this.generation = generation;
            this.afterFinalize = afterFinalize;
        }
    }
    private final BundledStrippedPloverRuntime.StateListener ploverStateListener =
            paused -> {
                if (SERVICE_OWNERSHIP.isCurrent(this, serviceGeneration)) {
                    evaluateJavascript(
                            "window.handleAndroidPloverPaused"
                                    + " && window.handleAndroidPloverPaused("
                                    + paused
                                    + ")"
                    );
                }
            };
    private final BundledStrippedPloverRuntime.EventListener ploverEventListener =
            event -> {
                if (SERVICE_OWNERSHIP.isCurrent(this, serviceGeneration)) {
                    handlePloverEvent(event);
                }
            };

    @Override
    public void onCreate() {
        super.onCreate();
        serviceGeneration = SERVICE_OWNERSHIP.claim(this);
        rememberKeyboardConfiguration(getResources().getConfiguration());
        BundledStrippedPloverRuntime runtime =
                BundledStrippedPloverRuntime.get(this);
        runtime.addStateListener(ploverStateListener);
        runtime.addEventListener(ploverEventListener);
    }

    @Override
    public View onCreateInputView() {
        if (inputContainer != null) {
            BundledStrippedPloverRuntime.get(this).detachFrom(inputContainer);
        }
        if (webView != null) {
            inputViewOwnership.release(webView, inputViewGeneration);
            webView.stopLoading();
            webView.removeJavascriptInterface("AndroidIme");
            webView.destroy();
        }
        inputContainer = new FrameLayout(this);
        webView = new ImeWebView();
        int viewGeneration = inputViewOwnership.claim(webView);
        inputViewGeneration = viewGeneration;
        inputContainer.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        BundledStrippedPloverRuntime.get(this).attachTo(inputContainer);
        configureWebView(webView, viewGeneration);
        webView.loadUrl("file:///android_asset/ime.html");
        warmInferenceModel();
        return inputContainer;
    }

    @Override
    public void onStartInputView(EditorInfo info, boolean restarting) {
        super.onStartInputView(info, restarting);
        resetHardwareInputState();
        if (inputContainer != null) {
            BundledStrippedPloverRuntime.get(this).attachTo(inputContainer);
        }
    }

    @Override
    public void onFinishInputView(boolean finishingInput) {
        resetHardwareInputState();
        if (inputContainer != null) {
            BundledStrippedPloverRuntime.get(this).detachFrom(inputContainer);
        }
        super.onFinishInputView(finishingInput);
    }

    @Override
    public boolean onEvaluateInputViewShown() {
        super.onEvaluateInputViewShown();
        return true;
    }

    @Override
    public boolean onShowInputRequested(int flags, boolean configChange) {
        boolean platformDecision = super.onShowInputRequested(flags, configChange);
        return platformDecision || keyboardVisibilityController.shouldAllowInputView();
    }

    @Override
    public void onStartInput(EditorInfo attribute, boolean restarting) {
        PloverCommandEditorMode.Mode editorMode =
                PloverCommandEditorMode.fromPrivateImeOptions(
                        attribute == null ? null : attribute.privateImeOptions
                );
        rawOutlineMode = editorMode == PloverCommandEditorMode.Mode.RAW_OUTLINE;
        if (inputContainer != null) {
            BundledStrippedPloverRuntime.get(this).attachTo(inputContainer);
        }
        clearPreeditSession();
        resetHardwareInputState();
        keyboardVisibilityController.startInput();
        super.onStartInput(attribute, restarting);
        publishEditorModeState();
    }

    @Override
    public void onFinishInput() {
        clearPreeditSession();
        rawOutlineMode = false;
        publishEditorModeState();
        resetHardwareInputState();
        keyboardVisibilityController.finishInput();
        super.onFinishInput();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        boolean recoverInputView = keyboardVisibilityController.onConfigurationChanged(
                newConfig.keyboard,
                newConfig.keyboardHidden,
                newConfig.hardKeyboardHidden
        );
        super.onConfigurationChanged(newConfig);
        if (!recoverInputView) {
            return;
        }

        long recoveryGeneration = keyboardVisibilityController.beginRecovery();
        if (recoveryGeneration == KeyboardVisibilityController.NO_RECOVERY) {
            return;
        }
        mainHandler.post(() -> restoreInputView(recoveryGeneration));
    }

    @Override
    public void onUpdateSelection(
            int oldSelStart,
            int oldSelEnd,
            int newSelStart,
            int newSelEnd,
            int candidatesStart,
            int candidatesEnd) {
        super.onUpdateSelection(
                oldSelStart,
                oldSelEnd,
                newSelStart,
                newSelEnd,
                candidatesStart,
                candidatesEnd
        );
        if (preeditText.isEmpty()) {
            pendingPreeditLengths.clear();
            return;
        }

        if (isExpectedPreeditChangedSelection(
                newSelStart,
                newSelEnd,
                candidatesStart,
                candidatesEnd)) {
            return;
        }
        pendingPreeditLengths.clear();

        if (oldSelStart != newSelStart || oldSelEnd != newSelEnd) {
            clearPreeditSession();
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (dispatchHardwareKeyEvent(event)) {
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (dispatchHardwareKeyEvent(event)) {
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    @Override
    public void onDestroy() {
        SERVICE_OWNERSHIP.release(this, serviceGeneration);
        keyboardVisibilityController.finishInput();
        mainHandler.removeCallbacksAndMessages(null);
        inferenceExecutor.shutdownNow();
        BundledStrippedPloverRuntime runtime =
                BundledStrippedPloverRuntime.get(this);
        runtime.removeStateListener(ploverStateListener);
        runtime.removeEventListener(ploverEventListener);
        if (inputContainer != null) {
            BundledStrippedPloverRuntime.get(this).detachFrom(inputContainer);
            inputContainer = null;
        }
        if (webView != null) {
            inputViewOwnership.release(webView, inputViewGeneration);
            webView.stopLoading();
            webView.removeJavascriptInterface("AndroidIme");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void rememberKeyboardConfiguration(Configuration configuration) {
        keyboardVisibilityController.initializeConfiguration(
                configuration.keyboard,
                configuration.keyboardHidden,
                configuration.hardKeyboardHidden
        );
    }

    private void restoreInputView(long recoveryGeneration) {
        if (!keyboardVisibilityController.shouldRunRecovery(recoveryGeneration)) {
            return;
        }
        updateInputViewShown();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            requestShowSelf(InputMethodManager.SHOW_IMPLICIT);
        } else {
            showWindow(true);
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configureWebView(WebView view, int viewGeneration) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        view.setWebViewClient(new WebViewClient());
        view.setWebChromeClient(new WebChromeClient());
        view.addJavascriptInterface(
                new AndroidBridge(view, viewGeneration),
                "AndroidIme"
        );
        view.setFocusable(true);
        view.setFocusableInTouchMode(true);
        view.requestFocus();
        boolean debuggable = (getApplicationInfo().flags
                & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);
    }

    private boolean dispatchHardwareKeyEvent(KeyEvent event) {
        if (hardwareEventBarrierQueue.offerIfActive(new KeyEvent(event))) {
            return true;
        }
        if (PloverCommandFocusState.shouldPassHardwareKeyToActivity(event)) {
            resetHardwareInputState();
            return false;
        }
        HardwareKeyActionResolver.Action hardwareAction =
                hardwareKeyActionResolver.resolve(
                        isV7PloverMode() || rawOutlineMode,
                        event.getKeyCode(),
                        event.getAction(),
                        event.getRepeatCount()
                );
        if (hardwareAction != HardwareKeyActionResolver.Action.PASS_THROUGH) {
            return dispatchModeKeyAction(event, hardwareAction);
        }
        HardwareKeyPressOwnership.Claim keyClaim =
                hardwareKeyPressOwnership.get(event.getKeyCode());
        if (event.getAction() == KeyEvent.ACTION_UP && keyClaim != null) {
            hardwareKeyPressOwnership.release(event.getKeyCode());
            if (keyClaim.owner == HardwareKeyPressOwnership.Owner.EDITOR) {
                return false;
            }
            if (!keyClaim.belongsTo(inputGeneration.get())) return true;
            return dispatchPhysicalKeyToWeb("keyup", event);
        }
        if (event.getAction() == KeyEvent.ACTION_DOWN
                && event.getRepeatCount() > 0 && keyClaim != null) {
            if (keyClaim.owner == HardwareKeyPressOwnership.Owner.EDITOR) {
                return false;
            }
            if (!keyClaim.belongsTo(inputGeneration.get())) return true;
            // Backspace is the one press whose owner may deliberately change:
            // once its Web-owned repeats exhaust raw Telex PREEDIT, later
            // repeats and the eventual key-up must belong to the editor so a
            // continuous hold can keep deleting committed text.
            if (isTelexMode()
                    && event.getKeyCode() == KeyEvent.KEYCODE_DEL
                    && !telexHasPreedit
                    && !hasPendingTelexEvent()
                    && hardwareKeyPressOwnership.transfer(
                            event.getKeyCode(),
                            HardwareKeyPressOwnership.Owner.WEB,
                            HardwareKeyPressOwnership.Owner.EDITOR,
                            inputGeneration.get())) {
                return false;
            }
            return dispatchPhysicalKeyToWeb("keydown", event);
        }
        if (hardwareInputMode == HardwareInputMode.NORMAL && !rawOutlineMode) {
            if (event.getAction() == KeyEvent.ACTION_DOWN
                    && isModifierKey(event.getKeyCode())) {
                hardwareKeyPressOwnership.claim(
                        event.getKeyCode(),
                        HardwareKeyPressOwnership.Owner.EDITOR,
                        inputGeneration.get());
            }
            return false;
        }
        boolean captureModifiedPrintable =
                hardwareKeyCapturePolicy.capturesModifiedPrintable(
                        isTelexMode(),
                        event.getUnicodeChar(),
                        event.isAltPressed(),
                        event.isMetaPressed());
        if (isOsPassthroughModifierKey(event.getKeyCode())
                || (!captureModifiedPrintable
                        && (event.isCtrlPressed()
                                || event.isAltPressed()
                                || event.isMetaPressed()))) {
            if (event.getAction() == KeyEvent.ACTION_DOWN
                    && isModifierKey(event.getKeyCode())) {
                hardwareKeyPressOwnership.claim(
                        event.getKeyCode(),
                        HardwareKeyPressOwnership.Owner.EDITOR,
                        inputGeneration.get());
            }
            return false;
        }
        TelexHardwareKeyPolicy.Route telexRoute = isTelexMode()
                ? telexHardwareKeyPolicy.resolve(
                        event.getKeyCode(),
                        telexHasPreedit || hasPendingTelexEvent())
                : TelexHardwareKeyPolicy.Route.WEB_PREEDIT;
        if (telexRoute == TelexHardwareKeyPolicy.Route.EDITOR) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                hardwareKeyPressOwnership.claim(
                        event.getKeyCode(),
                        HardwareKeyPressOwnership.Owner.EDITOR,
                        inputGeneration.get());
            }
            return false;
        }
        if (isEnterKey(event.getKeyCode())) {
            if (isTelexMode()
                    && event.getAction() == KeyEvent.ACTION_DOWN
                    && event.getRepeatCount() == 0) {
                KeyEvent enterEvent = new KeyEvent(event);
                dispatchTelexBarrier(() -> dispatchEnterKey(enterEvent));
                return true;
            }
            return dispatchEnterKey(event);
        }
        String action = event.getAction() == KeyEvent.ACTION_UP
                ? "keyup"
                : "keydown";
        boolean captured = dispatchPhysicalKeyToWeb(action, event);
        if (captured && event.getAction() == KeyEvent.ACTION_DOWN) {
            hardwareKeyPressOwnership.claim(
                    event.getKeyCode(),
                    HardwareKeyPressOwnership.Owner.WEB,
                    inputGeneration.get());
        }
        return captured;
    }

    private boolean dispatchModeKeyAction(
            KeyEvent event,
            HardwareKeyActionResolver.Action action) {
        String signature = "mode-key:"
                + event.getAction() + ":"
                + event.getKeyCode() + ":"
                + event.getEventTime();
        if (signature.equals(lastKeyEventSignature)) {
            return true;
        }
        lastKeyEventSignature = signature;

        if (action == HardwareKeyActionResolver.Action.TOGGLE_STENO) {
            if (rawOutlineMode
                    && !PloverCommandFocusState.isNativeControlFocused()) {
                return true;
            }
            HardwareInputMode.Transition transition =
                    currentHardwareInputMode().onControlShift();
            hardwareKeyPressOwnership.remove(event.getKeyCode());
            if (isTelexMode()) {
                dispatchTelexBarrier(() -> {
                    applyHardwareInputMode(transition.mode);
                    publishStenoModeState();
                });
            } else {
                applyHardwareInputTransition(transition);
                publishStenoModeState();
            }
            return false;
        } else if (action == HardwareKeyActionResolver.Action.TOGGLE_TELEX) {
            if (rawOutlineMode) return true;
            HardwareInputMode.Transition transition =
                    currentHardwareInputMode().onControlTab();
            if (isTelexMode()) {
                dispatchTelexBarrier(() -> {
                    applyHardwareInputMode(transition.mode);
                    publishStenoModeState();
                });
            } else {
                applyHardwareInputTransition(transition);
                publishStenoModeState();
            }
            return true;
        } else if (action == HardwareKeyActionResolver.Action.FINISH_PREEDIT) {
            finishCurrentPreedit();
        } else if (action
                == HardwareKeyActionResolver.Action.FINISH_PREEDIT_AND_INSERT_SPACE) {
            finishCurrentPreedit();
            InputConnection connection = getCurrentInputConnection();
            if (connection != null) {
                connection.commitText(" ", 1);
            }
        }
        return true;
    }

    private HardwareInputMode currentHardwareInputMode() {
        return hardwareInputMode;
    }

    private void applyHardwareInputMode(HardwareInputMode mode) {
        hardwareInputMode = mode;
    }

    private boolean isV7PloverMode() {
        return hardwareInputMode == HardwareInputMode.V7_PLOVER;
    }

    private boolean isTelexMode() {
        return hardwareInputMode == HardwareInputMode.TELEX;
    }

    private void applyHardwareInputTransition(
            HardwareInputMode.Transition transition) {
        if (transition.finishPreedit) finishCurrentPreedit();
        applyHardwareInputMode(transition.mode);
    }

    private boolean dispatchEnterKey(KeyEvent event) {
        String signature = "editor-enter:"
                + event.getAction() + ":"
                + event.getKeyCode() + ":"
                + event.getEventTime();
        if (signature.equals(lastKeyEventSignature)) {
            return true;
        }
        lastKeyEventSignature = signature;

        InputConnection connection = getCurrentInputConnection();
        if (connection == null) {
            return true;
        }

        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            EditorInfo editorInfo = getCurrentInputEditorInfo();
            int editorAction = editorInfo == null
                    ? 0
                    : EditorActionResolver.resolve(
                            editorInfo.imeOptions,
                            editorInfo.actionId
                    );
            if (editorAction != 0) {
                enterActionDispatched = true;
                if (event.getRepeatCount() == 0) {
                    clearPreeditSession();
                    connection.performEditorAction(editorAction);
                }
                return true;
            }
            enterActionDispatched = false;
            connection.sendKeyEvent(event);
            return true;
        }

        if (event.getAction() == KeyEvent.ACTION_UP) {
            if (enterActionDispatched) {
                enterActionDispatched = false;
            } else {
                connection.sendKeyEvent(event);
            }
            return true;
        }
        return true;
    }

    private boolean isEnterKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_ENTER
                || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER;
    }

    private boolean isModifierKey(int keyCode) {
        return isModeToggleModifierKey(keyCode)
                || keyCode == KeyEvent.KEYCODE_ALT_LEFT
                || keyCode == KeyEvent.KEYCODE_ALT_RIGHT
                || keyCode == KeyEvent.KEYCODE_META_LEFT
                || keyCode == KeyEvent.KEYCODE_META_RIGHT;
    }

    private boolean isModeToggleModifierKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_CTRL_LEFT
                || keyCode == KeyEvent.KEYCODE_CTRL_RIGHT
                || keyCode == KeyEvent.KEYCODE_SHIFT_LEFT
                || keyCode == KeyEvent.KEYCODE_SHIFT_RIGHT;
    }

    private boolean isOsPassthroughModifierKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_CTRL_LEFT
                || keyCode == KeyEvent.KEYCODE_CTRL_RIGHT
                || keyCode == KeyEvent.KEYCODE_ALT_LEFT
                || keyCode == KeyEvent.KEYCODE_ALT_RIGHT
                || keyCode == KeyEvent.KEYCODE_META_LEFT
                || keyCode == KeyEvent.KEYCODE_META_RIGHT;
    }

    private boolean dispatchPhysicalKeyToWeb(String action, KeyEvent event) {
        if (webView == null || !hardwareKeyCapturePolicy.isCaptured(
                event.getKeyCode(),
                event.getUnicodeChar(),
                isTelexMode())) {
            return false;
        }

        String signature = action + ":" + event.getKeyCode() + ":" + event.getEventTime();
        if (signature.equals(lastKeyEventSignature)) {
            return true;
        }
        lastKeyEventSignature = signature;

        String key = getJavascriptKey(event);
        String code = getJavascriptCode(event.getKeyCode());
        long sequence = hardwareEventSequence.incrementAndGet();
        int generation = inputGeneration.get();
        if (isTelexMode() && "keydown".equals(action)) {
            pendingTelexEvents.put(sequence, generation);
        }
        String script = "window.handleAndroidKeyEvent && window.handleAndroidKeyEvent("
                + JSONObject.quote(action) + ","
                + JSONObject.quote(key) + ","
                + JSONObject.quote(code) + ","
                + (event.getRepeatCount() > 0) + ","
                + event.isShiftPressed() + ","
                + event.isCtrlPressed() + ","
                + event.isAltPressed() + ","
                + event.isMetaPressed()
                + ","
                + event.isCapsLockOn()
                + ","
                + generation
                + ","
                + sequence
                + ")";
        webView.evaluateJavascript(script, null);
        return true;
    }

    private boolean hasPendingTelexEvent() {
        int generation = inputGeneration.get();
        return pendingTelexEvents.containsValue(generation);
    }

    private void dispatchTelexBarrier(Runnable afterFinalize) {
        WebView target = webView;
        if (target == null) {
            finishCurrentPreedit();
            afterFinalize.run();
            return;
        }
        int id = barrierSequence.incrementAndGet();
        int generation = inputGeneration.get();
        hardwareEventBarrierQueue.begin(id);
        pendingTelexBarriers.put(id, new PendingTelexBarrier(generation, afterFinalize));
        target.evaluateJavascript(
                "window.handleAndroidTelexBarrier"
                        + " && window.handleAndroidTelexBarrier("
                        + id + "," + generation + ")",
                null);
    }

    private void finishTelexBarrier(int barrierId, boolean replayQueuedEvents) {
        for (KeyEvent queued : hardwareEventBarrierQueue.finish(
                barrierId, replayQueuedEvents)) {
            if (!dispatchHardwareKeyEvent(queued)) {
                InputConnection connection = getCurrentInputConnection();
                if (connection != null) connection.sendKeyEvent(queued);
            }
        }
    }

    private String getJavascriptKey(KeyEvent event) {
        switch (event.getKeyCode()) {
            case KeyEvent.KEYCODE_SPACE:
                return " ";
            case KeyEvent.KEYCODE_TAB:
                return "Tab";
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                return "Enter";
            case KeyEvent.KEYCODE_DEL:
                return "Backspace";
            case KeyEvent.KEYCODE_SHIFT_LEFT:
            case KeyEvent.KEYCODE_SHIFT_RIGHT:
                return "Shift";
            case KeyEvent.KEYCODE_CTRL_LEFT:
            case KeyEvent.KEYCODE_CTRL_RIGHT:
                return "Control";
            case KeyEvent.KEYCODE_ALT_LEFT:
            case KeyEvent.KEYCODE_ALT_RIGHT:
                return "Alt";
            case KeyEvent.KEYCODE_META_LEFT:
            case KeyEvent.KEYCODE_META_RIGHT:
                return "Meta";
            case KeyEvent.KEYCODE_CAPS_LOCK:
                return "CapsLock";
            case KeyEvent.KEYCODE_ESCAPE:
                return "Escape";
            default:
                int unicode = event.getUnicodeChar();
                if ((unicode & KeyCharacterMap.COMBINING_ACCENT) != 0) {
                    unicode &= KeyCharacterMap.COMBINING_ACCENT_MASK;
                }
                if (unicode != 0 && Character.isValidCodePoint(unicode)) {
                    return new String(Character.toChars(unicode));
                }
                return "";
        }
    }

    private String getJavascriptCode(int keyCode) {
        if (keyCode >= KeyEvent.KEYCODE_A && keyCode <= KeyEvent.KEYCODE_Z) {
            return "Key" + (char) ('A' + keyCode - KeyEvent.KEYCODE_A);
        }
        if (keyCode >= KeyEvent.KEYCODE_0 && keyCode <= KeyEvent.KEYCODE_9) {
            return "Digit" + (keyCode - KeyEvent.KEYCODE_0);
        }
        switch (keyCode) {
            case KeyEvent.KEYCODE_SEMICOLON:
                return "Semicolon";
            case KeyEvent.KEYCODE_SPACE:
                return "Space";
            case KeyEvent.KEYCODE_TAB:
                return "Tab";
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                return "Enter";
            case KeyEvent.KEYCODE_DEL:
                return "Backspace";
            case KeyEvent.KEYCODE_SHIFT_LEFT:
                return "ShiftLeft";
            case KeyEvent.KEYCODE_SHIFT_RIGHT:
                return "ShiftRight";
            case KeyEvent.KEYCODE_CTRL_LEFT:
                return "ControlLeft";
            case KeyEvent.KEYCODE_CTRL_RIGHT:
                return "ControlRight";
            case KeyEvent.KEYCODE_ALT_LEFT:
                return "AltLeft";
            case KeyEvent.KEYCODE_ALT_RIGHT:
                return "AltRight";
            case KeyEvent.KEYCODE_META_LEFT:
                return "MetaLeft";
            case KeyEvent.KEYCODE_META_RIGHT:
                return "MetaRight";
            case KeyEvent.KEYCODE_CAPS_LOCK:
                return "CapsLock";
            case KeyEvent.KEYCODE_ESCAPE:
                return "Escape";
            default:
                return "";
        }
    }

    private boolean isExpectedPreeditChangedSelection(
            int newSelStart,
            int newSelEnd,
            int candidatesStart,
            int candidatesEnd) {
        if (pendingPreeditLengths.isEmpty()
                || newSelStart != newSelEnd) {
            return false;
        }

        if (candidatesStart >= 0 && candidatesEnd >= candidatesStart) {
            if (newSelStart != candidatesEnd) {
                return false;
            }
            int composingLength = candidatesEnd - candidatesStart;
            while (!pendingPreeditLengths.isEmpty()) {
                int expectedLength = pendingPreeditLengths.removeFirst();
                if (expectedLength == composingLength) {
                    return true;
                }
            }
            return false;
        }

        // Some editors omit composing bounds from the selection callback
        // generated by setComposingText. A pending collapsed callback is still
        // our update and must not clear the WebUI buffer.
        pendingPreeditLengths.removeFirst();
        return true;
    }

    private void applyPreeditText(
            String nextText,
            String nextGrammarSectionsJson) {
        String normalized = nextText == null ? "" : nextText;
        String normalizedGrammarSections = nextGrammarSectionsJson == null
                ? "[]"
                : nextGrammarSectionsJson;
        if (normalized.equals(preeditText)
                && normalizedGrammarSections.equals(preeditGrammarSectionsJson)) {
            return;
        }

        preeditText = normalized;
        preeditGrammarSectionsJson = normalizedGrammarSections;
        InputConnection connection = getCurrentInputConnection();
        if (connection == null) {
            pendingPreeditLengths.clear();
            return;
        }

        if (preeditText.isEmpty()) {
            connection.setComposingText("", 1);
            connection.finishComposingText();
            pendingPreeditLengths.clear();
        } else {
            pendingPreeditLengths.addLast(preeditText.length());
            connection.setComposingText(buildStyledPreedit(), 1);
        }
    }

    private CharSequence buildStyledPreedit() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return preeditText;
        }

        SpannableString styled = new SpannableString(preeditText);
        try {
            JSONArray sections = new JSONArray(preeditGrammarSectionsJson);
            for (int index = 0; index < Math.min(2, sections.length()); index++) {
                JSONObject section = sections.optJSONObject(index);
                if (section == null) {
                    continue;
                }
                int start = Math.max(0, section.optInt("start", -1));
                int end = Math.min(
                        preeditText.length(),
                        section.optInt("end", -1)
                );
                if (start >= end) {
                    continue;
                }

                JSONArray suggestionsJson = section.optJSONArray("suggestions");
                int suggestionCount = suggestionsJson == null
                        ? 0
                        : Math.min(
                                SuggestionSpan.SUGGESTIONS_MAX_SIZE,
                                suggestionsJson.length()
                        );
                String[] suggestions = new String[suggestionCount];
                for (int suggestionIndex = 0;
                        suggestionIndex < suggestionCount;
                        suggestionIndex++) {
                    suggestions[suggestionIndex] = suggestionsJson.optString(
                            suggestionIndex,
                            ""
                    );
                }
                styled.setSpan(
                        new SuggestionSpan(
                                this,
                                suggestions,
                                SuggestionSpan.FLAG_GRAMMAR_ERROR
                        ),
                        start,
                        end,
                        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
                );
            }
        } catch (Exception ignored) {
            return preeditText;
        }
        return styled;
    }

    private void clearPreeditSession() {
        finishCurrentPreedit();
    }

    /**
     * Commits the editor's current composing text, then clears only V7's
     * in-memory/WebUI session. Calling finishComposingText (instead of
     * setComposingText with an empty value) deliberately preserves the text
     * that the user already sees in the editor.
     */
    private void finishCurrentPreedit() {
        int generation = inputGeneration.getAndIncrement();
        latestInferenceRequestId.set(-1);
        String latestTelexText = takePendingTelexText(generation);
        boolean hadPreedit = !preeditText.isEmpty();
        preeditText = "";
        telexHasPreedit = false;
        pendingTelexEvents.entrySet().removeIf(
                entry -> entry.getValue() <= generation);
        preeditGrammarSectionsJson = "[]";
        pendingPreeditLengths.clear();
        if (hadPreedit || latestTelexText != null) {
            InputConnection connection = getCurrentInputConnection();
            if (connection != null) {
                if (latestTelexText != null) {
                    connection.setComposingText(latestTelexText, 1);
                }
                connection.finishComposingText();
            }
        }
        evaluateJavascript(
                "window.clearPreeditFromAndroid && window.clearPreeditFromAndroid("
                        + inputGeneration.get()
                        + ")"
        );
    }

    private String takePendingTelexText(int generation) {
        return telexPreeditState.take(generation);
    }

    private void rememberPendingTelexText(String text, int generation) {
        telexPreeditState.remember(text, generation);
    }

    private void publishStenoModeState() {
        HardwareInputMode mode = hardwareInputMode;
        evaluateJavascript(
                "window.handleAndroidStenoModeChanged"
                        + " && window.handleAndroidStenoModeChanged("
                        + (mode == HardwareInputMode.V7_PLOVER)
                        + ","
                        + (mode == HardwareInputMode.TELEX)
                        + ","
                        + inputGeneration.get()
                        + ")"
        );
    }

    private void publishEditorModeState() {
        evaluateJavascript(
                "window.handleAndroidEditorModeChanged"
                        + " && window.handleAndroidEditorModeChanged("
                        + rawOutlineMode
                        + ","
                        + false
                        + ")"
        );
    }

    private void undoCommittedRawOutlineStroke() {
        if (!rawOutlineMode) {
            return;
        }
        InputConnection connection = getCurrentInputConnection();
        if (connection == null) {
            return;
        }
        CharSequence textBeforeCursor = connection.getTextBeforeCursor(
                RawOutlineEditor.MAX_CONTEXT_LENGTH,
                0
        );
        int deletionLength = RawOutlineEditor.deletionLength(textBeforeCursor);
        if (deletionLength > 0) {
            connection.deleteSurroundingText(deletionLength, 0);
        }
    }

    private void handlePloverEvent(String eventBody) {
        try {
            JSONObject event = new JSONObject(eventBody);
            PloverCommandEvent commandEvent = new PloverCommandEvent(
                    PloverCommandEvent.typeFor(
                            event.optString("event", ""),
                            event.optString("command", "")
                    ),
                    event.optString("argument", "")
            );
            Intent intent;
            switch (commandEvent.type) {
                case LOOKUP:
                    intent = new Intent(
                            this,
                            PloverCommandActivity.class
                    ).setAction(PloverCommandActivity.ACTION_LOOKUP);
                    intent.addFlags(PloverCommandLaunchPolicy.FLAGS);
                    break;
                case ADD_TRANSLATION:
                    intent = new Intent(
                            this,
                            PloverCommandActivity.class
                    ).setAction(PloverCommandActivity.ACTION_ADD_TRANSLATION);
                    intent.addFlags(PloverCommandLaunchPolicy.FLAGS);
                    break;
                case CONFIGURE:
                    intent = new Intent(this, SettingsActivity.class);
                    break;
                default:
                    Log.w(LOG_TAG, "Ignoring unknown Plover event: " + eventBody);
                    return;
            }
            if (!commandEvent.argument.isEmpty()) {
                intent.putExtra(
                        PloverCommandActivity.EXTRA_ARGUMENT,
                        commandEvent.argument
                );
            }
            if (commandEvent.type == PloverCommandEvent.Type.CONFIGURE) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            }
            startActivity(intent);
        } catch (Exception error) {
            Log.e(LOG_TAG, "Unable to handle Plover event", error);
        }
    }

    private void evaluateJavascript(String script) {
        WebView target = webView;
        int targetGeneration = inputViewGeneration;
        if (target == null) {
            return;
        }
        target.post(() -> {
            if (inputViewOwnership.isCurrent(target, targetGeneration)) {
                target.evaluateJavascript(script, null);
            }
        });
    }

    private void resetHardwareKeyboardStateInWebView() {
        WebView target = webView;
        int targetGeneration = inputViewGeneration;
        if (target == null) {
            return;
        }
        Runnable reset = () -> {
            if (inputViewOwnership.isCurrent(target, targetGeneration)) {
                target.evaluateJavascript(
                        "window.resetHardwareKeyboardStateFromAndroid"
                                + " && window.resetHardwareKeyboardStateFromAndroid()",
                        null
                );
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) {
            reset.run();
        } else {
            target.post(reset);
        }
    }

    private void resetHardwareInputState() {
        hardwareKeyActionResolver.reset();
        hardwareKeyPressOwnership.invalidate();
        resetHardwareKeyboardStateInWebView();
    }

    private InferenceResult runNativeInference(String requestBody, int requestId) {
        latestInferenceRequestId.set(requestId);
        String modelId = getCurrentInferenceModelId();
        if (modelId.isEmpty()) {
            publishInferenceModelState("missing", modelId);
        } else if (!"ready".equals(getInferenceModelState())) {
            publishInferenceModelState("loading", modelId);
        }

        String responseBody = "";
        String errorMessage = "";
        try {
            responseBody = NativeInference.infer(this, requestBody);
        } catch (Exception | LinkageError error) {
            errorMessage = error.getMessage() == null
                    ? error.getClass().getSimpleName()
                    : error.getMessage();
            Log.e(LOG_TAG, "Local inference failed", error);
        }

        if (latestInferenceRequestId.get() == requestId) {
            inferenceModelError = errorMessage;
            publishInferenceModelState(
                    errorMessage.isEmpty()
                            ? "ready"
                            : modelId.isEmpty() ? "missing" : "error",
                    modelId
            );
        }
        return new InferenceResult(
                errorMessage.isEmpty() ? 200 : 0,
                responseBody,
                errorMessage
        );
    }

    private String requestInferenceSync(String requestBody, int requestId) {
        InferenceResult result = runNativeInference(requestBody, requestId);
        JSONObject response = new JSONObject();
        try {
            response.put("statusCode", result.statusCode);
            response.put("responseBody", result.responseBody);
            response.put("errorMessage", result.errorMessage);
        } catch (JSONException error) {
            Log.e(LOG_TAG, "Unable to encode local inference response", error);
        }
        return response.toString();
    }

    private void warmInferenceModel() {
        String modelId = getCurrentInferenceModelId();
        if (modelId.isEmpty()) {
            publishInferenceModelState("missing", modelId);
            return;
        }
        if ("ready".equals(getInferenceModelState())
                || inferenceWarmupScheduled) {
            return;
        }

        inferenceWarmupScheduled = true;
        publishInferenceModelState("loading", modelId);
        inferenceExecutor.execute(() -> {
            String errorMessage = "";
            try {
                NativeInference.infer(this, "{\"islands\":[]}");
            } catch (Exception | LinkageError error) {
                errorMessage = error.getMessage() == null
                        ? error.getClass().getSimpleName()
                        : error.getMessage();
                Log.e(LOG_TAG, "Local inference model warm-up failed", error);
            } finally {
                inferenceWarmupScheduled = false;
            }

            if (modelId.equals(getCurrentInferenceModelId())) {
                inferenceModelError = errorMessage;
                publishInferenceModelState(
                        errorMessage.isEmpty() ? "ready" : "error",
                        modelId
                );
                if (!errorMessage.isEmpty()) {
                    String script = "window.handleAndroidInferenceWarmupError"
                            + " && window.handleAndroidInferenceWarmupError("
                            + JSONObject.quote(errorMessage)
                            + ")";
                    evaluateJavascript(script);
                }
            }
        });
    }

    private String getCurrentInferenceModelId() {
        Uri modelUri = ImePreferences.getModelUri(this);
        return modelUri == null ? "" : modelUri.toString();
    }

    private String getInferenceModelState() {
        String currentModelId = getCurrentInferenceModelId();
        if (currentModelId.isEmpty()) {
            return "missing";
        }
        return currentModelId.equals(inferenceModelId)
                ? inferenceModelState
                : "not_loaded";
    }

    private String getInferenceModelError() {
        String currentModelId = getCurrentInferenceModelId();
        return currentModelId.equals(inferenceModelId)
                ? inferenceModelError
                : "";
    }

    private void publishInferenceModelState(String state, String modelId) {
        inferenceModelId = modelId;
        inferenceModelState = state;
        if (!"error".equals(state)) {
            inferenceModelError = "";
        }
        evaluateJavascript(
                "window.handleAndroidInferenceState"
                        + " && window.handleAndroidInferenceState("
                        + JSONObject.quote(state)
                        + ")"
        );
    }

    private void requestPlover(String requestBody, int requestId) {
        BundledStrippedPloverRuntime runtime = BundledStrippedPloverRuntime.get(this);
        if (runtime.isPaused()) {
            try {
                JSONObject request = new JSONObject(requestBody);
                JSONObject result = new JSONObject();
                if ("translate".equals(request.optString("method"))) {
                    result.put("output", new JSONArray());
                }
                JSONObject response = new JSONObject()
                        .put("id", request.opt("id"))
                        .put("result", result);
                String script = "window.handleAndroidPloverResponse"
                        + " && window.handleAndroidPloverResponse("
                        + requestId + ","
                        + JSONObject.quote(response.toString()) + ",\"\")";
                evaluateJavascript(script);
            } catch (JSONException error) {
                Log.e(LOG_TAG, "Unable to ignore paused Plover request", error);
            }
            return;
        }
        runtime.request(
                requestBody,
                (responseBody, errorMessage) -> {
                    String script = "window.handleAndroidPloverResponse"
                            + " && window.handleAndroidPloverResponse("
                            + requestId + ","
                            + JSONObject.quote(responseBody) + ","
                            + JSONObject.quote(errorMessage)
                            + ")";
                    evaluateJavascript(script);
                }
        );
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }

    private class ImeWebView extends WebView {
        ImeWebView() {
            super(V7ImeService.this);
        }

        @Override
        public boolean dispatchKeyEvent(KeyEvent event) {
            if (event.getAction() != KeyEvent.ACTION_DOWN
                    && event.getAction() != KeyEvent.ACTION_UP) {
                return super.dispatchKeyEvent(event);
            }
            if (dispatchHardwareKeyEvent(event)) {
                return true;
            }
            if (!isV7PloverMode()) {
                return false;
            }
            return super.dispatchKeyEvent(event);
        }
    }

    private static class InferenceResult {
        final int statusCode;
        final String responseBody;
        final String errorMessage;

        InferenceResult(int statusCode, String responseBody, String errorMessage) {
            this.statusCode = statusCode;
            this.responseBody = responseBody;
            this.errorMessage = errorMessage;
        }
    }

    private class AndroidBridge {
        private final WebView owner;
        private final int ownerGeneration;

        AndroidBridge(WebView owner, int ownerGeneration) {
            this.owner = owner;
            this.ownerGeneration = ownerGeneration;
        }

        private boolean isCurrentInputView() {
            return owner == webView
                    && inputViewOwnership.isCurrent(owner, ownerGeneration);
        }

        @JavascriptInterface
        public boolean hasPloverConfiguration() {
            return true;
        }

        @JavascriptInterface
        public boolean isPloverPaused() {
            return BundledStrippedPloverRuntime.get(
                    V7ImeService.this
            ).isPaused();
        }

        @JavascriptInterface
        public String getInferenceModelState() {
            return V7ImeService.this.getInferenceModelState();
        }

        @JavascriptInterface
        public String getInferenceModelError() {
            return V7ImeService.this.getInferenceModelError();
        }

        @JavascriptInterface
        public boolean isStenoModeEnabled() {
            return isV7PloverMode();
        }

        @JavascriptInterface
        public boolean isTelexModeEnabled() {
            return isTelexMode();
        }

        @JavascriptInterface
        public int getInputGeneration() {
            return inputGeneration.get();
        }

        @JavascriptInterface
        public boolean isRawOutlineMode() {
            return rawOutlineMode;
        }

        @JavascriptInterface
        public boolean isPlainTextMode() {
            return false;
        }

        @JavascriptInterface
        public void setKeyboardHeight(final int heightDp) {
            if (!isCurrentInputView()) {
                return;
            }
            owner.post(() -> {
                if (!isCurrentInputView() || inputContainer == null) {
                    return;
                }
                int requestedHeightPx = Math.max(
                        dpToPx(MIN_KEYBOARD_HEIGHT_DP),
                        dpToPx(heightDp)
                );
                int safeMaximumHeightPx = Math.max(
                        dpToPx(DEFAULT_KEYBOARD_HEIGHT_DP),
                        Math.round(
                                getResources().getDisplayMetrics().heightPixels
                                        * 0.7f
                        )
                );
                int targetHeightPx = Math.min(
                        requestedHeightPx,
                        safeMaximumHeightPx
                );
                ViewGroup.LayoutParams containerParams =
                        inputContainer.getLayoutParams();
                if (containerParams != null) {
                    containerParams.height = targetHeightPx;
                    inputContainer.setLayoutParams(containerParams);
                }
                inputContainer.setMinimumHeight(targetHeightPx);
                ViewGroup.LayoutParams webViewParams = owner.getLayoutParams();
                if (webViewParams != null
                        && webViewParams.height
                                != FrameLayout.LayoutParams.MATCH_PARENT) {
                    webViewParams.height =
                            FrameLayout.LayoutParams.MATCH_PARENT;
                    owner.setLayoutParams(webViewParams);
                }
                owner.requestLayout();
                inputContainer.requestLayout();
                if (getWindow() != null
                        && getWindow().getWindow() != null) {
                    getWindow().getWindow().getDecorView().requestLayout();
                }
            });
        }

        @JavascriptInterface
        public void setPreeditText(
                String text,
                String grammarSectionsJson,
                int eventGeneration) {
            if (!isCurrentInputView()
                    || eventGeneration != inputGeneration.get()) {
                return;
            }
            String normalized = text == null ? "" : text;
            int generation = eventGeneration;
            if (isTelexMode()) {
                telexHasPreedit = !normalized.isEmpty();
                rememberPendingTelexText(normalized, generation);
            }
            String normalizedGrammarSections = grammarSectionsJson == null
                    ? "[]"
                    : grammarSectionsJson;
            owner.post(() -> {
                if (isCurrentInputView()
                        && generation == inputGeneration.get()) {
                    applyPreeditText(
                            normalized,
                            normalizedGrammarSections
                    );
                }
            });
        }

        @JavascriptInterface
        public void acknowledgeHardwareEvent(long sequence, int eventGeneration) {
            pendingTelexEvents.remove(sequence, eventGeneration);
        }

        @JavascriptInterface
        public int completeTelexBarrier(
                int barrierId, String expectedText, int eventGeneration) {
            PendingTelexBarrier barrier = pendingTelexBarriers.remove(barrierId);
            if (barrier == null
                    || barrier.generation != eventGeneration
                    || !isCurrentInputView()
                    || !isTelexMode()
                    || !inputGeneration.compareAndSet(
                            eventGeneration, eventGeneration + 1)) {
                owner.post(() -> finishTelexBarrier(barrierId, false));
                return inputGeneration.get();
            }
            String finalText = expectedText == null ? "" : expectedText;
            telexHasPreedit = false;
            pendingTelexEvents.entrySet().removeIf(
                    entry -> entry.getValue() <= eventGeneration);
            owner.post(() -> {
                if (!isCurrentInputView()
                        || inputGeneration.get() != eventGeneration + 1) {
                    finishTelexBarrier(barrierId, false);
                    return;
                }
                InputConnection connection = getCurrentInputConnection();
                if (connection != null) {
                    // Empty is meaningful: replace any older composing range
                    // that may still be visible because its asynchronous empty
                    // PREEDIT update lost the generation race.
                    connection.setComposingText(finalText, 1);
                    connection.finishComposingText();
                }
                preeditText = "";
                preeditGrammarSectionsJson = "[]";
                pendingPreeditLengths.clear();
                takePendingTelexText(eventGeneration);
                evaluateJavascript(
                        "window.clearPreeditFromAndroid"
                                + " && window.clearPreeditFromAndroid("
                                + inputGeneration.get() + ")");
                barrier.afterFinalize.run();
                finishTelexBarrier(barrierId, true);
            });
            return eventGeneration + 1;
        }

        @JavascriptInterface
        public int commitTelexText(
                String expectedText,
                String separator,
                int eventGeneration) {
            if (!isCurrentInputView()
                    || !isTelexMode()
                    || !inputGeneration.compareAndSet(
                            eventGeneration,
                            eventGeneration + 1)) {
                return inputGeneration.get();
            }
            int generation = eventGeneration;
            int nextGeneration = eventGeneration + 1;
            String committedText = expectedText == null ? "" : expectedText;
            String committedSeparator = separator == null ? "" : separator;
            telexHasPreedit = false;
            CountDownLatch applied = new CountDownLatch(1);
            owner.post(() -> {
                try {
                    // Apply the expected final word and separator in one UI
                    // task. This does not depend on an earlier asynchronous
                    // PREEDIT update having reached the InputConnection.
                    if (!isCurrentInputView()
                            || nextGeneration != inputGeneration.get()
                            || !isTelexMode()) return;
                    InputConnection connection = getCurrentInputConnection();
                    if (connection != null) {
                        connection.setComposingText(committedText, 1);
                        connection.finishComposingText();
                        connection.commitText(committedSeparator, 1);
                    }
                    preeditText = "";
                    preeditGrammarSectionsJson = "[]";
                    pendingPreeditLengths.clear();
                    takePendingTelexText(generation);
                } finally {
                    applied.countDown();
                }
            });
            try {
                applied.await(1, TimeUnit.SECONDS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            return nextGeneration;
        }

        @JavascriptInterface
        public void undoRawOutlineStroke() {
            if (!isCurrentInputView()) {
                return;
            }
            int generation = inputGeneration.get();
            owner.post(() -> {
                if (isCurrentInputView()
                        && generation == inputGeneration.get()) {
                    undoCommittedRawOutlineStroke();
                }
            });
        }

        @JavascriptInterface
        public String requestInferenceSync(String body, int requestId) {
            if (!isCurrentInputView()) {
                return "{\"statusCode\":409,\"responseBody\":\"\","
                        + "\"errorMessage\":\"Stale input view\"}";
            }
            return V7ImeService.this.requestInferenceSync(body, requestId);
        }

        @JavascriptInterface
        public void requestPlover(String body, int requestId) {
            if (isCurrentInputView()) {
                V7ImeService.this.requestPlover(body, requestId);
            }
        }

        @JavascriptInterface
        public void changeInputMethod() {
            if (isCurrentInputView()) {
                owner.post(() -> {
                    if (!isCurrentInputView()) {
                        return;
                    }
                    InputMethodManager manager = (InputMethodManager)
                            getSystemService(INPUT_METHOD_SERVICE);
                    if (manager != null) {
                        manager.showInputMethodPicker();
                    }
                });
            }
        }
    }
}
