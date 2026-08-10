# Add translation dialog does not satisfy its keyboard/touch interaction contract and can mutate the wrong dictionary

## Summary

The Android **Add Stripped Plover translation** dialog does not currently satisfy its stated interaction goals.

The underlying editor-mode design is mostly correct:

- the Outline field uses Raw outline mode;
- the Translation field uses the user's ordinary V7/Emily/Stripped Plover mode;
- the IME is shown with the dialog;
- the dialog is not dismissed by an accidental outside touch.

However, the form-level interaction model has several bugs involving keyboard navigation, dictionary selection, submission, touch behavior, and feedback.

Some of these are not merely UX problems. They can cause the translation to be written to an unintended dictionary or silently replace an existing entry.

The most important invariant that is currently violated is:

> **Navigating the form must never change form data.**

At present, simply moving keyboard focus through dictionary choices changes the selected destination dictionary.

There are also failures in Escape routing, Enter/multiline behavior, modifier handling, overwrite safety, and repeated submission.

## Intended behavior

The Add translation command is intended to provide a fully keyboard-accessible native form where the user can:

1. chord an outline in Raw outline mode;
2. move to the Translation field and enter ordinary text using the normal IME mode;
3. explicitly choose the destination dictionary;
4. submit the translation;
5. use the entire dialog by hardware keyboard as well as touch.

The documented interaction contract additionally promises:

- `Tab` / `Shift+Tab` navigation;
- `Escape` to close;
- `Enter`/editor actions to advance or submit;
- keyboard-accessible dictionary selection;
- numbered dictionary shortcuts;
- ordinary radio-button arrow navigation;
- one-tap dictionary selection;
- visible status/feedback.

The implementation only partially meets this contract.

---

## Bug 1: keyboard focus changes the selected dictionary

This is the most serious interaction bug.

Each dictionary `RadioButton` has an `OnFocusChangeListener` which checks that dictionary whenever it receives focus.

Conceptually:

```java
choice.setOnFocusChangeListener((view, hasFocus) -> {
    if (hasFocus) {
        dictionaryGroup.check(choice.getId());
        ...
    }
});
```

At the same time, custom `Tab` navigation moves through every dictionary choice with `requestFocus()`.

Therefore:

```text
Tab to dictionary A
    ↓
A becomes selected

Tab to dictionary B
    ↓
B becomes selected

Tab to dictionary C
    ↓
C becomes selected
```

Merely exploring the form changes its submitted value.

`Shift+Tab` has the same side effect in reverse.

### Why this is wrong

Focus and selection are separate concepts.

Focus means:

> this is the control currently receiving keyboard interaction

Selection means:

> this is the dictionary the user has chosen as the destination

Moving focus must not silently perform the second operation.

This is especially dangerous because the destination dictionary determines where persistent data will be written.

### Expected behavior

Keyboard focus should be navigable without changing the current destination.

For a normal radio group, a better interaction model is:

- `Tab` enters/leaves the radio group;
- arrow keys change the selected radio item;
- Space selects the focused item where appropriate;
- explicit numbered shortcuts select a dictionary;
- clicking/tapping selects a dictionary.

At minimum, `requestFocus()` must not itself mean `check()`.

---

## Bug 2: the dialog silently selects the first dictionary even though it asks the user to choose one

After dictionaries load, `populateDictionaryChoices()` automatically checks the first dictionary.

The UI then displays:

```text
Choose the destination dictionary.
```

and enables **Add translation**.

This means the user can:

1. enter an outline;
2. press Enter to reach Translation;
3. enter a translation;
4. press Enter again;

and the form writes to the first dictionary without the user ever explicitly choosing a destination.

This contradicts the purpose of the dialog: the user is supposed to choose which dictionary receives the translation.

It also compounds Bug 1 because whichever dictionary happened to receive focus most recently can silently become the destination.

### Expected behavior

Unless there is a deliberately specified default-dictionary policy, no dictionary should initially be selected.

The Add action should remain unavailable until:

- outline is valid/non-empty;
- translation is non-empty;
- the user has explicitly selected a destination dictionary.

If automatic destination selection is desired, it must be an intentional, visible product rule rather than an incidental consequence of list order.

---

## Bug 3: Escape does not reliably close the dialog while an editor has focus

`PloverCommandActivity.dispatchKeyEvent()` contains the expected behavior:

