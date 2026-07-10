import { HistoryFrameFields, HistorySaveOptions, TextBuffer } from "./textBuffer";
import { requireUiCoreProvider, type UndoPolicyCore } from "./uiCoreProvider";

type SaveGroup = string | undefined;

interface SavePloverOptions {
  recordHistory: boolean;
  hadPreedit: boolean;
}

interface UndoManagerOptions {
  getPiecemealCursorIndex?: () => number | null;
}

interface UndoPolicySaveInstruction {
  group: string | null;
  piecemealCursorIndex: number | null;
}

function parseHistoryOptions(instructionJson: string): HistorySaveOptions | string | undefined {
  const instruction = JSON.parse(instructionJson) as UndoPolicySaveInstruction;
  const group = instruction.group ?? undefined;
  const piecemealCursorIndex = instruction.piecemealCursorIndex ?? undefined;
  if (piecemealCursorIndex === undefined) {
    return group;
  }
  return group === undefined
    ? { piecemealCursorIndex }
    : { group, piecemealCursorIndex };
}

export function createUndoManager(
  buffer: TextBuffer,
  onUndoApplied: (fields: HistoryFrameFields) => void,
  options: UndoManagerOptions = {}
) {
  let policy: UndoPolicyCore | null = null;

  function getPolicy() {
    if (!policy) {
      policy = requireUiCoreProvider().createUndoPolicy();
    }
    return policy;
  }

  function save(group?: SaveGroup): void {
    const instructionJson = getPolicy().saveJson(
      JSON.stringify(group ?? null),
      JSON.stringify(options.getPiecemealCursorIndex?.() ?? null)
    );
    buffer.save(parseHistoryOptions(instructionJson));
  }

  function savePlover({ recordHistory, hadPreedit }: SavePloverOptions): void {
    const instructionJson = getPolicy().savePloverJson(
      recordHistory,
      hadPreedit,
      JSON.stringify(options.getPiecemealCursorIndex?.() ?? null)
    );
    buffer.save(parseHistoryOptions(instructionJson));
  }

  function undo(): boolean {
    const fields = buffer.undo();
    if (fields) {
      getPolicy().undoApplied();
      onUndoApplied(fields);
    }
    return !!fields;
  }

  return {
    save,
    savePlover,
    undo
  };
}
