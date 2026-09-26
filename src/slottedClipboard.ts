export const SLOT_STORAGE_KEY = "v7.clipboard-slots.v1";

/** Private app slots, independent of the operating system clipboard. */
export function createSlottedClipboard(getStorage: () => Storage) {
  let slots: (string | null)[] = Array(10).fill(null);
  let persistent = true;
  try {
    const saved: unknown = JSON.parse(
      getStorage().getItem(SLOT_STORAGE_KEY) ?? "null",
    );
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
  function persist(): boolean {
    try {
      getStorage().setItem(SLOT_STORAGE_KEY, JSON.stringify(slots));
      persistent = true;
    } catch {
      persistent = false;
    }
    return persistent;
  }
  return {
    get: (slot: number) => slots[slot] ?? null,
    isPersistent: () => persistent,
    set(slot: number, text: string | null): boolean {
      if (!Number.isInteger(slot) || slot < 0 || slot > 9) return false;
      slots[slot] = text || null;
      return persist();
    },
    clearAll(): boolean {
      slots = Array(10).fill(null);
      return persist();
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
  // Physical digit codes also work on layouts whose number row produces symbols.
  const digit =
    /^(?:Digit|Numpad)([0-9])$/.exec(event.code)?.[1] ??
    (/^[0-9]$/.test(event.key) ? event.key : null);
  return digit === null ? null : { slot: Number(digit), copy: event.altKey };
}

export function mountClipboardSlots(actions: {
  copy(slot: number): void;
  paste(slot: number): void;
  clear(slot: number): void;
  clearAll(): void;
}) {
  const style = document.createElement("style");
  style.textContent = `
    #clipboard-slots { flex: 0 0 auto; background: #fff; border-bottom: 1px solid #cbd5e1; padding: 8px 16px; color: #0f172a; font: 14px/1.4 sans-serif; }
    #clipboard-slots[hidden] { display: none; }
    #clipboard-slots summary { cursor: pointer; font-weight: 600; }
    #clipboard-slots .slot-list { max-height: 32dvh; overflow: auto; }
    #clipboard-slots .slot-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid #e2e8f0; }
    #clipboard-slots .slot-preview { flex: 1; min-width: 100px; white-space: pre-wrap; overflow-wrap: anywhere; }
    #clipboard-slots button { font: inherit; padding: 5px 9px; cursor: pointer; }
    #clipboard-slot-status { margin: 4px 0 0; }
  `;
  document.head.appendChild(style);
  const panel = document.createElement("section");
  panel.id = "clipboard-slots";
  panel.setAttribute("aria-label", "Clipboard slots");
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Clipboard slots · Alt+0–9 copy · Ctrl+0–9 paste";
  details.appendChild(summary);
  details.addEventListener("toggle", () =>
    window.dispatchEvent(new Event("resize")),
  );
  const help = document.createElement("p");
  help.textContent =
    "Copy selected editor text, or the whole visible buffer. Paste appends exact text; undo with *. Saved locally in this browser, including after reload.";
  details.appendChild(help);
  const list = document.createElement("div");
  list.className = "slot-list";
  details.appendChild(list);
  const rows = Array.from({ length: 10 }, (_, slot) => {
    const row = document.createElement("div");
    row.className = "slot-row";
    const label = document.createElement("strong");
    label.textContent = String(slot);
    const preview = document.createElement("span");
    preview.className = "slot-preview";
    row.append(label, preview);
    const buttons = ["Copy", "Paste", "Clear"].map((name) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.setAttribute("aria-label", `${name} slot ${slot}`);
      button.addEventListener("click", () => {
        if (name === "Copy") actions.copy(slot);
        else if (name === "Paste") actions.paste(slot);
        else actions.clear(slot);
      });
      row.appendChild(button);
      return button;
    });
    list.appendChild(row);
    return { preview, buttons };
  });
  const clearAll = document.createElement("button");
  clearAll.type = "button";
  clearAll.textContent = "Clear all slots";
  clearAll.title = "Remove every saved slot. Clearing slots cannot be undone.";
  clearAll.addEventListener("click", actions.clearAll);
  details.appendChild(clearAll);
  const status = document.createElement("p");
  status.id = "clipboard-slot-status";
  status.setAttribute("role", "status");
  panel.append(details, status);
  // Keep editor selections intact while using mouse buttons.
  panel.addEventListener("mousedown", (event) => {
    if ((event.target as Element).closest("button")) event.preventDefault();
  });
  const shell = document.getElementById("inference-shell");
  if (document.body.classList.contains("ime-surface") && shell) {
    shell.insertBefore(panel, document.getElementById("workbench"));
  } else {
    document.body.insertBefore(panel, shell);
  }
  return {
    contains: (target: Element | null) => !!target && panel.contains(target),
    update(visible: boolean, get: (slot: number) => string | null) {
      panel.hidden = !visible;
      rows.forEach(({ preview, buttons }, slot) => {
        const text = get(slot);
        preview.textContent =
          text === null
            ? "Empty"
            : text.length > 120
              ? `${text.slice(0, 120)}…`
              : text;
        preview.title = text ?? "";
        buttons[1].disabled = buttons[2].disabled = text === null;
      });
      clearAll.disabled = rows.every((_, slot) => get(slot) === null);
    },
    message(text: string) {
      status.textContent = text;
      window.dispatchEvent(new Event("resize"));
    },
  };
}
