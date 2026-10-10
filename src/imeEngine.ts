import {
  type Island,
  TextBuffer,
  convertIslandsForInference,
  createIsland,
  ensureString,
} from "./textBuffer";
import { createUndoManager } from "./undoManager";
import {
  getCandidateSelectionMatch,
  getFirstCandidateAppendStroke,
  isLoneCandidateSelectionStroke,
} from "./candidateSelection";
import { decodeV7PermittedSyllableStroke } from "./vietnameseSyllables";
import {
  buildCandidateDiffPlan,
  KeyboardStrokeTracker,
  findPiecemealSyllableTargets,
  getNextPiecemealCursorIndex,
  getPiecemealEntryIndex,
  mapKeyUnique,
  renderVisibleText,
  replacePiecemealSyllable,
  selectCandidateIslands,
} from "./editorCore";
import { handleEmilySymbol } from "./emilySymbols";
import {
  decodeCanonicalTwoSyllableStroke,
  decodeDictionaryModeStroke,
} from "./twoSyllableV7";

export interface ImeInputContext {
  epoch: number;
  steno: boolean;
  telex: boolean;
  telexReady: boolean;
  rawOutline: boolean;
  ploverPaused: boolean;
  ploverAvailable: boolean;
  modelState: string;
  modelError: string;
  slots: (string | null)[];
}
export interface ImeSnapshot extends ImeInputContext {
  islands: Island[];
  candidates: string[][];
  piecemealCursorIndex: number | null;
  ploverEnabled: boolean;
  inferenceError: string;
  text: string;
  grammarSections: { start: number; end: number; suggestions: string[] }[];
}
export interface ImeKey {
  action: "keydown" | "keyup";
  key: string;
  code?: string;
  repeat: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  capsLock: boolean;
  epoch: number;
}
export interface ImeEnginePorts {
  infer(body: string): Promise<unknown>;
  plover(
    method: string,
    params: unknown,
  ): Promise<{ output?: { type: "committed" | "preedit"; text?: string }[] }>;
  snapshot(state: ImeSnapshot): void;
  setClipboardSlot(slot: number, text: string): void;
  message(text: string): void;
  changeInputMethod(): void;
  undoRawOutlineStroke(): void;
  event?(name: string, detail: unknown): void;
}
export function createImeEngine(
  ports: ImeEnginePorts,
  initial: ImeInputContext,
) {
  let context = initial;
  const buffer = new TextBuffer();
  const state = {
    get islands() {
      return buffer.getIslands();
    },
    set islands(next: Island[]) {
      buffer.setIslands(next);
    },
    get pendingCapitalization() {
      return buffer.pendingCapitalization;
    },
    set pendingCapitalization(next: boolean) {
      buffer.pendingCapitalization = next;
    },
    candidates: [] as string[][],
  };
  let piecemealCursorIndex: number | null = null;
  let keyboardCapsLockActive = false;
  let inferenceErrorMessage = "";
  let inputEpoch = initial.epoch;
  let rawOutlineMode = initial.rawOutline;
  let stenoModeEnabled = initial.steno;
  let ploverPaused = initial.ploverPaused;
  let inferenceModelState = initial.modelState;
  let inferenceRunGeneration = 0;
  const strippedPlover = {
    available: initial.ploverAvailable,
    enabled: false,
    solo: false,
    preeditIndex: null as number | null,
    requestId: 0,
  };
  const keyboardStrokeTracker = new KeyboardStrokeTracker();
  const clipboardPasteIslands = new WeakMap<Island, string>();
  let clipboardPasteCounter = 0;
  const clipboardSlots = {
    get: (slot: number) => context.slots[slot] ?? null,
    set: (slot: number, text: string) => {
      context.slots[slot] = text;
      ports.setClipboardSlot(slot, text);
    },
  };
  const clipboardMessage = ports.message;
  const setPloverMessage = ports.message;
  const requestPlover = ports.plover;
  const errorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;
  function isEffectiveTelexMode() {
    return context.telex && !context.rawOutline;
  }
  const pendingInference = new Set<Promise<void>>();
  const undoManager = createUndoManager(
    buffer,
    (fields) => {
      state.candidates = [];
      piecemealCursorIndex = fields.piecemealCursorIndex ?? null;
      syncPloverPreeditIndex();
      updateDisplay();
      runInference();
    },
    { getPiecemealCursorIndex: () => piecemealCursorIndex },
  );
  const PUNCTUATION_MAP: Record<string, string> = {
    "TP-PL": ".",
    "KW-BG": ",",
    "KW-PL": "?",
    "TP-BG": "!",
  };
  type RetroSpaceAction = "insert" | "delete";
  interface PloverOutputItem {
    type: "committed" | "preedit";
    text?: string;
  }
  type SelectCandidateOptions = {
    saveHistory: boolean;
    refreshDisplay: boolean;
  };
  function invalidateInference() {
    inferenceRunGeneration++;
  }
  function updateDisplay() {
    const plan = state.candidates.length
      ? buildCandidateDiffPlan(state.islands, state.candidates)
      : null;
    const grammarSections = (plan?.sections ?? [])
      .slice(0, 2)
      .filter((section) => section.end > section.start)
      .map((section) => {
        const suggestions: string[] = [];
        for (const candidate of plan?.candidates.slice(1) ?? []) {
          const alt = candidate.sections.find(
            ({ role }) => role === section.role,
          );
          if (
            alt?.changes &&
            alt.text !== section.text &&
            !suggestions.includes(alt.text)
          )
            suggestions.push(alt.text);
        }
        return {
          start: section.start,
          end: section.end,
          suggestions: suggestions.slice(0, 5),
        };
      });
    ports.snapshot({
      ...context,
      islands: state.islands,
      candidates: state.candidates,
      piecemealCursorIndex,
      ploverEnabled: strippedPlover.enabled,
      inferenceError: inferenceErrorMessage,
      text: renderVisibleText(state.islands, state.candidates),
      grammarSections,
    });
  }
  function copyClipboardSlot(slot: number, selected?: string | null) {
    if (!isClipboardMode()) return;
    const text = selected || renderVisibleText(state.islands, state.candidates);
    if (!text) {
      clipboardMessage(`Nothing to copy; slot ${slot} unchanged.`);
      return;
    }
    clipboardSlots.set(slot, text);
    clipboardMessage(`Copied to slot ${slot} (${text.length} characters).`);
    updateDisplay();
  }
  function applyRetroactiveSpace(
    action: RetroSpaceAction | null,
    repeat: number,
  ): boolean {
    if (!action) return false;
    let changed = false;
    for (let i = 0; i < repeat; i++) {
      const islandCount = buffer.getIslandCount();
      if (islandCount === 0) break;
      const lastIndex = islandCount - 1;
      const last = buffer.getIslandAt(lastIndex);
      if (!last) break;
      if (last.type === "spacing" && last.value === " ") {
        if (action === "delete") {
          if (buffer.removeIslandAt(lastIndex)) {
            changed = true;
            continue;
          }
          break;
        }
        break;
      }
      if (lastIndex === 0) break;
      if (
        buffer.replaceIslandAt(lastIndex, {
          ...last,
          spacing: {
            before: action === "insert",
            after: last.spacing?.after ?? false,
          },
        })
      ) {
        changed = true;
      }
      break;
    }
    return changed;
  }
  function saveState(group?: string): void {
    undoManager.save(group);
  }
  function restoreState(group?: string): void {
    undoManager.undo(group);
  }
  function isClipboardMode(): boolean {
    return !rawOutlineMode && !isEffectiveTelexMode() && stenoModeEnabled;
  }
  async function pasteClipboardSlot(slot: number): Promise<void> {
    if (!isClipboardMode()) return;
    const text = clipboardSlots.get(slot);
    if (text === null) {
      clipboardMessage(`Slot ${slot} is empty.`);
      return;
    }
    resetHardwareKeyboardState();
    if (strippedPlover.enabled) {
      const epoch = inputEpoch;
      await requestPlover("reset_state", {});
      if (epoch !== inputEpoch) return;
      finalizePloverPreedit();
    }
    const undoGroup = `clipboard:${++clipboardPasteCounter}`;
    saveState(undoGroup);
    piecemealCursorIndex = null;
    // Preserve literal whitespace at both boundaries and keep it out of V7 decoding.
    const pasted = createIsland("fixed", text);
    clipboardPasteIslands.set(pasted, undoGroup);
    buffer.appendIsland(pasted);
    state.candidates = [];
    runInference();
    updateDisplay();
    clipboardMessage(`Pasted slot ${slot}. Undo with *.`);
  }
  function clearPloverPreedit(): void {
    if (strippedPlover.preeditIndex !== null) {
      const index = strippedPlover.preeditIndex;
      if (index >= 0 && index < buffer.getIslandCount()) {
        buffer.removeIslandAt(index);
      }
      strippedPlover.preeditIndex = null;
    }
  }
  function syncPloverPreeditIndex(): void {
    const islands = buffer.getIslands();
    strippedPlover.preeditIndex = null;
    for (let i = islands.length - 1; i >= 0; i--) {
      const island = islands[i];
      if (island.type === "plover" && island.phase === "preedit") {
        strippedPlover.preeditIndex = i;
        break;
      }
    }
  }
  function finalizePloverPreedit(): void {
    if (strippedPlover.preeditIndex !== null) {
      const index = strippedPlover.preeditIndex;
      if (index >= 0 && index < buffer.getIslandCount()) {
        const island = buffer.getIslandAt(index);
        if (island?.type === "plover") {
          buffer.replaceIslandAt(index, { ...island, phase: "committed" });
        }
      }
      strippedPlover.preeditIndex = null;
    }
  }
  function applyPloverOutput(
    output: PloverOutputItem[],
    {
      recordHistory,
      allowInference,
      finalizePreedit,
      uppercase,
    }: {
      recordHistory: boolean;
      allowInference: boolean;
      finalizePreedit: boolean;
      uppercase: boolean;
    },
  ): void {
    if (!Array.isArray(output)) return;
    const committedParts: string[] = [];
    let preeditText = "";
    const hadPreedit = strippedPlover.preeditIndex !== null;
    for (const item of output) {
      if (item.type === "committed") {
        committedParts.push(item.text || "");
      } else if (item.type === "preedit") {
        preeditText = item.text || "";
      }
    }

    const committedJoined = committedParts.join("");
    const combinedCommitted = finalizePreedit
      ? `${committedJoined}${preeditText}`
      : committedJoined;
    const committedText = applyCapsLockToText(
      ensureString(combinedCommitted),
      uppercase,
    );
    const normalizedPreedit = finalizePreedit
      ? ""
      : applyCapsLockToText(ensureString(preeditText), uppercase);
    const shouldSave =
      hadPreedit || committedText !== "" || normalizedPreedit !== "";
    if (shouldSave) {
      piecemealCursorIndex = null;
      undoManager.savePlover({ recordHistory: !!recordHistory, hadPreedit });
    }

    clearPloverPreedit();

    if (committedText) {
      buffer.appendIsland(createIsland("plover", committedText));
    }

    if (!finalizePreedit) {
      if (normalizedPreedit) {
        buffer.appendIsland(
          createIsland("plover", normalizedPreedit, { phase: "preedit" }),
        );
        strippedPlover.preeditIndex = buffer.getIslandCount() - 1;
      }
    }

    state.candidates = [];
    updateDisplay();
    if (allowInference) {
      runInference();
    }
  }
  async function handlePloverStroke(
    stroke: string,
    { oneShot }: { oneShot: boolean },
  ): Promise<void> {
    if (!strippedPlover.available || ploverPaused) return;
    const currentRequest = ++strippedPlover.requestId;
    const uppercase = keyboardCapsLockActive;
    try {
      const result = await requestPlover("translate", { stroke });
      if (currentRequest !== strippedPlover.requestId) return;
      applyPloverOutput(result.output ?? [], {
        recordHistory: oneShot,
        allowInference: true,
        finalizePreedit: oneShot,
        uppercase,
      });
      if (oneShot) {
        await requestPlover("reset_state", {});
      }
    } catch (e) {
      if (currentRequest !== strippedPlover.requestId) return;
      console.log(e);
      setPloverMessage(errorMessage(e, "Stripped Plover request failed."));
    }
  }
  async function togglePloverMode(): Promise<void> {
    if (!strippedPlover.available || ploverPaused) return;
    strippedPlover.enabled = !strippedPlover.enabled;
    setPloverMessage("");
    if (!strippedPlover.enabled) {
      finalizePloverPreedit();
      try {
        await requestPlover("reset_state", {});
      } catch (e) {
        console.log(e);
        setPloverMessage(errorMessage(e, "Failed to reset Stripped Plover."));
      }
      runInference();
    } else {
      runInference();
    }
    updateDisplay();
  }
  function appendText(text: string): void {
    if (keyboardCapsLockActive && text.length > 0) {
      text = applyCapsLockToText(text, true);
      state.pendingCapitalization = false;
    } else if (state.pendingCapitalization && text.length > 0) {
      text = text.charAt(0).toUpperCase() + text.slice(1);
      state.pendingCapitalization = false;
    }
    // Append a new Vietnamese (generic text) island
    buffer.appendIsland(createIsland("vietnamese", text));
  }
  function applyCapsLockToText(
    text: string,
    active = keyboardCapsLockActive,
  ): string {
    return active ? text.toLocaleUpperCase("vi") : text;
  }
  async function handleChord(stroke: string): Promise<void> {
    ports.event?.("v7-editor-stroke", { stroke });
    if (rawOutlineMode) {
      invalidateInference();
      const currentOutline = renderVisibleText(state.islands, []);
      if (stroke === "*") {
        const strokes = currentOutline ? currentOutline.split("/") : [];
        strokes.pop();
        const previousOutline = strokes.join("/");
        buffer.setIslands(
          previousOutline ? [createIsland("vietnamese", previousOutline)] : [],
        );
        if (!currentOutline) {
          ports.undoRawOutlineStroke();
        }
        state.candidates = [];
        piecemealCursorIndex = null;
        updateDisplay();
        return;
      }
      buffer.setIslands([
        createIsland(
          "vietnamese",
          currentOutline ? `${currentOutline}/${stroke}` : stroke,
        ),
      ]);
      state.candidates = [];
      piecemealCursorIndex = null;
      updateDisplay();
      return;
    }

    // On Android, Q+A on the physical QWERTY keyboard serializes to #S.
    // It is reserved for choosing another IME and is not a V7/Plover stroke.
    if (stroke === "#S-" || stroke === "#S") {
      ports.changeInputMethod();
      return;
    }

    if (stroke === "#") {
      await togglePloverMode();
      return;
    }

    if (strippedPlover.enabled) {
      const last = state.islands[state.islands.length - 1];
      if (stroke === "*" && last && clipboardPasteIslands.has(last)) {
        restoreState(clipboardPasteIslands.get(last));
        return;
      }
      await handlePloverStroke(stroke, { oneShot: false });
      return;
    }

    if (stroke === "*") {
      piecemealCursorIndex = null;
      restoreState();
      return;
    }

    let suppressPiecemealEntry = false;
    if (piecemealCursorIndex !== null) {
      const entryIndex = getPiecemealEntryIndex(stroke);
      if (entryIndex !== null) {
        const targets = findPiecemealSyllableTargets(state.islands);
        if (targets[entryIndex]) {
          piecemealCursorIndex = entryIndex;
          updateDisplay();
          return;
        }
      }

      if (
        state.candidates.length === 0 &&
        isLoneCandidateSelectionStroke(stroke)
      ) {
        piecemealCursorIndex = null;
        updateDisplay();
        return;
      }

      // Syllable+T exits piecemeal. With candidates it selects candidate 1 first;
      // without candidates it still appends the syllable normally.
      const firstCandidateAppendStroke = getFirstCandidateAppendStroke(stroke);
      if (firstCandidateAppendStroke && state.candidates.length === 0) {
        const appendedSyllable = decodeV7PermittedSyllableStroke(
          firstCandidateAppendStroke,
        );
        if (appendedSyllable !== null) {
          saveState();
          piecemealCursorIndex = null;
          appendText(appendedSyllable);
          runInference();
          return;
        }
      }

      // Other active candidate-selection chords keep their normal meaning inside piecemeal mode.
      const piecemealSelection =
        state.candidates.length > 0
          ? getCandidateSelectionMatch(stroke, state.candidates.length)
          : null;
      if (piecemealSelection) {
        suppressPiecemealEntry = true;
      } else {
        const decodedReplacement = decodeV7PermittedSyllableStroke(stroke);
        const replacement =
          decodedReplacement === null
            ? null
            : applyCapsLockToText(decodedReplacement);
        if (replacement !== null) {
          const targets = findPiecemealSyllableTargets(state.islands);
          const target = targets[piecemealCursorIndex];
          if (target) {
            saveState();
            buffer.setIslands(
              replacePiecemealSyllable(state.islands, target, replacement),
            );
            state.candidates = [];
            const nextTargets = findPiecemealSyllableTargets(state.islands);
            piecemealCursorIndex = getNextPiecemealCursorIndex(
              piecemealCursorIndex,
              nextTargets.length,
            );
            runInference();
            return;
          }
        }
        piecemealCursorIndex = null;
        suppressPiecemealEntry = true;
        updateDisplay();
      }
    }

    if (!suppressPiecemealEntry) {
      const entryIndex = getPiecemealEntryIndex(stroke);
      if (entryIndex !== null) {
        const targets = findPiecemealSyllableTargets(state.islands);
        if (targets[entryIndex]) {
          piecemealCursorIndex = entryIndex;
          updateDisplay();
          return;
        }
      }
    }

    // Dictionary classification owns both starred aliases and the starless corner.
    const dictionaryDecode = decodeDictionaryModeStroke(stroke);
    const ordinaryDecode = dictionaryDecode
      ? null
      : decodeCanonicalTwoSyllableStroke(stroke);
    const twoSyllableDecode = dictionaryDecode ?? ordinaryDecode;
    if (twoSyllableDecode) {
      ports.event?.("v7-editor-interpretation", {
        stroke,
        interpretation: dictionaryDecode ? "dictionary-v7" : "compositional-v7",
        sourceV7Stroke: twoSyllableDecode.canonicalStroke,
        sourceV7Code: twoSyllableDecode.v7Code,
      });
      piecemealCursorIndex = null;
      saveState();
      const uppercase = keyboardCapsLockActive;
      const capitalize = !uppercase && state.pendingCapitalization;
      state.pendingCapitalization = false;
      buffer.appendIsland(
        createIsland("v7", twoSyllableDecode.v7Code, {
          capitalization: uppercase ? "upper" : capitalize ? "initial" : "none",
          mode: dictionaryDecode ? "dictionary" : "compositional",
        }),
      );
      runInference();
      return;
    }

    // Emily symbols take precedence over single-syllable/ordinary Vietnamese interpretation.
    const emilyResult = handleEmilySymbol(stroke);
    if (emilyResult) {
      const repeatCount = emilyResult.repeat || 1;
      if (emilyResult.retroSpace) {
        if (buffer.getIslandCount() > 0 || emilyResult.capNext) {
          saveState();
          const changed = applyRetroactiveSpace(
            emilyResult.retroSpace,
            repeatCount,
          );
          state.pendingCapitalization = emilyResult.capNext || false;
          if (changed || emilyResult.capNext) {
            runInference();
            updateDisplay();
          }
        }
        return;
      }
      saveState();
      // spacing rules handled by shouldAddSpace; emilyResult.value already includes symbol
      buffer.appendIsland(
        createIsland(emilyResult.type, applyCapsLockToText(emilyResult.value), {
          spacing: {
            before: !!emilyResult.leftSpace,
            after: !!emilyResult.rightSpace,
          },
        }),
      );
      state.pendingCapitalization = emilyResult.capNext || false;
      piecemealCursorIndex = null;
      runInference();
      updateDisplay();
      return;
    }

    // Check single-stroke selection+syllable first; otherwise let normal handlers run.
    const selection =
      state.candidates.length > 0
        ? getCandidateSelectionMatch(stroke, state.candidates.length)
        : null;
    if (selection && selection.syllableStroke !== null) {
      const combinedPunctuation = PUNCTUATION_MAP[selection.syllableStroke];
      if (combinedPunctuation) {
        saveState();
        if (
          selectCandidate(selection.candidateIndex, {
            saveHistory: false,
            refreshDisplay: false,
          })
        ) {
          piecemealCursorIndex = null;
          buffer.appendIsland(createIsland("punctuation", combinedPunctuation));
          updateDisplay();
          return;
        }
      }
      const syllableText = decodeV7PermittedSyllableStroke(
        selection.syllableStroke,
      );
      if (syllableText !== null) {
        saveState();
        if (
          selectCandidate(selection.candidateIndex, {
            saveHistory: false,
            refreshDisplay: false,
          })
        ) {
          piecemealCursorIndex = null;
          appendText(syllableText);
          runInference();
          return;
        }
      }
    }

    // 2. Space Stroke: S-P
    if (stroke === "S-P") {
      saveState();
      piecemealCursorIndex = null;
      buffer.appendIsland(createIsland("spacing", " "));
      runInference();
      updateDisplay();
      return;
    }

    // 3. Punctuation
    if (PUNCTUATION_MAP[stroke]) {
      // Auto-select candidate if present
      if (state.candidates.length > 0) {
        selectCandidate(0);
      }

      saveState();
      piecemealCursorIndex = null;
      const punct = PUNCTUATION_MAP[stroke];
      buffer.appendIsland(createIsland("punctuation", punct));
      updateDisplay();
      return;
    }

    const text = decodeV7PermittedSyllableStroke(stroke);
    if (text !== null) {
      saveState();
      piecemealCursorIndex = null;
      appendText(text);
      runInference();
      return;
    }

    const firstCandidateAppendStroke =
      state.candidates.length === 0
        ? getFirstCandidateAppendStroke(stroke)
        : null;
    if (firstCandidateAppendStroke) {
      const appendedSyllable = decodeV7PermittedSyllableStroke(
        firstCandidateAppendStroke,
      );
      if (appendedSyllable !== null) {
        saveState();
        piecemealCursorIndex = null;
        appendText(appendedSyllable);
        runInference();
        return;
      }
    }

    if (selection && selection.syllableStroke === null) {
      selectCandidate(selection.candidateIndex);
      return;
    }

    if (strippedPlover.available) {
      await handlePloverStroke(stroke, { oneShot: true });
      return;
    }

    console.log("Ignored stroke:", stroke);
  }
  function runInference(): Promise<void> {
    const task = inferCurrentBuffer();
    pendingInference.add(task);
    void task.finally(() => pendingInference.delete(task));
    return task;
  }
  async function inferCurrentBuffer() {
    // Optimization: If no V7 islands, skip inference
    const hasV7 = state.islands.some((i) => i.type === "v7");
    if (!hasV7) {
      inferenceRunGeneration += 1;
      invalidateInference();
      state.candidates = [];
      inferenceErrorMessage =
        inferenceModelState === "error" ? context.modelError : "";
      updateDisplay();
      return;
    }

    invalidateInference();
    const runGeneration = ++inferenceRunGeneration;
    const epoch = inputEpoch;
    // Candidates from the previous buffer are no longer valid. Avoid flashing
    // raw V7 while the synchronous Android bridge produces their replacements.
    state.candidates = [];
    buffer.setIslands(
      state.islands.map((island) => {
        if (island.type !== "v7") return island;
        return createIsland("v7", island.value, {
          mode: island.mode,
          capitalization: island.capitalization,
          spacing: island.spacing,
        });
      }),
    );

    try {
      // Send the versioned protocol; mode is semantic data, not part of V7 code.
      const serverIslands = convertIslandsForInference(state.islands);

      const requestBody = JSON.stringify({
        version: 2,
        islands: serverIslands,
      });
      const data = await ports.infer(requestBody);
      if (epoch !== inputEpoch || runGeneration !== inferenceRunGeneration) {
        // A newer inference request has started; discard this response.
        return;
      }
      state.candidates = getInferenceCandidates(data);
      const bucketSizes = getDictionaryBucketSizes(data);
      const invalidV7Codes = getInvalidV7Codes(data);
      let dictionaryIndex = 0;
      let v7Index = 0;
      buffer.setIslands(
        state.islands.map((island) => {
          if (island.type !== "v7") return island;
          const invalidV7Code = invalidV7Codes[v7Index++];
          return island.mode === "dictionary"
            ? {
                ...island,
                validation: invalidV7Code ? "invalid" : "valid",
                dictionaryBucketSize: bucketSizes[dictionaryIndex++],
              }
            : { ...island, validation: invalidV7Code ? "invalid" : "valid" };
        }),
      );
      inferenceErrorMessage = "";
      updateDisplay();
    } catch (e) {
      if (epoch !== inputEpoch || runGeneration !== inferenceRunGeneration)
        return;
      console.error("Inference failed", e);
      inferenceErrorMessage =
        e instanceof Error
          ? e.message
          : `Unknown inference error: ${String(e)}`;
      state.candidates = [];
      updateDisplay();
    }
  }
  function getInferenceCandidates(data: unknown): string[][] {
    if (!data || typeof data !== "object") {
      throw new Error("Inference server returned an invalid response");
    }
    const candidates = (data as { candidates?: unknown }).candidates;
    if (
      !Array.isArray(candidates) ||
      !candidates.every(
        (candidate) =>
          Array.isArray(candidate) &&
          candidate.every((part) => typeof part === "string"),
      )
    ) {
      throw new Error("Inference response is missing valid candidates");
    }
    return candidates;
  }
  function getDictionaryBucketSizes(data: unknown): number[] {
    if (!data || typeof data !== "object") return [];
    const sizes = (data as { dictionaryBucketSizes?: unknown })
      .dictionaryBucketSizes;
    if (sizes === undefined) return [];
    if (
      !Array.isArray(sizes) ||
      !sizes.every((size) => Number.isSafeInteger(size) && size >= 0)
    ) {
      throw new Error("Inference response has invalid dictionary bucket sizes");
    }
    return sizes as number[];
  }
  function getInvalidV7Codes(data: unknown): boolean[] {
    if (!data || typeof data !== "object") return [];
    const invalid = (data as { invalidV7Codes?: unknown }).invalidV7Codes;
    if (invalid === undefined) return [];
    if (
      !Array.isArray(invalid) ||
      !invalid.every((value) => typeof value === "boolean")
    ) {
      throw new Error("Inference response has invalid V7-code statuses");
    }
    return invalid as boolean[];
  }
  function selectCandidate(
    index: number,
    options: SelectCandidateOptions = {
      saveHistory: true,
      refreshDisplay: true,
    },
  ): boolean {
    const nextIslands = selectCandidateIslands(
      state.candidates,
      index,
      state.islands,
    );
    if (!nextIslands) return false;
    if (options.saveHistory) {
      saveState();
    }
    buffer.setIslands(nextIslands);
    state.candidates = [];
    piecemealCursorIndex = null;
    if (options.refreshDisplay) {
      updateDisplay();
    }
    return true;
  }
  function resetHardwareKeyboardState(): void {
    keyboardStrokeTracker.reset();
  }

  let operations = Promise.resolve();
  function enqueue(operation: () => void | Promise<void>) {
    const epoch = inputEpoch;
    const capsLock = keyboardCapsLockActive;
    operations = operations
      .then(async () => {
        if (epoch !== inputEpoch) return;
        keyboardCapsLockActive = capsLock;
        await operation();
        while (pendingInference.size) await Promise.all([...pendingInference]);
      })
      .catch((error) => {
        ports.message(errorMessage(error, "Composition operation failed"));
      });
    return operations;
  }
  function key(event: ImeKey) {
    if (event.epoch !== inputEpoch) return Promise.resolve();
    keyboardCapsLockActive = event.capsLock;
    if (isEffectiveTelexMode()) return Promise.resolve();
    if (event.ctrlKey || event.altKey || event.metaKey) {
      resetHardwareKeyboardState();
      return Promise.resolve();
    }
    if (event.action === "keyup") {
      const stroke = keyboardStrokeTracker.keyUp(event.key, event.code);
      return stroke ? enqueue(() => handleChord(stroke)) : operations;
    }
    if (event.repeat) return operations;
    const ploverActive = strippedPlover.enabled;
    if (
      !ploverActive &&
      event.key.length === 1 &&
      ((event.shiftKey && /[a-z]/i.test(event.key)) || /[0-9]/.test(event.key))
    ) {
      return enqueue(async () => {
        saveState();
        piecemealCursorIndex = null;
        buffer.appendIsland(createIsland("capital", event.key.toUpperCase()));
        await runInference();
      });
    }
    if (!ploverActive && event.key === "Enter") {
      return enqueue(async () => {
        if (state.candidates.length) selectCandidate(0);
        piecemealCursorIndex = null;
        buffer.trimTrailingSpaceFromLastVietnameseIsland();
        saveState();
        buffer.appendIsland(createIsland("spacing", "\n"));
        await runInference();
      });
    }
    const mapped = mapKeyUnique(event.key);
    if (mapped)
      keyboardStrokeTracker.keyDown(event.key, { physicalKey: event.code });
    return operations;
  }
  function configure(next: ImeInputContext) {
    if (next.epoch !== inputEpoch) clear(next.epoch);
    if (
      next.steno !== context.steno ||
      next.telex !== context.telex ||
      next.rawOutline !== context.rawOutline
    )
      resetHardwareKeyboardState();
    context = next;
    inputEpoch = next.epoch;
    rawOutlineMode = next.rawOutline;
    stenoModeEnabled = next.steno;
    ploverPaused = next.ploverPaused;
    inferenceModelState = next.modelState;
    strippedPlover.available = next.ploverAvailable;
  }
  function clear(epoch = inputEpoch) {
    context = { ...context, epoch };
    inputEpoch = epoch;
    resetHardwareKeyboardState();
    invalidateInference();
    strippedPlover.requestId++;
    strippedPlover.preeditIndex = null;
    buffer.reset();
    state.candidates = [];
    piecemealCursorIndex = null;
    inferenceErrorMessage = "";
    updateDisplay();
  }
  return {
    key,
    configure,
    clear,
    refresh: updateDisplay,
    reset: resetHardwareKeyboardState,
    chord: (stroke: string, capsLock = false) => {
      keyboardCapsLockActive = capsLock;
      return enqueue(() => handleChord(stroke));
    },
    select: (index: number) =>
      enqueue(() => {
        selectCandidate(index);
      }),
    clipboard: (slot: number, copy: boolean, selected?: string | null) =>
      enqueue(() =>
        copy ? copyClipboardSlot(slot, selected) : pasteClipboardSlot(slot),
      ),
    infer: () => enqueue(() => runInference()),
  };
}
