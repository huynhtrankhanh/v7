# Bug Fixing
* The script.js file has grown too big. Install Vite, use TypeScript, and split script.js into modules.
* Undo is currently very buggy with unundoable islands everywhere. Make sure every stroke can be undone normally.
* When in Stripped Plover mode all actions are forwarded to Stripped Plover, so independent handling of number input, enter, capital letters has to be suspended.
* **RULES PERTAINING TO UNDO:**
  * When Plover mode is enabled, all undo commands are forwarded to Plover
  * When Plover mode is disabled:
    * As the frontend has no awareness of the internal state of Plover, it can only treat the whole text inserted by Plover as a unified block, and undo deletes the whole block.
* Abstract the text buffer handling into a separate module and test it thoroughly, including using property tests.
