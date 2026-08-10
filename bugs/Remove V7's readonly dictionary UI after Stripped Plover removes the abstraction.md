# Remove V7's `readonly` dictionary UI after Stripped Plover removes the abstraction

> **Blocked by / depends on:** `huynhtrankhanh/strippedplover#<READONLY-ISSUE-NUMBER>`
>
> This issue should be completed against a Stripped Plover revision in which the upstream `readonly` dictionary abstraction has been removed.

## Summary

V7 currently consumes Stripped Plover's `readonly` dictionary property and turns it into application/UI semantics.

Once Stripped Plover removes that abstraction, V7 must remove its corresponding `readonly` handling and model Python dictionaries correctly.

A Python dictionary is not a read-only dictionary.

It is a code-backed dictionary which does not expose concrete `(stroke, translation)` entries.

Dictionary-level management such as Rename and Delete remains valid.

## Current V7 behavior

V7 includes `readonly` in its dictionary model:

```ts
interface PloverDictionary {
    ...
    readonly?: boolean;
    ...
}
```

The dictionary-management UI then uses it to:

- display `(read-only)` in selectors;
- display a `read-only` badge;
- disable Add / Update / Remove;
- change “View / edit entries” to “View entries”;
- disable Rename;
- disable Delete;
- reject entry-management actions in the UI.

This behavior follows naturally from the upstream property name, but the property represents the wrong concept.

In particular, disabling Rename and Delete for a Python dictionary is incorrect.

## Desired behavior

After the upstream dependency is resolved, V7 should model the distinction as:

```text
JSON dictionary
    concrete entries: yes
    entry editor: yes
    rename: yes
    delete: yes

Python dictionary
    concrete entries: no
    entry editor: no / not applicable
    rename: yes
    delete: yes
```

Python dictionaries should not be labelled “read-only”.

There are simply no concrete entries for V7 to display or mutate.

## Required V7 changes

Once the pinned Stripped Plover revision exposes the corrected model:

- remove `readonly` from `PloverDictionary`;
- remove all `read-only` labels and badges;
- remove `readonly` checks from dictionary action construction;
- do not gate Rename or Delete on entry mutability;
- stop using `readonly` to decide whether Add / Update / Remove buttons are available;
- determine whether an entry editor applies from dictionary type or an explicit upstream capability;
- do not present a concrete entry editor for Python dictionaries;
- retain dictionary-level actions for Python dictionaries.

## Android import path

V7's Android dictionary importer also directly persists dictionary metadata.

The current Python-dictionary path writes the upstream `readonly` representation into the Stripped Plover SQLite database.

When updating to the upstream revision that removes `readonly`, this native importer must be updated at the same time so it writes the new canonical schema/model.

The Android wrapper should not preserve a legacy `readonly` concept after Stripped Plover removes it.

## Stripped Plover pin

V7 vendors/pins a specific Stripped Plover revision.

This issue should therefore include updating:

```text
ime-android/STRIPPED_PLOVER_REVISION
```

to a revision containing the upstream fix.

The V7 cleanup must not be treated as an independent workaround while the pinned engine continues exposing the old model.

The intended dependency order is:

```text
Stripped Plover removes `readonly`
              ↓
V7 updates pinned Stripped Plover revision
              ↓
V7 removes downstream `readonly` model/UI/import handling
```

## Not part of this issue

This issue is not about the numeric RTFCRE parser bug.

That is an independent Stripped Plover correctness issue and should remain separate.

Likewise, this issue should not introduce a new V7-local synonym for `readonly`.

If future requirements call for protected/built-in dictionaries, that should be an explicit capability with the intended semantics rather than another overloaded entry-mutability flag.

## Acceptance criteria

- V7 pins a Stripped Plover revision where the upstream `readonly` abstraction is removed.
- `PloverDictionary` no longer contains `readonly`.
- V7 no longer displays “read-only” dictionary UI.
- Python dictionaries are not presented as having protected concrete entries.
- Python dictionaries do not expose an individual-entry editor.
- Python dictionaries can be renamed.
- Python dictionaries can be deleted.
- JSON dictionaries retain normal entry editing.
- Android dictionary import follows the updated Stripped Plover schema and does not recreate a legacy `readonly` field/meaning.
- There is no V7-local replacement for the removed generic `readonly` abstraction.