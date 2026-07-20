const PLOVER_DICTIONARY_DIALOG_HTML = `
  <dialog id="plover-dictionary-dialog">
    <div class="plover-dialog-content">
      <div class="plover-dialog-header">
        <h2>Dictionary Management</h2>
        <button id="plover-dictionary-close" type="button">Close</button>
      </div>
      <div class="plover-tabs" role="tablist">
        <button
          id="plover-tab-dictionaries"
          class="plover-tab active"
          type="button"
          data-panel="plover-panel-dictionaries"
        >
          Dictionaries
        </button>
        <button
          id="plover-tab-entries"
          class="plover-tab"
          type="button"
          data-panel="plover-panel-entries"
        >
          Entries
        </button>
        <button
          id="plover-tab-lookup"
          class="plover-tab"
          type="button"
          data-panel="plover-panel-lookup"
        >
          Lookup
        </button>
        <button
          id="plover-tab-diagnostics"
          class="plover-tab"
          type="button"
          data-panel="plover-panel-diagnostics"
        >
          Diagnostics
        </button>
      </div>
      <div id="plover-panel-dictionaries" class="plover-panel active">
        <div class="plover-section">
          <div class="plover-row">
            <span class="plover-section-title">Dictionaries</span>
            <span id="plover-solo-status" class="plover-badge">Normal</span>
            <button id="plover-end-solo" type="button" disabled>
              End solo
            </button>
            <button id="plover-refresh" type="button">Refresh</button>
          </div>
          <div id="plover-dictionary-list"></div>
        </div>
        <details class="plover-section">
          <summary>Import</summary>
          <div class="plover-grid">
            <input
              type="text"
              id="plover-dict-name"
              placeholder="Dictionary name"
            />
            <select id="plover-dict-type">
              <option value="json">JSON</option>
              <option value="python">Python</option>
            </select>
            <label>
              <input type="checkbox" id="plover-dict-merge" />
              Merge
            </label>
            <input
              type="file"
              id="plover-dict-file"
              accept=".json,.py,application/json,text/x-python,text/plain"
            />
          </div>
          <div class="plover-row">
            <button id="plover-dict-upload" type="button">Upload</button>
          </div>
        </details>
      </div>
      <div id="plover-panel-entries" class="plover-panel">
        <div class="plover-section">
          <span class="plover-section-title">Search</span>
          <div class="plover-grid three">
            <select id="plover-entry-search-dict"></select>
            <input
              type="text"
              id="plover-entry-search-stroke"
              placeholder="Stroke"
            />
            <input
              type="text"
              id="plover-entry-search-output"
              placeholder="Translation"
            />
            <select id="plover-entry-search-match">
              <option value="substring">Substring</option>
              <option value="prefix">Prefix</option>
            </select>
            <select id="plover-entry-sort">
              <option value="alphabetic">Alphabetic</option>
              <option value="short_first">Short strokes</option>
              <option value="long_first">Long strokes</option>
            </select>
            <button id="plover-entry-search" type="button">Search</button>
          </div>
          <div id="plover-entry-results"></div>
          <div class="plover-row">
            <button id="plover-entry-prev" type="button" disabled>
              Previous
            </button>
            <span id="plover-entry-page" class="plover-muted">Page 1</span>
            <button id="plover-entry-next" type="button" disabled>Next</button>
          </div>
        </div>
        <div class="plover-section">
          <span class="plover-section-title">Edit</span>
          <div class="plover-grid">
            <select id="plover-entry-dict"></select>
            <input
              type="text"
              id="plover-entry-stroke"
              placeholder="Stroke (e.g. TEFT)"
            />
            <input
              type="text"
              id="plover-entry-translation"
              placeholder="Translation"
            />
          </div>
          <div class="plover-entry-buttons">
            <button id="plover-entry-add" type="button">Add</button>
            <button id="plover-entry-update" type="button">Update</button>
            <button id="plover-entry-remove" type="button">Remove</button>
          </div>
          <div id="plover-entry-message"></div>
        </div>
      </div>
      <div id="plover-panel-lookup" class="plover-panel">
        <div class="plover-section">
          <span class="plover-section-title">Lookup</span>
          <div class="plover-grid">
            <input
              type="text"
              id="plover-lookup-stroke"
              placeholder="Stroke"
            />
            <button id="plover-lookup-stroke-run" type="button">
              Lookup stroke
            </button>
            <input
              type="text"
              id="plover-lookup-translation"
              placeholder="Translation"
            />
            <button id="plover-lookup-translation-run" type="button">
              Lookup translation
            </button>
          </div>
          <div id="plover-lookup-results"></div>
          <div id="plover-lookup-message"></div>
        </div>
      </div>
      <div id="plover-panel-diagnostics" class="plover-panel">
        <div class="plover-section">
          <span class="plover-section-title">Upload history</span>
          <p class="plover-muted">
            Includes device and WebView versions plus timing phases from both
            Android WebViews. Dictionary contents are not recorded.
          </p>
          <div class="plover-row">
            <button id="plover-diagnostics-refresh" type="button">
              Refresh
            </button>
            <button id="plover-diagnostics-copy" type="button">Copy</button>
            <button id="plover-diagnostics-clear" type="button">Clear</button>
          </div>
          <pre id="plover-diagnostics-output">Open this tab to load diagnostics.</pre>
        </div>
      </div>
      <div id="plover-message"></div>
    </div>
  </dialog>
`;

export function mountPloverDictionaryUi(): HTMLDialogElement {
  const existing = document.querySelector<HTMLDialogElement>(
    "#plover-dictionary-dialog",
  );
  if (existing) return existing;

  const template = document.createElement("template");
  template.innerHTML = PLOVER_DICTIONARY_DIALOG_HTML;
  document.body.appendChild(template.content.cloneNode(true));

  const dialog = document.querySelector<HTMLDialogElement>(
    "#plover-dictionary-dialog",
  );
  if (!dialog) {
    throw new Error("Unable to mount the Plover dictionary dialog");
  }
  return dialog;
}
