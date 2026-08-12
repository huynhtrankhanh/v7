# Android Stripped Plover command-dialog bug reports

This document contains two standalone, issue-ready bug reports:

1. **Add Translation still has a one-tap activation bug** because ordinary clickable controls are made focusable in touch mode.
2. **Lookup has the same touch bug plus several independent correctness, state, pagination, and focus bugs.**

---

# Bug report 1: Add Translation still requires double taps on some controls

## Summary

The Android **Add Stripped Plover translation** dialog still has a remaining touch-interaction bug after the previous keyboard/touch fixes.

Buttons and dictionary radio choices can require **two taps** when another control, especially an `EditText`, currently owns focus:

```text
first tap
    → moves focus to the button/radio
    → action does not run

second tap
    → control is already focused
    → click/action runs
```

This affects ordinary command controls such as:

- **Add translation**;
- **Close**;
- dictionary radio choices;
- any other command-dialog button created through the same helper.

The same underlying helper is shared with the Lookup dialog, so this is not isolated to Add Translation.

## User-visible behavior

A typical reproduction is:

1. Open **Add Stripped Plover translation**.
2. Leave focus in **Outline** or **Translation**.
3. Tap **Close**.
4. The first tap may only move focus to Close.
5. Tap **Close** again.
6. The dialog closes.

The same pattern can occur with **Add translation** and dictionary radio choices.

This is especially confusing because the bug is state-dependent:

- if the button already has keyboard focus, one tap works;
- if an editor owns focus, the first tap can appear to do nothing;
- after the first tap moved focus, the second tap works.

That makes the UI feel intermittently unresponsive rather than deterministically broken.

## Root cause

`PloverCommandActivity` uses a shared helper for command controls:

```java
private <T extends View> T configureFocusable(T view) {
    if (view.getId() == View.NO_ID) {
        view.setId(View.generateViewId());
    }
    view.setFocusable(true);
    view.setFocusableInTouchMode(true);
    return view;
}
```

`addButton()` calls `registerFocusable()`, which calls `configureFocusable()`.

Dictionary radio choices also call `configureFocusable(choice)`.

Therefore ordinary clickable controls are explicitly made **focusable in touch mode**.

That changes Android's normal touch activation behavior. A tap on an unfocused touch-focusable control can be consumed by focus acquisition first; the click is then observed only on a later tap once the control already owns focus.

The previous fix deliberately made every dictionary radio touch-focusable so a clicked radio could retain focus, but this applies the wrong abstraction globally: **touch activation and keyboard focus are being conflated**.

## Why the previous one-tap radio fix is incomplete

The current radio code does this:

```java
configureFocusable(choice);
...
choice.setOnClickListener(view -> {
    dictionaryGroup.check(choice.getId());
    choice.requestFocus();
    revealFocusedView(choice);
});
```

The intention is good: one tap should select the radio and then leave keyboard focus on it.

However, `OnClickListener` only helps if Android actually emits the click for that first tap. Making the radio `focusableInTouchMode` can cause the first tap to be spent acquiring focus before the click path is reached.

So the correct rule should be:

```text
touch → activate/select immediately
       → optionally request keyboard focus after activation
```

not:

```text
touch → acquire focus
       → maybe activate on a later tap
```

## Severity

**P1/P2 interaction regression.**

It does not corrupt dictionary data by itself, but it affects the primary mutation button, Close, and dictionary selection. A user can reasonably conclude that the UI ignored their tap and repeat actions unnecessarily.

## Expected behavior

Every ordinary command control must activate on the **first tap**, regardless of which editor or button previously had focus.

Required invariant:

```text
one tap = one activation
```

for:

- Add translation;
- Close;
- every dictionary radio choice;
- Lookup's action and Close buttons;
- future command-dialog buttons using the same helper.

Keyboard accessibility must remain intact:

- Tab/Shift+Tab can still focus buttons;
- radio controls remain keyboard operable;
- touch activation must not require a preparatory focus tap.

## Suggested implementation direction

Do not make ordinary clickable buttons/radios generically `focusableInTouchMode=true` merely to support hardware-keyboard traversal.

Separate the two concerns:

1. configure controls so hardware keyboard traversal can focus them;
2. allow normal Android touch-click behavior;
3. when desired, call `requestFocus()` **after a successful click**, rather than making touch-focus acquisition a prerequisite for clicking.

Audit every control registered through `configureFocusable()` instead of patching only Add Translation.

## Required regression tests

Instrumentation/UI tests should cover actual touch sequences, not only helper methods.

At minimum:

```text
focus Outline
single tap Close
→ dialog closes
```

```text
focus Translation
single tap dictionary B
→ B is selected and focused
```

```text
focus Translation
single tap Add translation
→ exactly one submission starts
```

```text
focus dictionary A
single tap Close
→ dialog closes
```

Also verify that keyboard Tab navigation still reaches the same controls after the touch fix.

---

# Bug report 2: Lookup dialog has touch, correctness, pagination, focus, and stale-result bugs

## Summary

The Android **Look up Stripped Plover entries** dialog has several independent bugs.

It shares the same one-tap/double-tap defect as Add Translation, but Lookup also has correctness problems in its search implementation and UI state model:

1. command buttons can require two taps;
2. exact stroke lookup is implemented as paginated substring search followed by client-side exact filtering, so valid exact matches can be missed;
3. results after the first 100 entries are silently discarded;
4. a translation argument is prefilled correctly but focus is still forced into the raw-outline Stroke editor;
5. `looksLikeOutline()` is only a character whitelist, so ordinary uppercase text can be misclassified as a stroke;
6. asynchronous results are not guaranteed to be scrolled into view;
7. a response can belong to an old query while the fields already show a newer query;
8. an empty status region is a keyboard Tab stop before any result exists;
9. the native dialog conflates stroke lookup, reverse lookup, and combined search into one form based only on which fields happen to be non-empty.

The result is a dialog that can be hard to activate by touch and can also return incomplete, stale, or false-negative results.

## Intended behavior

Lookup should provide two clear operations:

```text
stroke → translation(s)
```

and

```text
translation → stroke(s)
```

A user should be able to:

- open Lookup with a stroke or translation argument;
- land in the editor that contains that argument;
- perform the lookup with one tap or Enter;
- see all relevant results or explicit pagination;
- trust that the displayed result belongs to the current query;
- never receive a false "No matching entries" merely because of internal pagination.

---

## Bug 1: Look up and Close can require two taps

### Cause

Lookup uses the same `addButton() → registerFocusable() → configureFocusable()` path as Add Translation.

`configureFocusable()` sets:

```java
view.setFocusable(true);
view.setFocusableInTouchMode(true);
```

An unfocused button can therefore consume the first tap by taking touch focus and only activate on the second tap.

### Expected behavior

One tap on **Look up** must start one lookup. One tap on **Close** must close the dialog.

This should be fixed in the shared command-control focus implementation, not with Lookup-specific click workarounds.

---

## Bug 2: exact stroke lookup can return a false negative

### Current implementation

When the Stroke field is non-empty, `showLookup()` sends:

```json
{
  "stroke": "...",
  "match": "substring",
  "sort": "alphabetic",
  "page": 1,
  "page_size": 100
}
```

through `search_entries`.

After the server returns that paginated substring result, Android applies another filter:

```java
if (!strokeQuery.isEmpty()
        && !stroke.equalsIgnoreCase(strokeQuery)) {
    continue;
}
```

### Failure mode

The semantics are therefore:

```text
server: find substring matches
server: sort
server: keep page 1 / first 100
client: now require exact stroke
```

If the exact stroke exists but lands outside the first 100 substring matches, Android never receives it.

The UI then reports:

```text
No matching entries found.
```

although an exact matching dictionary entry exists.

### Cause

An exact operation is being implemented as a broad paginated query followed by a narrower client-side predicate.

Filtering after pagination is not equivalent to filtering before pagination.

### Expected behavior

If Stroke lookup is intended to be exact, ask the backend for exact stroke semantics directly.

Do not use substring search and then emulate exactness in Java.

Required invariant:

```text
if an exact loaded entry exists for stroke S,
lookup(S) must not report no result because unrelated substring matches filled an earlier page
```

---

## Bug 3: Lookup silently truncates results at 100

The native dialog always sends:

```json
"page": 1,
"page_size": 100
```

and never exposes Next/Previous controls.

It also ignores the response's pagination metadata such as:

- `total`;
- `has_more`;
- later pages.

Therefore a translation query with more than 100 matching entries silently loses the remainder.

### Expected behavior

Choose one explicit policy:

- support pagination in the native dialog; or
- provide an intentionally bounded result with a visible "showing first N of M" indication; or
- use the dedicated reverse-lookup operation if that operation already has the desired complete semantics.

Silent truncation is not acceptable.

---

## Bug 4: a prefilled translation still focuses the raw-outline Stroke field

`showLookup(argument)` correctly chooses where to put the argument:

```java
if (looksLikeOutline(argument)) {
    stroke.setText(argument);
} else {
    translation.setText(argument);
}
```

But it always ends with:

```java
focusInitially(stroke);
```

The Stroke field is configured for Raw outline mode.

Therefore a translation command argument produces this state:

```text
Translation contains the supplied text
Stroke is empty
focus is in Stroke
IME is in Raw outline mode
```

The visible data and active editor disagree.

### Expected behavior

Initial focus should follow the field that was populated:

```text
outline argument → focus Stroke
translation argument → focus Translation
no argument → focus the product-defined default field
```

---

## Bug 5: `looksLikeOutline()` is not an outline parser

The classifier currently accepts any non-empty string matching:

```regex
[#STKPWHRAO*EUFRPBLGTSDZ\-/]+
```

This is only a character whitelist.

It does not prove that the text is a syntactically valid steno outline.

Ordinary uppercase words made only from those letters can therefore be classified as outlines even when they are intended as translation text.

### Cause

The UI is guessing the semantic type of a command argument from its character inventory instead of using the real stroke parser or explicit command metadata.

### Expected behavior

Best option: the command event should carry an explicit argument kind.

If inference remains necessary, use the canonical Stripped Plover/V7 outline parser rather than a character-class regex.

---

## Bug 6: lookup feedback can appear off-screen

Lookup creates its status/result region below the fields and button.

The async callback only performs:

```java
status.setText(...)
```

It does not call the same visibility helper now used by Add Translation:

```java
revealFocusedView(status)
```

When the soft keyboard reduces available height, or the result is long, the user may submit successfully but not see the response without manually scrolling.

### Expected behavior

After progress, success, no-result, or failure updates, ensure the relevant feedback region is visible without requiring the user to guess that content appeared below the fold.

---

## Bug 7: stale responses can be displayed under newer query text

On click, the code snapshots:

```java
String strokeQuery = stroke.getText().toString().trim();
String translationQuery = translation.getText().toString().trim();
```

It disables only the Look up button.

The user can still edit either field while the asynchronous request is running.

When the response arrives, the callback formats the result using the old captured values, without checking whether the current inputs still match that request.

The existing `commandGeneration` guard only detects replacement of the entire command activity. It does not distinguish successive query states inside the same Lookup form.

### Failure mode

```text
query A submitted
    ↓
user edits fields to query B
    ↓
response A arrives
    ↓
UI displays result A under fields showing B
```

### Expected behavior

Associate every request with a query generation/signature.

Only display a response if it still belongs to the current query state, or visibly label it as the result of the submitted query.

---

## Bug 8: the empty status view is an invisible Tab stop

`showLookup()` creates the status view before the Lookup button.

`addStatus()` immediately calls `registerFocusable(status)` even while the view contains no text.

The keyboard order therefore includes an empty focusable element:

```text
Stroke
→ Translation
→ empty status
→ Look up
→ Close
```

Before the first lookup, pressing Tab onto that empty region can look like keyboard navigation stopped working.

### Expected behavior

Do not put an empty non-interactive status region into the normal Tab order.

If result text needs keyboard selection/accessibility, make it focusable only once useful content exists, or provide a dedicated results component with a clear role.

---

## Bug 9: the form silently changes lookup semantics when both fields contain text

The web dictionary UI treats these as distinct operations:

```text
stroke lookup       → lookup(stroke)
translation lookup  → reverse_lookup(translation)
```

The native dialog instead has one **Look up** action.

