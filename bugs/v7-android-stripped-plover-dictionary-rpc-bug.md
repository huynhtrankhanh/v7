# Fix Android Stripped Plover dictionary RPC integration and remove downstream engine patching

## Summary

V7 currently has two user-visible Android bugs around Stripped Plover dictionary operations:

1. The dictionary management screen displays:

   ```text
   [object Object]
   ```

   when a dictionary RPC returns a structured protocol error, for example when removing a nonexistent entry.

2. The native “Add Stripped Plover translation” screen can display:

   ```text
   Unknown method: add_entry_safely
   ```

   because V7 calls safe mutation RPCs that are not currently provided by upstream Stripped Plover, while V7's Android build tries to inject those methods with a downstream source transform.

These are separate symptoms of the same architectural problem: V7 has protocol behavior split across the app, the web UI, the Android bridge, and a downstream patch to Stripped Plover.

The desired end state is:

- V7 correctly decodes structured Stripped Plover protocol errors.
- Stripped Plover upstream provides the conflict-aware mutation RPCs V7 needs.
- V7 pins a Stripped Plover revision containing those RPCs.
- V7 removes its `engine.ts` source transform entirely.
- V7 does not fall back to the old unsafe `add_entry` / `update_entry` mutation paths.
- Android integration tests cover the actual generated runtime bundle and both user-facing flows.

---

## User-visible bug 1: dictionary management shows `[object Object]`

### Reproduction

1. Open the Android dictionary management screen.
2. Select a writable JSON dictionary.
3. Enter an outline that does not exist.
4. Press **Remove**.

The backend correctly returns a structured Stripped Plover protocol error such as:

```json
{
  "id": 123,
  "error": {
    "code": -32000,
    "message": "Entry not found: TEFT"
  }
}
```

The Android bridge passes this JSON response through to the web UI.

The web UI then currently handles it approximately like this:

```ts
const response = JSON.parse(responseBody);

if (response.error) {
  pending.reject(new Error(String(response.error)));
}
```

Because `response.error` is an object:

```ts
String({
  code: -32000,
  message: "Entry not found: TEFT",
})
```

becomes:

```text
[object Object]
```

That string is propagated into the dictionary entry status UI.

### Expected behavior

The screen should show the protocol error message, for example:

```text
Entry not found: TEFT
```

### Required V7 fix

Decode structured protocol errors consistently.

For example:

```ts
function ploverProtocolErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return typeof error === "string"
    ? error
    : "Stripped Plover request failed.";
}
```

Then:

```ts
if (response.error) {
  pending.reject(new Error(ploverProtocolErrorMessage(response.error)));
  return;
}
```

The exact helper/API shape is flexible, but V7 should not call `String(...)` directly on a structured protocol error.

This should be shared or kept behaviorally consistent anywhere V7 decodes Stripped Plover protocol responses.

---

## User-visible bug 2: `Unknown method: add_entry_safely`

### Reproduction

1. Open the native **Add Stripped Plover translation** dialog on Android.
2. Enter an outline and translation.
3. Select a writable dictionary.
4. Press **ADD TRANSLATION**.

The screen may report:

```text
Unknown method: add_entry_safely
```

### Why V7 calls this method

The native add-translation flow intentionally uses conflict-aware mutation semantics.

It calls:

```text
add_entry_safely
```

to perform an atomic “insert if absent”.

If the outline already exists, the UI receives the existing translation and asks the user whether to replace it.

If replacement is confirmed, V7 calls:

```text
replace_entry
```

with an `expected_translation`, so the replacement succeeds only if the dictionary still contains the value the user was shown.

This is preferable to doing client-side `lookup` followed by `add_entry` or `update_entry`, because those sequences can overwrite changes made between the check and the write.

---

## Current downstream workaround

V7 currently tries to add the required RPCs by transforming upstream Stripped Plover's `engine.ts` during the Android build.

The transform injects dispatch cases equivalent to:

```ts
case "add_entry_safely":
  result = this.addEntrySafely(params);
  break;

case "replace_entry":
  result = this.replaceEntrySafely(params);
  break;
```