```java
if (event.getKeyCode() == KeyEvent.KEYCODE_ESCAPE) {
    finish();
    return true;
}
```

However, this only works if the event reaches the Activity.

When an `EditText` owns focus, `PloverCommandFocusState` marks native-control focus as false.

While STENO/Raw-outline capture is active, `V7ImeService` handles hardware events before the Activity and explicitly considers `KEYCODE_ESCAPE` a captured key.

Escape can therefore be consumed/routed into the IME WebUI instead of reaching `PloverCommandActivity`.

The result is mode/focus-dependent behavior:

```text
Escape with native control focused
    → Activity sees it
    → dialog closes

Escape with editor focused in captured IME mode
    → IME captures it
    → Activity may never see it
```

That directly violates the documented claim that Escape closes the dialog.

### Expected behavior

Command-dialog Escape should have priority over editor/steno capture.

If `PloverCommandActivity` is active, an unmodified hardware Escape intended for dialog dismissal should reach the Activity regardless of whether the current control is an `EditText`, radio button, status region, or button.

---

## Bug 4: “Add translation” can silently overwrite an existing entry

The dialog sends:

```text
add_entry
```

to Stripped Plover.

That ultimately uses dictionary `set()` semantics backed by `INSERT OR REPLACE`.

Therefore adding:

```text
OUTLINE → new translation
```

to a dictionary that already contains `OUTLINE` does not necessarily behave like an additive operation.

It can replace the existing translation.

The V7 dialog performs no preflight conflict check and presents no overwrite confirmation.

This is particularly dangerous when combined with the dictionary-selection bugs above:

```text
keyboard navigation accidentally changes destination
        ↓
user submits
        ↓
same outline already exists in unintended dictionary
        ↓
existing entry is silently replaced
```

### Expected behavior

The UI should distinguish **Add** from **Replace**.

Before mutation, V7 should determine whether the selected dictionary already contains the normalized outline.

If it does:

- show the existing translation;
- clearly state that the operation would replace it;
- require an explicit Replace/Overwrite action.

A command called **Add translation** should not silently destroy an existing translation.

---

## Bug 5: the Translation field advertises multiline editing but Enter submits instead

The Translation `EditText` is configured with:

```java
TYPE_TEXT_FLAG_MULTI_LINE
```

and has a minimum of two lines.

But `submitOnEnter()` assigns `IME_ACTION_DONE` and treats Enter as form submission.

The submission predicate does not distinguish modifier state.

Consequently the UI visually and semantically advertises a multiline text editor while hardware Enter is reserved for submission.

There is no clear keyboard path for entering a newline, and `Shift+Enter` is not treated specially.

### Expected behavior

Choose one consistent model.

Either:

**A. Translation is multiline**

Then:

- Enter inserts newline;
- a separate shortcut such as Ctrl+Enter submits;
- the Add button remains keyboard reachable.

Or:

**B. Translation is single-line**

Then:

- remove `TYPE_TEXT_FLAG_MULTI_LINE`;
- remove the misleading two-line presentation;
- Enter may submit.

A field should not advertise multiline semantics while consuming its defining editing key as form submission.

---

## Bug 6: Numpad Enter behavior depends on IME routing mode

`V7ImeService` recognizes both:

```text
KEYCODE_ENTER
KEYCODE_NUMPAD_ENTER
```

as Enter.

However, `NativeFormSubmit.shouldSubmit()` only recognizes a physical:

```text
KEYCODE_ENTER
```

fallback.

This means Numpad Enter can work when the IME intercepts the key and converts it into an editor action, while behaving differently when the key reaches the native editor directly.

Submission should not depend on whether the current persistent IME mode happened to cause an intermediate routing path.

### Expected behavior

Main Enter and Numpad Enter should have identical form semantics.

---

## Bug 7: Tab interception ignores modifiers

`PloverCommandActivity.dispatchKeyEvent()` treats every `KEYCODE_TAB` as form navigation and only checks whether Shift is held to choose direction.

It does not reject:

- Ctrl+Tab;
- Alt+Tab;
- Meta+Tab;
- combinations involving those modifiers.

The command dialog should only own the navigation combinations it explicitly defines.

### Expected behavior

Intercept only:

```text
Tab
Shift+Tab
```