If Stroke is non-empty it adds `stroke`; if Translation is non-empty it adds `output`; if both are non-empty it sends both to `search_entries`.

So the meaning changes from a direct lookup to an AND-filter search merely because stale or accidental text remains in the other field.

### Failure mode

```text
translation argument is prefilled
    ↓
focus incorrectly lands in Stroke
    ↓
user enters/chords something there
    ↓
Look up now searches stroke AND translation
    ↓
zero results
```

The user was never told that populating both fields changes the operation.

### Expected behavior

Make the operation explicit.

Possible designs:

- separate **Lookup stroke** and **Lookup translation** actions;
- a mode selector;
- clearing the opposite field when an operation is chosen;
- or a clearly labelled advanced combined-search mode.

Do not infer the operation from incidental non-empty form state.

---

## Cross-cutting root causes

The Lookup defects cluster around three architectural mistakes.

### 1. Touch focus and activation are conflated

The command form makes ordinary clickable controls focusable in touch mode in order to satisfy keyboard navigation.

That causes the double-tap behavior.

Keyboard focusability and touch activation need separate policies.

### 2. Lookup-specific semantics are implemented on top of generic search

The dialog takes a generic paginated `search_entries` result and tries to reinterpret it as exact stroke lookup or reverse lookup afterward.

That produces false negatives and truncation.

Use the backend operation whose semantics already match the requested action, or express exact filters server-side before pagination.

### 3. The form has no explicit query-state model

The current state is effectively inferred from mutable widgets:

```text
which fields are non-empty
which field happens to have focus
whatever request last returned
```

There is no explicit notion of:

- query kind;
- submitted query signature;
- pending query generation;
- current result ownership;
- result completeness/pagination;
- whether the result region should be focusable/visible.

That is why focus, stale-result, and operation-selection bugs compose so easily.

---

## Recommended acceptance criteria

### Shared command-dialog touch behavior

```text
single tap on any enabled command button activates it exactly once
```

```text
single tap on a dictionary radio selects it exactly once
```

```text
touch activation never requires a preparatory focus tap
```

### Lookup correctness

```text
exact stroke lookup cannot be hidden by substring pagination
```

```text
result truncation is impossible or explicitly disclosed with pagination/counts
```

```text
translation arguments initially focus Translation
```

```text
stroke arguments initially focus Stroke
```

```text
argument classification uses explicit metadata or a real outline parser
```

```text
results shown on screen always belong to the current/submitted query
```

```text
empty status text is not an invisible Tab stop
```

```text
stroke lookup, translation lookup, and combined search have explicit user-visible semantics
```

```text
success, no-result, and error feedback are automatically revealed
```

---

## Required regression scenarios

At minimum, add Android instrumentation/UI coverage for:

### Touch

```text
focus Stroke
single tap Look up
→ one request starts
```

```text
focus Translation
single tap Close
→ dialog closes
```

### Initial command argument

```text
open Lookup with a translation argument
→ Translation populated
→ Translation focused
→ normal editor mode active
```

```text
open Lookup with a valid outline argument
→ Stroke populated
→ Stroke focused
→ Raw outline mode active
```

### Exact lookup

Create more than 100 substring matches where the exact stroke would sort outside page 1:

```text
lookup exact stroke
→ exact entry is still returned
```

### Pagination

```text
query with >100 results
→ user is told results are incomplete and can navigate them
```

or verify the replacement backend operation returns complete intended results.

### Stale response

```text
submit query A
edit fields to B before A returns
return A
→ A is not presented as the result for B
```

### Keyboard order

```text
before any lookup:
Tab from Translation
→ next meaningful interactive control
→ no empty invisible status stop
```

### Explicit operation semantics

```text
translation lookup does not accidentally become stroke+translation intersection search because stale Stroke text exists
```

---

## Scope note

The Add Translation data-safety fixes from the previous work should remain intact:

- no implicit destination dictionary;
- focus does not mutate dictionary selection;
- overwrite requires explicit replacement handling;
- repeated identical submission is suppressed;
- multiline Translation keeps its intended Enter/Ctrl+Enter behavior;
- Escape routing remains command-dialog-owned.

This report only reopens the **touch activation** portion of Add Translation and separately identifies the remaining Lookup-specific defects.