and injects implementations with the intended conflict-aware behavior.

This is the wrong long-term ownership boundary.

The mutation semantics belong to Stripped Plover's public protocol and should be implemented and tested upstream.

It is also fragile because a build can typecheck or transform one engine copy while the generated runtime bundles another engine copy, producing exactly the observed:

```text
Unknown method: add_entry_safely
```

failure.

---

## Upstream dependency

This V7 issue depends on a Stripped Plover change that:

- adds `add_entry_safely`
- adds `replace_entry`
- makes those operations atomic/conflict-aware
- removes or deprecates the unsafe `add_entry` and `update_entry` public mutation paths
- tests the new protocol behavior upstream

The intended semantics are:

### `add_entry_safely`

Create the requested outline only if it does not already exist.

Success:

```json
{
  "status": "ok",
  "conflict": false,
  "stroke": "TPH/TPH/TPH",
  "translation": "new value"
}
```

Conflict:

```json
{
  "status": "conflict",
  "conflict": true,
  "stroke": "TPH/TPH/TPH",
  "existing_translation": "current value"
}
```

No mutation occurs on conflict.

### `replace_entry`

Replace only when the current translation still matches the caller's `expected_translation`.

Success:

```json
{
  "status": "ok",
  "conflict": false,
  "stroke": "TPH/TPH/TPH",
  "translation": "new value"
}
```

Conflict:

```json
{
  "status": "conflict",
  "conflict": true,
  "stroke": "TPH/TPH/TPH"
}
```

No mutation occurs when the current value has changed or disappeared.

---

## V7 migration plan

### 1. Fix protocol-error decoding immediately

This fix does not need to wait for upstream.

Update the Android Stripped Plover response handling so a structured protocol error uses its `.message`.

This fixes the `[object Object]` symptom for dictionary management and any other Android Stripped Plover RPC using the same decoder.

### 2. Keep V7 on the safe mutation API

Do not work around the missing upstream method by switching the native UI back to:

```text
add_entry
```

or:

```text
update_entry
```

Those methods have weaker semantics and reintroduce stale/blind writes.

The native add-translation UI should continue to use:

```text
add_entry_safely
replace_entry
```

### 3. Update the pinned Stripped Plover revision

Once the upstream issue lands, update:

```text
ime-android/STRIPPED_PLOVER_REVISION
```

to a revision that contains the upstream safe mutation RPCs.

### 4. Delete V7's downstream engine mutation transform

Once V7 pins the upstream implementation, remove the mutation-specific patching from:

```text
ime-android/scripts/build-stripped-plover-web.mjs
```

In particular, remove the code that injects:

```text
add_entry_safely
replace_entry
```

into upstream `engine.ts`.

The generated runtime should bundle the upstream engine implementation directly.

V7 may still need unrelated Android compatibility transforms for browser/runtime integration, but dictionary mutation protocol behavior should no longer be patched downstream.

### 5. Remove assumptions about the old unsafe methods

V7 callers should not depend on upstream `add_entry` or `update_entry` remaining available.

Search V7 for dictionary-entry writes and migrate any remaining blind-write callers to the new safe RPCs where appropriate.

The intended end state is that V7 works when upstream removes the unsafe mutation methods.

---

## Do not silently fall back

V7 should not implement compatibility logic such as:

```text
try add_entry_safely
if UNKNOWN_METHOD:
    use add_entry
```

or:

```text
try replace_entry
if UNKNOWN_METHOD:
    use update_entry
```

That would make behavior depend on the bundled Stripped Plover revision and silently downgrade conflict guarantees.

If V7 requires a Stripped Plover revision containing the safe methods, failure to provide those methods should be treated as a version/build integration error, not as a reason to use unsafe writes.

---

## Tests

The important regression coverage is at the generated Android-runtime boundary, not just unit-testing helpers or transformed source.

### 1. Structured error decoding

Simulate an Android Stripped Plover response:

```json
{
  "id": 10,
  "error": {
    "code": -32000,
    "message": "Entry not found: DOES-NOT-EXIST"
  }
}
```

Assert that the user-facing message contains:

```text
Entry not found: DOES-NOT-EXIST
```

and does not contain:

```text
[object Object]
```

### 2. Dictionary management removal

Through the dictionary management UI:

1. select a writable JSON dictionary
2. enter a nonexistent outline
3. press Remove

Assert that the useful backend error message is rendered.

### 3. Generated runtime supports `add_entry_safely`

Build the actual Android Stripped Plover web runtime and issue:

```json
{
  "id": 1,
  "method": "add_entry_safely",
  "params": {
    "name": "test.json",
    "stroke": "TEFT",
    "translation": "test"
  }
}
```

Assert that the response is not `UNKNOWN_METHOD`.

Do not test only the staged/transformed source tree; exercise the same generated bundle that is packaged into the APK.

### 4. Successful safe add

With no existing entry:

- `add_entry_safely` succeeds
- `conflict` is false
- the dictionary contains the new value

### 5. Existing-entry conflict

With an existing entry:

- `add_entry_safely` returns `conflict: true`
- `existing_translation` is returned
- the dictionary is unchanged

### 6. Replacement

Given an existing value:

- `replace_entry` succeeds when `expected_translation` matches
- the value is replaced

### 7. Stale replacement

Change the entry after the client-observed value is captured.

Then call `replace_entry` using the stale `expected_translation`.

Assert:

- `conflict: true`
- the newer dictionary value is not overwritten

### 8. Native add-translation UI

Exercise the native Android add-translation flow far enough to verify that pressing **ADD TRANSLATION** no longer displays:

```text
Unknown method: add_entry_safely
```

Also cover the existing-entry confirmation path so `replace_entry` is verified through the native UI.

### 9. No unsafe fallback

Once the upstream safe methods are pinned, add a test or code-level assertion that the native flow does not use:

```text
add_entry
update_entry
```

as a fallback.

---

## Build/integration guard

It would be useful for the Android build/test pipeline to verify that the generated Stripped Plover runtime advertises or successfully handles the RPCs V7 requires.

A small smoke test against the built runtime would have caught the mismatch between:

- the methods V7's Java code calls
- the methods present in the actual bundled engine

before packaging the APK.

The test should cover the built artifact rather than only checking that source text contains the expected method names.

---

## Acceptance criteria

- [ ] Android dictionary management displays structured Stripped Plover error messages instead of `[object Object]`.
- [ ] Removing a nonexistent entry shows a useful message such as `Entry not found: ...`.
- [ ] V7 continues to use conflict-aware create/replace semantics.
- [ ] V7 does not fall back to unsafe `add_entry` / `update_entry` writes.
- [ ] Stripped Plover upstream provides `add_entry_safely` and `replace_entry`.
- [ ] V7 updates `STRIPPED_PLOVER_REVISION` to a revision containing those methods.
- [ ] The native Add Translation flow no longer reports `Unknown method: add_entry_safely`.
- [ ] Existing-entry replacement works through `replace_entry`.
- [ ] V7 removes the mutation-specific `transformEngine()` patch after updating the upstream revision.
- [ ] Generated-runtime tests exercise both safe mutation RPCs.
- [ ] Regression tests cover structured error decoding.
- [ ] Regression tests cover safe add, conflict, replacement, and stale replacement.
- [ ] V7 remains compatible with upstream removal of `add_entry` and `update_entry`.

---

## Desired final architecture

```text
Native Android UI
        |
        | add_entry_safely / replace_entry
        v
BundledStrippedPloverRuntime
        |
        | protocol response
        v
Upstream Stripped Plover engine
        |
        +-- owns atomic dictionary mutation semantics
        +-- owns conflict responses
        +-- owns validation/errors
```

V7 should own:

- Android UI behavior
- bridge/transport behavior
- correct decoding and display of protocol errors
- pinning a compatible upstream Stripped Plover revision

Stripped Plover should own:

- dictionary mutation semantics
- `add_entry_safely`
- `replace_entry`
- removal/deprecation of unsafe mutation RPCs

This removes the current split where V7 patches upstream protocol behavior during the Android build and makes the integration substantially easier to reason about and test.