Other modified Tab combinations should retain platform/application behavior unless intentionally specified.

---

## Bug 8: dictionary number shortcuts accept unintended modifier combinations

The intended shortcuts are:

- `1`–`9` while operating the dictionary choices;
- `Alt+1`–`Alt+9` from elsewhere in the dialog.

However, once a dictionary radio has focus, shortcut enablement is based primarily on “focus is a dictionary”.

The helper that maps number keys to indices does not validate modifier state.

Consequently combinations such as:

```text
Ctrl+1
Meta+1
Shift+1
```

can potentially be interpreted as dictionary selection while a radio control owns focus.

### Expected behavior

The accepted shortcut grammar should be explicit.

For example:

```text
plain 1–9
    accepted only while the dictionary selector owns focus

Alt+1–9
    accepted from anywhere in the dialog

all other modifier combinations
    not dictionary shortcuts
```

Key handling should validate this directly.

---

## Bug 9: status feedback is not guaranteed to be visible after submission

The status view appears below the dictionary list.

For a user with many dictionaries, it can therefore be outside the visible portion of the resized dialog.

Submitting from the Translation field leaves focus in that field.

After success or failure the implementation only changes:

```java
status.setText(...)
```

It does not reveal the status region or move focus appropriately.

The accessibility live region helps screen-reader users, but a sighted hardware-keyboard user may not see whether the operation succeeded.

This encourages repeated Enter presses because the user cannot tell whether the first submission completed.

### Expected behavior

After a submission result:

- ensure the result/status is visible;
- announce it accessibly;
- make success and failure visually unmistakable;
- define where focus remains/moves.

Successful submission should not leave the user guessing whether the operation happened.

---

## Bug 10: successful submission immediately permits the identical operation again

The Add button is correctly disabled while the asynchronous request is in flight.

However, after success it is immediately re-enabled while:

- outline remains unchanged;
- translation remains unchanged;
- dictionary remains unchanged.

Therefore a second tap or Enter after the local RPC completes can issue the identical mutation again.

Because `add_entry` has upsert semantics, this does not normally create duplicate rows for the same `(dictionary, stroke)` key, but it still represents an unintended repeated mutation and compounds the overwrite problem.

A fast local request can complete within normal repeated-tap/repeated-key behavior.

### Expected behavior

Successful completion needs an explicit post-submit state.

Possible designs include:

- close the dialog on success;
- clear the form and require a new destination/outline;
- temporarily make the completed submission inert until input changes;
- otherwise guarantee idempotence and clearly display that the entry has already been added.

A user double-tapping Add should never result in two semantically independent mutation attempts.

---

## Touch selection: previous two-tap bug appears fixed, but the fix introduced the focus bug

The current implementation explicitly gives dictionary rows a full-width ≥48 dp touch target and installs an `OnClickListener` that checks and focuses the radio button.

That appears to fix the earlier behavior where the first tap could merely focus a radio control without selecting it.

This behavior should be preserved.

However, selection was also added to the focus listener.

That effectively changes the rule from:

```text
tap means select
```

to:

```text
focus means select
```

The latter is incorrect for keyboard navigation.

The fix should therefore retain first-tap selection while removing selection as a generic consequence of focus.

---

## Radio-group keyboard design should be reconsidered

The current documentation says Tab/Shift+Tab cycle through **every dictionary choice**.

That is technically keyboard-accessible, but it is a poor interaction model for a potentially large dictionary list.

For 20 dictionaries, reaching the controls after the dictionary selector requires tabbing through all 20 items.

Standard radio-group behavior is preferable:

```text
Tab
    enter the radio group

Arrow keys
    change selection inside the group

Tab
    leave the radio group
```

Number shortcuts can remain as accelerators.

This would also cleanly separate:

- focus traversal;
- radio selection;
- direct-access shortcuts.

---

## Suggested interaction model

A more coherent form could behave as follows.

### Outline

- Initial focus.
- Raw outline mode.
- Enter / IME Next moves to Translation.
- Escape closes dialog.
- Tab moves according to normal form order.

### Translation

- Ordinary V7/Emily/Stripped Plover behavior.
- If multiline: Enter inserts newline and Ctrl+Enter submits.
- If single-line: Enter can advance/submit according to the chosen design.
- Escape closes dialog.

### Dictionary selector

