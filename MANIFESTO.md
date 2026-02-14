# Manifesto

These are non-negotiable product requirements for the V7 UI. Treat them as a living checklist.

## Requirements
- [ ] Remove timeouts everywhere.
- [ ] Dictionary import/export: Display loading state when the request is in progress.
- [ ] Emily's symbols: Now we have a rope data structure, implementing retroactive space insertion/deletion is easy. Look into the code at https://github.com/EPLHREU/emily-symbols and then reimplement the retroactive space insertion/deletion.
- [ ] Dictionary management should be a modal dialog.
- [ ] Make it beautiful!
- [ ] Dictionary names have to be displayed accurately.
- [ ] There should be no "first writable dictionary" option; it's confusing and it hurts.
- [ ] Every dictionary can be exported, renamed and deleted. Read only dictionaries too. For read only dictionaries, only the content can't be modified.
- [ ] To test and modify the application, use **docker compose build**, **docker compose up**, etc. **DO NOT SHY AWAY FROM THESE COMMANDS.**
- [ ] Frontend data invalidation: There is a refresh button, but the frontend must also intelligently detect when the data has changed and refresh too.
