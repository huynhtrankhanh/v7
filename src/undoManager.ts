import { HistoryFrameFields, HistorySaveOptions, TextBuffer } from "./textBuffer";

const PLOVER_GROUP_PREFIX = "plover:";

type SaveGroup = string | undefined;

interface SavePloverOptions {
  recordHistory: boolean;
  hadPreedit: boolean;
}

interface UndoManagerOptions {
  getPiecemealCursorIndex?: () => number | null;
}

function buildHistoryOptions(
  group: SaveGroup,
  getPiecemealCursorIndex?: () => number | null
): HistorySaveOptions | string | undefined {
  const piecemealCursorIndex = getPiecemealCursorIndex?.();
  if (piecemealCursorIndex === null || piecemealCursorIndex === undefined) {
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
  let ploverGroupCounter = 0;
  let hasActivePloverGroup = false;

  function save(group?: SaveGroup): void {
    hasActivePloverGroup = false;
    buffer.save(buildHistoryOptions(group, options.getPiecemealCursorIndex));
  }

  function savePlover({ recordHistory, hadPreedit }: SavePloverOptions): void {
    if (recordHistory) {
      hasActivePloverGroup = false;
      buffer.save(buildHistoryOptions(undefined, options.getPiecemealCursorIndex));
      return;
    }

    if (!hadPreedit || !hasActivePloverGroup) {
      ploverGroupCounter += 1;
      hasActivePloverGroup = true;
    }

    buffer.save(buildHistoryOptions(`${PLOVER_GROUP_PREFIX}${ploverGroupCounter}`, options.getPiecemealCursorIndex));
  }

  function undo(): boolean {
    const fields = buffer.undo();
    if (fields) {
      hasActivePloverGroup = false;
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
