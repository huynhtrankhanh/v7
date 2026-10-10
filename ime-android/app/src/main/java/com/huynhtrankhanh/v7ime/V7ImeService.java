package com.huynhtrankhanh.v7ime;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.SharedPreferences;
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
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

public class V7ImeService extends InputMethodService {
    private static final String LOG_TAG = "V7Ime";
    private static final GenerationOwnership<V7ImeService> SERVICE_OWNERSHIP =
            new GenerationOwnership<>();
    private static final int DEFAULT_KEYBOARD_HEIGHT_DP = 160;
    private static final int MIN_KEYBOARD_HEIGHT_DP = 48;

    private final ExecutorService inferenceExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService telexExecutor = Executors.newSingleThreadExecutor();
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
    private SharedPreferences clipboardPreferences;
    private final Runnable refreshClipboardSlots = () -> dispatchInputCommand("refresh");
    private final SharedPreferences.OnSharedPreferenceChangeListener clipboardListener =
            (preferences, key) -> {
                mainHandler.removeCallbacks(refreshClipboardSlots);
                mainHandler.post(refreshClipboardSlots);
            };
    private FrameLayout inputContainer;
    private volatile WebView webView;
    private boolean inferenceWarmupScheduled = false;
    private String preeditText = "";
    private String preeditGrammarSectionsJson = "[]";
    private final TelexPreeditState telexPreeditState = new TelexPreeditState();
    private final Deque<Integer> pendingPreeditLengths = new ArrayDeque<>();
    private final AtomicInteger inputGeneration = new AtomicInteger();
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
    private TelexJavaScriptSandbox telexSandbox;
    private ImeJavaScriptSandbox inputSandbox;
    private final ExecutorService inputSandboxExecutor = Executors.newSingleThreadExecutor();
    private final Deque<JSONObject> pendingInputCommands = new ArrayDeque<>();
    private volatile String inputSnapshot = "";
    private volatile String appliedPreeditSnapshot = "";
    private final Runnable refreshInputState = () -> dispatchInputCommand("refresh");
    private final TelexRawBuffer nativeTelexRaw = new TelexRawBuffer();
    private String nativeTelexRendered = "";
    private int pendingTelexDeadAccent;

