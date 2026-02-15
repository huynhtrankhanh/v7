import { TextBuffer } from "./textBuffer";

const PLOVER_GROUP_PREFIX = "plover:";

type SaveGroup = string | undefined;

interface SavePloverOptions {
  recordHistory: boolean;
  hadPreedit: boolean;
}

export function createUndoManager(buffer: TextBuffer, onUndoApplied: () => void) {
  let ploverGroupCounter = 0;
  let hasActivePloverGroup = false;

  function save(group?: SaveGroup): void {
    hasActivePloverGroup = false;
    buffer.save(group);
  }

  function savePlover({ recordHistory, hadPreedit }: SavePloverOptions): void {
    if (recordHistory) {
      hasActivePloverGroup = false;
      buffer.save();
      return;
    }

    if (!hadPreedit || !hasActivePloverGroup) {
      ploverGroupCounter += 1;
      hasActivePloverGroup = true;
    }

    buffer.save(`${PLOVER_GROUP_PREFIX}${ploverGroupCounter}`);
  }

  function undo(): boolean {
    const undone = buffer.undo();
    if (undone) {
      hasActivePloverGroup = false;
      onUndoApplied();
    }
    return undone;
  }

  return {
    save,
    savePlover,
    undo
  };
}