- No automatic selection unless an intentional default policy exists.
- Tab enters the group without changing selection.
- Arrow keys choose among dictionaries.
- Space selects focused option if necessary.
- `1`–`9` select choices while inside the group.
- `Alt+1`–`Alt+9` select choices globally.
- Touch selects in one tap.
- Focus alone never changes selection.

### Add

Enabled only when the form is actually submittable.

Before writing:

- check whether the outline already exists in the selected dictionary;
- if so, switch to an explicit Replace confirmation/state.

After success:

- show unmistakable visible feedback;
- prevent accidental identical resubmission;
- either close/reset the dialog or require another deliberate action.

### Close

- normal button activation;
- Escape works from every control and every IME mode.

---

## Data-safety invariants

The fix should establish and test these invariants:

```text
changing focus does not change dictionary selection
```

```text
Tab/Shift+Tab never mutate form data
```

```text
Escape always closes the command dialog
```

```text
the destination dictionary is the one explicitly selected by the user
```

```text
Add never silently replaces an existing entry
```

```text
one user submission causes at most one intended mutation
```

```text
main Enter and Numpad Enter have equivalent semantics
```

```text
touch and keyboard produce the same selected dictionary
```

```text
every successful/failed mutation produces visible feedback
```

---

## Testing gap

The existing unit tests mostly exercise helpers independently:

- focus-cycle index calculation;
- dictionary number-key mapping;
- native-control focus state;
- form-submit predicates.

Those tests cannot detect the interaction bugs above because the failures arise from composition between:

```text
PloverCommandActivity
        ↕
Android View focus
        ↕
RadioGroup state
        ↕
EditText/InputConnection
        ↕
V7ImeService hardware routing
        ↕
Stripped Plover mutation RPC
```

The dialog needs integration/instrumentation coverage for actual user sequences.

### Required regression scenarios

At minimum test:

1. Open Add translation.
2. Enter an outline.
3. Enter translation.
4. Tab forward and backward through dictionary controls.
5. Verify selection changes only through explicit selection actions.

Also:

```text
focus Outline → Escape → dialog closes
focus Translation → Escape → dialog closes
focus dictionary → Escape → dialog closes
focus Add → Escape → dialog closes
```

And:

```text
select dictionary A
Tab through dictionary B/C
submit
→ dictionary A receives entry
```

And:

```text
existing outline in dictionary A
attempt Add with different translation
→ explicit overwrite confirmation
→ existing value is not silently changed
```

And:

```text
double tap Add
rapid Enter twice
→ only one intended mutation
```

And:

```text
main Enter vs Numpad Enter
→ identical behavior
```

And, if Translation remains multiline:

```text
Enter / Shift+Enter / Ctrl+Enter
→ documented, deterministic behavior
```

Testing should exercise both:

- STENO active;
- Normal typing active;

because several current failures depend on whether hardware events are intercepted by `V7ImeService` or reach the Activity directly.

---

## Out of scope

This issue is specifically about the V7 Android Add translation dialog interaction contract.

It should not be conflated with the separately identified issues concerning:

- removal of the `readonly` dictionary abstraction;
- Stripped Plover numeric RTFCRE parser/serializer round-trip failures.

Those require separate fixes.

The `readonly` cleanup may change how V7 discovers dictionaries capable of concrete entry mutation, but it does not eliminate the interaction bugs described here.

---

## Acceptance criteria

- Focusing or tabbing through a dictionary never selects it implicitly.
- Destination dictionary selection is explicit and deterministic.
- No unintended first-dictionary submission occurs.
- Escape closes the dialog from every focus state and persistent IME mode.
- Touch dictionary selection remains one-tap with an adequate touch target.
- Radio-group keyboard behavior is deliberate and scalable.
- Tab/Shift+Tab only perform navigation and do not mutate form state.
- Modified Tab and number-key combinations are handled according to an explicit shortcut grammar.
- Main Enter and Numpad Enter behave consistently.
- Translation multiline semantics and submission semantics no longer conflict.
- Existing entries cannot be silently overwritten by an operation presented as Add.
- A rapid double tap/repeated Enter cannot cause unintended repeated mutation.
- Submission result feedback is visibly revealed as well as announced accessibly.
- Integration/instrumentation tests cover the Activity ↔ IME ↔ focus ↔ dictionary-selection interaction instead of relying only on isolated helper tests.