    private final BundledStrippedPloverRuntime.StateListener ploverStateListener =
            paused -> {
                if (SERVICE_OWNERSHIP.isCurrent(this, serviceGeneration)) {
                    scheduleInputStateRefresh();
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
        clipboardPreferences = new ClipboardSlotStore(this).preferences();
        clipboardPreferences.registerOnSharedPreferenceChangeListener(clipboardListener);
        telexSandbox = new TelexJavaScriptSandbox(this);
        warmTelexSandbox();
        inputSandbox = new ImeJavaScriptSandbox(this);
        warmInputSandbox();
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
                oldSelStart,
                oldSelEnd,
                newSelStart,
                newSelEnd,
                candidatesStart,
                candidatesEnd)) {
            return;
        }
        if (oldSelStart == newSelStart
                && oldSelEnd == newSelEnd
                && !pendingPreeditLengths.isEmpty()) {
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
        if (clipboardPreferences != null) {
            clipboardPreferences.unregisterOnSharedPreferenceChangeListener(clipboardListener);
        }
        SERVICE_OWNERSHIP.release(this, serviceGeneration);
        keyboardVisibilityController.finishInput();
        mainHandler.removeCallbacksAndMessages(null);
        inferenceExecutor.shutdownNow();
        telexExecutor.shutdownNow();
        inputSandboxExecutor.shutdownNow();
        pendingInputCommands.clear();
        if (inputSandbox != null) inputSandbox.close();
        if (telexSandbox != null) telexSandbox.close();
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
        boolean effectiveTelex = isEffectiveTelexMode();
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
            boolean handled = dispatchModeKeyAction(event, hardwareAction);
            if (HardwareEditorKeyPolicy.isModifier(event.getKeyCode())) {
                return forwardHardwareKeyToEditor(event);
            }
            return handled;
        }
        HardwareKeyPressOwnership.Claim keyClaim =
                hardwareKeyPressOwnership.get(event.getKeyCode());
        if (event.getAction() == KeyEvent.ACTION_UP && keyClaim != null) {
            hardwareKeyPressOwnership.release(event.getKeyCode());
            if (keyClaim.owner == HardwareKeyPressOwnership.Owner.FORWARDED) {
                return forwardHardwareKeyToEditor(event);
            }
            if (keyClaim.owner == HardwareKeyPressOwnership.Owner.EDITOR) {
                return false;
            }
            if (!keyClaim.belongsTo(inputGeneration.get())) return true;
            if (keyClaim.owner == HardwareKeyPressOwnership.Owner.CLIPBOARD) return true;
            if (keyClaim.owner == HardwareKeyPressOwnership.Owner.NATIVE) {
                return dispatchNativeTelexKey(event);
            }
            return dispatchPhysicalKeyToSandbox("keyup", event);
        }
        if (event.getAction() == KeyEvent.ACTION_DOWN
                && event.getRepeatCount() > 0 && keyClaim != null) {
            if (keyClaim.owner == HardwareKeyPressOwnership.Owner.FORWARDED) {
                return forwardHardwareKeyToEditor(event);
            }
            if (keyClaim.owner == HardwareKeyPressOwnership.Owner.EDITOR) {
                return false;
            }
            if (!keyClaim.belongsTo(inputGeneration.get())) return true;
            if (keyClaim.owner == HardwareKeyPressOwnership.Owner.CLIPBOARD) return true;
            if (keyClaim.owner == HardwareKeyPressOwnership.Owner.NATIVE) {
                boolean handled = dispatchNativeTelexKey(event);
                if (!handled) {
                    hardwareKeyPressOwnership.transfer(
                            event.getKeyCode(),
                            HardwareKeyPressOwnership.Owner.EDITOR,
                            inputGeneration.get());
                } else {
                    hardwareKeyPressOwnership.refresh(
                            event.getKeyCode(),
                            keyClaim,
                            inputGeneration.get());
                }
                return handled;
            }
            return dispatchPhysicalKeyToSandbox("keydown", event);
        }
        if (HardwareEditorKeyPolicy.isModifier(event.getKeyCode())
                || HardwareEditorKeyPolicy.isSelectionNavigation(event)) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                // Finish before the editor changes its selection. A later
                // composing update must never replace the selected host text.
                if (HardwareEditorKeyPolicy.isSelectionNavigation(event)) {
                    finishCurrentPreedit();
                }
                hardwareKeyPressOwnership.claim(event.getKeyCode(),
                        HardwareKeyPressOwnership.Owner.FORWARDED, inputGeneration.get());
            }
            return forwardHardwareKeyToEditor(event);
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
                        effectiveTelex,
                        event.getUnicodeChar(),
                        event.isAltPressed(),
                        event.isMetaPressed());
        boolean captureClipboardSlot = hardwareKeyCapturePolicy.capturesClipboardSlot(
                event, isV7PloverMode() && !rawOutlineMode);
        if (captureClipboardSlot) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                hardwareKeyPressOwnership.claim(event.getKeyCode(),
                        HardwareKeyPressOwnership.Owner.CLIPBOARD, inputGeneration.get());
                if (event.getRepeatCount() == 0) {
                    String signature = "clipboard-key:" + event.getKeyCode() + ":" + event.getEventTime();
                    if (signature.equals(lastKeyEventSignature)) return true;
                    lastKeyEventSignature = signature;
                    int base = event.getKeyCode() >= KeyEvent.KEYCODE_NUMPAD_0
                            ? KeyEvent.KEYCODE_NUMPAD_0 : KeyEvent.KEYCODE_0;
                    InputConnection connection = getCurrentInputConnection();
                    CharSequence selected = event.isAltPressed() && connection != null
                            ? connection.getSelectedText(0) : null;
                    try {
                        dispatchInputCommand(new JSONObject().put("type", "clipboard")
                                .put("slot", event.getKeyCode() - base)
                                .put("copy", event.isAltPressed())
                                .put("selected", selected == null ? JSONObject.NULL : selected.toString())
                                .put("epoch", inputGeneration.get()));
                    } catch (JSONException error) {
                        Log.e(LOG_TAG, "Unable to encode clipboard input", error);
                    }
                }
            }
            return true;
        }
        if (isOsPassthroughModifierKey(event.getKeyCode())
                || (!captureModifiedPrintable && !captureClipboardSlot
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
        TelexHardwareKeyPolicy.Route telexRoute = effectiveTelex
                ? telexHardwareKeyPolicy.resolve(
                        event.getKeyCode(),
                        telexHasPreedit,
                        pendingTelexDeadAccent != 0)
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
        if (effectiveTelex) {
            boolean handled = dispatchNativeTelexKey(event);
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                hardwareKeyPressOwnership.claim(
                        event.getKeyCode(),
                        handled
                                ? HardwareKeyPressOwnership.Owner.NATIVE
                                : HardwareKeyPressOwnership.Owner.EDITOR,
                        inputGeneration.get());
            }
            return handled;
        }
        if (isEnterKey(event.getKeyCode())) {
            return dispatchEnterKey(event);
        }
        String action = event.getAction() == KeyEvent.ACTION_UP
                ? "keyup"
                : "keydown";
        boolean captured = dispatchPhysicalKeyToSandbox(action, event);
        if (captured && event.getAction() == KeyEvent.ACTION_DOWN) {
            hardwareKeyPressOwnership.claim(
                    event.getKeyCode(),
                    HardwareKeyPressOwnership.Owner.SANDBOX,
                    inputGeneration.get());
        }
        return captured;
    }

    private boolean forwardHardwareKeyToEditor(KeyEvent event) {
        String signature = "editor-key:" + event.getAction() + ":"
                + event.getKeyCode() + ":" + event.getEventTime();
        if (signature.equals(lastKeyEventSignature)) return true;
        lastKeyEventSignature = signature;
        InputConnection connection = getCurrentInputConnection();
        return connection != null && connection.sendKeyEvent(event);
    }

    private boolean dispatchNativeTelexKey(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_UP) {
            return telexHardwareKeyPolicy.dispatchKeyUpToEditor(
                    event.getKeyCode())
                    ? dispatchEnterKey(event)
                    : true;
        }
        int keyCode = event.getKeyCode();
        if (keyCode == KeyEvent.KEYCODE_SHIFT_LEFT
                || keyCode == KeyEvent.KEYCODE_SHIFT_RIGHT
                || keyCode == KeyEvent.KEYCODE_CAPS_LOCK) return true;
        if (isEnterKey(keyCode)) {
            flushPendingTelexDeadAccent();
            finishCurrentPreedit();
            return dispatchEnterKey(event);
        }
        if (keyCode == KeyEvent.KEYCODE_DEL) {
            if (pendingTelexDeadAccent != 0) {
                pendingTelexDeadAccent = 0;
                return true;
            }
            if (!nativeTelexRaw.backspace()) return false;
            updateNativeTelexPreedit();
            return true;
        }
        int unicode = event.getUnicodeChar();
        if ((unicode & KeyCharacterMap.COMBINING_ACCENT) != 0) {
            pendingTelexDeadAccent = unicode
                    & KeyCharacterMap.COMBINING_ACCENT_MASK;
            return true;
        }
        if (isTelexTerminator(event)) {
            boolean hadDeadAccent = pendingTelexDeadAccent != 0;
            flushPendingTelexDeadAccent();
            if (hadDeadAccent && keyCode == KeyEvent.KEYCODE_SPACE) return true;
            commitNativeTelexSeparator(getTelexSeparator(event));
            return true;
        }
        String key = getNativeTelexKey(event, unicode);
        if (key.codePointCount(0, key.length()) == 1
                && (Character.isLetter(key.codePointAt(0))
                        || "[".equals(key)
                        || "]".equals(key))) {
            nativeTelexRaw.append(key);
            updateNativeTelexPreedit();
            return true;
        }
        return false;
    }

    private String getNativeTelexKey(KeyEvent event, int unicode) {
        if (pendingTelexDeadAccent == 0) return getJavascriptKey(event);
        int accent = pendingTelexDeadAccent;
        pendingTelexDeadAccent = 0;
        int combined = unicode == 0
                ? 0
                : KeyCharacterMap.getDeadChar(accent, unicode);
        if (combined != 0) return new String(Character.toChars(combined));
        commitNativeTelexSeparator(new String(Character.toChars(accent)));
        return getJavascriptKey(event);
    }

    private void flushPendingTelexDeadAccent() {
        if (pendingTelexDeadAccent == 0) return;
        int accent = pendingTelexDeadAccent;
        pendingTelexDeadAccent = 0;
        commitNativeTelexSeparator(new String(Character.toChars(accent)));
    }

    private void updateNativeTelexPreedit() {
        String converted = telexSandbox.convertIfReady(nativeTelexRaw.text());
        if (converted == null) {
            nativeTelexRendered = nativeTelexRaw.text();
            publishTelexAvailability();
            warmTelexSandbox();
        } else {
            nativeTelexRendered = converted;
        }
        telexHasPreedit = !nativeTelexRendered.isEmpty();
        rememberPendingTelexText(nativeTelexRendered, inputGeneration.get());
        applyPreeditText(nativeTelexRendered, "[]");
    }

    private void warmTelexSandbox() {
        telexSandbox.warmAsync(telexExecutor, () -> mainHandler.post(() -> {
            publishTelexAvailability();
            if (isEffectiveTelexMode()
                    && !nativeTelexRaw.isEmpty()
                    && telexSandbox.isReady()) updateNativeTelexPreedit();
        }));
    }

    private void commitNativeTelexSeparator(String separator) {
        InputConnection connection = getCurrentInputConnection();
        if (connection != null) {
            connection.setComposingText(nativeTelexRendered, 1);
            connection.finishComposingText();
            connection.commitText(separator, 1);
        }
        nativeTelexRaw.clear();
        nativeTelexRendered = "";
        pendingTelexDeadAccent = 0;
        telexHasPreedit = false;
        preeditText = "";
        preeditGrammarSectionsJson = "[]";
        pendingPreeditLengths.clear();
        takePendingTelexText(inputGeneration.get());
        int nextGeneration = inputGeneration.incrementAndGet();
        dispatchInputCommand("clear");
        BundledStrippedPloverRuntime.get(this).request(
                "{\"id\":0,\"method\":\"reset_state\",\"params\":{}}", (body, error) -> {});
        evaluateJavascript(
                "window.clearPreeditFromAndroid"
                        + " && window.clearPreeditFromAndroid("
                        + nextGeneration + ")");
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
            HardwareKeyPressOwnership.Claim claim =
                    hardwareKeyPressOwnership.get(event.getKeyCode());
            hardwareKeyPressOwnership.remove(event.getKeyCode());
            applyHardwareInputTransition(transition);
            publishStenoModeState();
            return claim != null
                    && claim.owner == HardwareKeyPressOwnership.Owner.NATIVE;
        } else if (action == HardwareKeyActionResolver.Action.TOGGLE_TELEX) {
            if (rawOutlineMode) return true;
            HardwareInputMode.Transition transition =
                    currentHardwareInputMode().onControlTab();
            applyHardwareInputTransition(transition);
            publishStenoModeState();
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

    private boolean isEffectiveTelexMode() {
        return hardwareInputMode.usesNativeTelex(rawOutlineMode);
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

    private boolean dispatchPhysicalKeyToSandbox(String action, KeyEvent event) {
        if (!hardwareKeyCapturePolicy.isCaptured(
                event.getKeyCode(),
                event.getUnicodeChar(),
                isEffectiveTelexMode())) {
            return false;
        }

        String signature = action + ":" + event.getKeyCode() + ":" + event.getEventTime();
        if (signature.equals(lastKeyEventSignature)) {
            return true;
        }
        lastKeyEventSignature = signature;

        try {
            JSONObject key = new JSONObject().put("action", action)
                    .put("key", getJavascriptKey(event))
                    .put("code", getJavascriptCode(event.getKeyCode()))
                    .put("repeat", event.getRepeatCount() > 0)
                    .put("shiftKey", event.isShiftPressed()).put("ctrlKey", event.isCtrlPressed())
                    .put("altKey", event.isAltPressed()).put("metaKey", event.isMetaPressed())
                    .put("capsLock", event.isCapsLockOn()).put("epoch", inputGeneration.get());
            dispatchInputCommand(new JSONObject().put("type", "key").put("event", key)
                    .put("epoch", inputGeneration.get()));
        } catch (JSONException error) {
            Log.e(LOG_TAG, "Unable to encode hardware input", error);
        }
        return true;
    }

    private boolean isTelexTerminator(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_TAB
                || event.getKeyCode() == KeyEvent.KEYCODE_SPACE) return true;
        int unicode = event.getUnicodeChar();
        if ((unicode & KeyCharacterMap.COMBINING_ACCENT) != 0) return false;
        if (unicode == 0 || !Character.isValidCodePoint(unicode)) return false;
        return !Character.isLetter(unicode) && unicode != '[' && unicode != ']';
    }

    private String getTelexSeparator(KeyEvent event) {
        return event.getKeyCode() == KeyEvent.KEYCODE_TAB
                ? "\t"
                : getJavascriptKey(event);
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
        if (keyCode >= KeyEvent.KEYCODE_NUMPAD_0 && keyCode <= KeyEvent.KEYCODE_NUMPAD_9) {
            return "Numpad" + (keyCode - KeyEvent.KEYCODE_NUMPAD_0);
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
            int oldSelStart,
            int oldSelEnd,
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
            Iterator<Integer> iterator = pendingPreeditLengths.iterator();
            while (iterator.hasNext()) {
                int expectedLength = iterator.next();
                if (expectedLength == composingLength) {
                    iterator.remove();
                    return true;
                }
            }
            return false;
        }

        // Some editors omit composing bounds from the selection callback
        // generated by setComposingText. A pending collapsed callback is still
        // our update when selection did not move and must not clear the
        // WebUI buffer.
        if (oldSelStart != newSelStart || oldSelEnd != newSelEnd) {
            return false;
        }
        pendingPreeditLengths.removeFirst();
        return true;
    }

    private boolean applyPreeditText(
            String nextText,
            String nextGrammarSectionsJson) {
        String normalized = nextText == null ? "" : nextText;
        String normalizedGrammarSections = nextGrammarSectionsJson == null
                ? "[]"
                : nextGrammarSectionsJson;
        String previousPreeditText = preeditText;
        String previousGrammarSections = preeditGrammarSectionsJson;
        if (normalized.equals(previousPreeditText)
                && normalizedGrammarSections.equals(previousGrammarSections)) {
            return true;
        }
        InputConnection connection = getCurrentInputConnection();
        if (connection == null) {
            pendingPreeditLengths.clear();
            preeditText = normalized;
            preeditGrammarSectionsJson = normalizedGrammarSections;
            return true;
        }

        if (normalized.isEmpty()) {
            boolean setApplied = connection.setComposingText("", 1);
            boolean finishApplied = connection.finishComposingText();
            if (!setApplied || !finishApplied) {
                Log.w(
                        LOG_TAG,
                        "Failed to clear composing text setApplied="
                                + setApplied
                                + " finishApplied="
                                + finishApplied
                );
                return false;
            }
            preeditText = "";
            preeditGrammarSectionsJson = "[]";
            pendingPreeditLengths.clear();
            return true;
        } else {
            preeditText = normalized;
            preeditGrammarSectionsJson = normalizedGrammarSections;
            pendingPreeditLengths.addLast(preeditText.length());
            boolean applied = connection.setComposingText(buildStyledPreedit(), 1);
            if (applied) {
                return true;
            }
            pendingPreeditLengths.removeLast();
            preeditText = previousPreeditText;
            preeditGrammarSectionsJson = previousGrammarSections;
            Log.w(LOG_TAG, "Failed to set composing text");
            return false;
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
        flushPendingTelexDeadAccent();
        int generation = inputGeneration.getAndIncrement();
        appliedPreeditSnapshot = "";
        latestInferenceRequestId.set(-1);
        String latestTelexText = takePendingTelexText(generation);
        boolean hadPreedit = !preeditText.isEmpty();
        preeditText = "";
        telexHasPreedit = false;
        nativeTelexRaw.clear();
        nativeTelexRendered = "";
        pendingTelexDeadAccent = 0;
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
        dispatchInputCommand("clear");
        BundledStrippedPloverRuntime.get(this).request(
                "{\"id\":0,\"method\":\"reset_state\",\"params\":{}}", (body, error) -> {});
        evaluateJavascript(
                "window.clearPreeditFromAndroid && window.clearPreeditFromAndroid("
                        + inputGeneration.get()
                        + ")"
        );
        publishTelexAvailability();
    }

    private void publishTelexAvailability() {
        scheduleInputStateRefresh();
        evaluateJavascript(
                "window.handleAndroidTelexAvailability"
                        + " && window.handleAndroidTelexAvailability("
                        + telexSandbox.isReady() + ")");
    }

    private String takePendingTelexText(int generation) {
        return telexPreeditState.take(generation);
    }

    private void rememberPendingTelexText(String text, int generation) {
        telexPreeditState.remember(text, generation);
    }

    private void publishStenoModeState() {
        scheduleInputStateRefresh();
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
        publishTelexAvailability();
    }

    private void publishEditorModeState() {
        scheduleInputStateRefresh();
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

    private void warmInputSandbox() {
        inputSandbox.warmAsync(inputSandboxExecutor, () -> mainHandler.post(() -> {
            if (!SERVICE_OWNERSHIP.isCurrent(this, serviceGeneration)) return;
            if (!inputSandbox.isReady()) {
                android.widget.Toast.makeText(this, "V7 input sandbox unavailable", android.widget.Toast.LENGTH_LONG).show();
                return;
            }
            while (inputSandbox.isReady() && !pendingInputCommands.isEmpty()) dispatchInputCommand(pendingInputCommands.removeFirst());
            dispatchInputCommand("refresh");
        }));
    }

    private void scheduleInputStateRefresh() {
        mainHandler.removeCallbacks(refreshInputState);
        mainHandler.post(refreshInputState);
    }

    private JSONObject inputContext() throws JSONException {
        return new JSONObject().put("epoch", inputGeneration.get())
                .put("steno", isV7PloverMode()).put("telex", isTelexMode())
                .put("telexReady", telexSandbox.isReady()).put("rawOutline", rawOutlineMode)
                .put("ploverPaused", BundledStrippedPloverRuntime.get(this).isPaused())
                .put("ploverAvailable", true).put("modelState", getInferenceModelState())
                .put("modelError", getInferenceModelError())
                .put("slots", new JSONArray(new ClipboardSlotStore(this).toJson()));
    }

    private void dispatchInputCommand(String type) {
        try {
            dispatchInputCommand(new JSONObject().put("type", type).put("epoch", inputGeneration.get()));
        } catch (JSONException error) {
            Log.e(LOG_TAG, "Unable to encode input command", error);
        }
    }

    private void dispatchInputCommand(JSONObject command) {
        if (inputSandbox == null || !SERVICE_OWNERSHIP.isCurrent(this, serviceGeneration)) return;
        if (command.optInt("epoch", -1) != inputGeneration.get()) return;
        if (!inputSandbox.isReady()) {
            pendingInputCommands.addLast(command);
            warmInputSandbox();
            return;
        }
        try {
            command.put("context", inputContext());
            applyInputPacket(inputSandbox.dispatch(command));
        } catch (Exception error) {
            handleInputSandboxFailure(error);
        }
    }

    private void handleInputSandboxFailure(Exception error) {
        Log.e(LOG_TAG, "V7 sandbox input failed", error);
        android.widget.Toast.makeText(this, "V7 input failed: " + error.getClass().getSimpleName(),
                android.widget.Toast.LENGTH_LONG).show();
        // Preserve the last completed composition before a replacement isolate
        // starts with an empty buffer. Never let recovery erase host text.
        inputSandbox.close();
        inputSandbox = new ImeJavaScriptSandbox(this);
        pendingInputCommands.clear();
        finishCurrentPreedit();
        warmInputSandbox();
    }

    private void applyInputPacket(JSONObject packet) throws Exception {
        JSONArray effects = packet.optJSONArray("effects");
        JSONObject next = packet.optJSONObject("snapshot");
        if (next != null && next.optInt("epoch", -1) == inputGeneration.get()) {
            String nextSnapshot = next.toString();
            boolean snapshotChanged = !nextSnapshot.equals(inputSnapshot);
            boolean needsPreeditRetry = !isEffectiveTelexMode()
                    && !nextSnapshot.equals(appliedPreeditSnapshot);
            if (snapshotChanged || needsPreeditRetry) {
                boolean preeditApplied = true;
                if (!isEffectiveTelexMode()) {
                    preeditApplied = applyPreeditText(
                            next.optString("text", ""),
                            next.optJSONArray("grammarSections").toString()
                    );
                }
                if (snapshotChanged) {
                    inputSnapshot = nextSnapshot;
                    evaluateJavascript("window.handleAndroidInputSnapshot && window.handleAndroidInputSnapshot(" + next + ")");
                }
                if (preeditApplied) {
                    appliedPreeditSnapshot = nextSnapshot;
                }
            }
        }
        if (effects == null) return;
        for (int index = 0; index < effects.length(); index++) {
            JSONObject effect = effects.getJSONObject(index);
            int id = effect.getInt("id");
            switch (effect.getString("type")) {
                case "infer": {
                    InferenceResult result = runNativeInference(effect.getString("body"), latestInferenceRequestId.incrementAndGet());
                    String value = result.errorMessage.isEmpty() ? result.responseBody : "null";
                    applyInputPacket(inputSandbox.reply(id, value, result.errorMessage));
                    break;
                }
                case "plover": {
                    JSONObject request = new JSONObject().put("id", id).put("method", effect.getString("method"))
                            .put("params", effect.opt("params"));
                    ImeJavaScriptSandbox owner = inputSandbox;
                    long isolateGeneration = owner.generation();
                    BundledStrippedPloverRuntime.get(this).request(request.toString(), (body, error) -> {
                        if (!SERVICE_OWNERSHIP.isCurrent(this, serviceGeneration) || inputSandbox != owner
                                || !owner.isReady() || owner.generation() != isolateGeneration) return;
                        String value = "null";
                        String failure = error;
                        try {
                            if (failure.isEmpty()) {
                                JSONObject response = new JSONObject(body);
                                if (response.has("error")) failure = response.get("error").toString();
                                else value = response.getJSONObject("result").toString();
                            }
                        } catch (JSONException invalidResponse) {
                            failure = "Stripped Plover returned invalid JSON";
                        }
                        try {
                            applyInputPacket(owner.reply(id, value, failure));
                        } catch (Exception exception) {
                            handleInputSandboxFailure(exception);
                        }
                    });
                    break;
                }
                case "clipboard":
                    new ClipboardSlotStore(this).set(effect.getInt("slot"), effect.getString("text"));
                    break;
                case "message":
                    android.widget.Toast.makeText(this, effect.getString("text"), android.widget.Toast.LENGTH_SHORT).show();
                    break;
                case "undoOutline": undoCommittedRawOutlineStroke(); break;
                case "switch": {
                    InputMethodManager manager = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                    if (manager != null) manager.showInputMethodPicker();
                    break;
                }
                default: throw new IllegalStateException("Unknown sandbox input effect");
            }
        }
    }

    private void evaluateJavascript(String script) {
        WebView target = webView;
        int targetGeneration = inputViewGeneration;
        if (target == null) {
            return;
        }
        Runnable evaluation = () -> {
            if (inputViewOwnership.isCurrent(target, targetGeneration)) {
                target.evaluateJavascript(script, null);
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) {
            evaluation.run();
        } else {
            target.post(evaluation);
        }
    }

    private void resetHardwareKeyboardStateInSandbox() {
        dispatchInputCommand("reset");
    }

    private void resetHardwareInputState() {
        hardwareKeyActionResolver.reset();
        hardwareKeyPressOwnership.invalidate();
        resetHardwareKeyboardStateInSandbox();
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
        scheduleInputStateRefresh();
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
        public boolean isSandboxInputEnabled() { return true; }

        @JavascriptInterface
        public String getInputSnapshot() { return inputSnapshot; }

        @JavascriptInterface
        public void submitInputCommand(String json) {
            if (!isCurrentInputView()) return;
            try {
                JSONObject command = new JSONObject(json);
                String type = command.optString("type");
                if (!("select".equals(type) || "clipboard".equals(type))) return;
                int epoch = command.optInt("epoch", -1);
                mainHandler.post(() -> {
                    if (isCurrentInputView() && epoch == inputGeneration.get()) dispatchInputCommand(command);
                });
            } catch (JSONException error) {
                Log.e(LOG_TAG, "Invalid display input command", error);
            }
        }

        @JavascriptInterface
        public String getClipboardSlots() {
            return new ClipboardSlotStore(V7ImeService.this).toJson();
        }

        @JavascriptInterface
        public boolean setClipboardSlot(int slot, String text) {
            return isCurrentInputView() && new ClipboardSlotStore(V7ImeService.this).set(slot, text);
        }

        @JavascriptInterface
        public boolean migrateClipboardSlots(String json) {
            return isCurrentInputView() && new ClipboardSlotStore(V7ImeService.this).migrate(json);
        }

        @JavascriptInterface
        public void showClipboardMessage(String text) {
            if (isCurrentInputView()) mainHandler.post(() ->
                    android.widget.Toast.makeText(V7ImeService.this, text,
                            android.widget.Toast.LENGTH_SHORT).show());
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
        public boolean isTelexReady() {
            return telexSandbox.isReady();
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
