export const SLOT_STORAGE_KEY = "v7.clipboard-slots.v1";

export interface ClipboardSlotStorage {
  load(): unknown;
  save(slot: number, text: string | null): boolean;
  clear(): boolean;
}

/** Native storage is authoritative; refresh before reads so Settings edits are live. */
export function createSlottedClipboard(storage: ClipboardSlotStorage) {
  let slots: (string | null)[] = Array(10).fill(null);
  let persistent = true;
  function refresh() {
    if (!persistent) return;
    try {
      const saved = storage.load();
      if (
        Array.isArray(saved) &&
        saved.length === 10 &&
        saved.every((value) => value === null || typeof value === "string")
      ) {
        slots = saved.map((value) => (value === "" ? null : value));
      }
    } catch {
      persistent = false;
    }
  }
  refresh();
  return {
    snapshot() {
      refresh();
      return slots.slice();
    },
    get(slot: number) {
      refresh();
      return slots[slot] ?? null;
    },
    isPersistent: () => persistent,
    set(slot: number, text: string | null): boolean {
      if (!Number.isInteger(slot) || slot < 0 || slot > 9) return false;
      refresh();
      slots[slot] = text || null;
      try {
        persistent = storage.save(slot, slots[slot]);
      } catch {
        persistent = false;
      }
      return persistent;
    },
    clearAll(): boolean {
      slots = Array(10).fill(null);
      try {
        persistent = storage.clear();
      } catch {
        persistent = false;
      }
      return persistent;
    },
  };
}

export function clipboardShortcut(
  event: KeyboardEvent,
): { slot: number; copy: boolean } | null {
  if (
    event.metaKey ||
    event.shiftKey ||
    event.ctrlKey === event.altKey ||
    event.isComposing ||
    event.getModifierState("AltGraph")
  )
    return null;
  const digit =
    /^(?:Digit|Numpad)([0-9])$/.exec(event.code)?.[1] ??
    (/^[0-9]$/.test(event.key) ? event.key : null);
  return digit === null ? null : { slot: Number(digit), copy: event.altKey };
}

/** Only occupied slots appear in the IME; management lives in native Settings. */
export function mountClipboardSlots(actions: {
  paste(slot: number): void;
  message(text: string): void;
}) {
  const panel = document.createElement("section");
  panel.id = "clipboard-slots";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Saved clipboard items");
  const buttons = Array.from({ length: 10 }, (_, slot) => {
    const button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", () => actions.paste(slot));
    panel.appendChild(button);
    return button;
  });
  panel.addEventListener("mousedown", (event) => event.preventDefault());
  const shell = document.getElementById("inference-shell");
  if (!shell)
    throw new Error("Clipboard shortcuts require the Android IME surface.");
  shell.insertBefore(panel, document.getElementById("workbench"));
  return {
    contains: (target: Element | null) => !!target && panel.contains(target),
    update(enabled: boolean, slots: readonly (string | null)[]) {
      let occupied = false;
      buttons.forEach((button, slot) => {
        const text = slots[slot] ?? null;
        button.hidden = text === null;
        if (text !== null) {
          occupied = true;
          const preview = text.replace(/\s+/g, " ").trim();
          button.textContent = `${slot} · ${preview.slice(0, 24)}${preview.length > 24 ? "…" : ""}`;
          button.setAttribute(
            "aria-label",
            `Paste slot ${slot}: ${preview.slice(0, 120)}`,
          );
          button.title = `Ctrl+${slot} · ${text}`;
        }
      });
      panel.hidden = !enabled || !occupied;
    },
    message: actions.message,
  };
}
