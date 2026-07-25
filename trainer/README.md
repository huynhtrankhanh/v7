# V7 IME Trainer

`trainer/` is a standalone user-training subsystem for the V7 IME. It has its
own Node.js HTTP server, browser client, SQLite database, tests, container, and
administrative account flow. It does not import code from `inference-rs` or
run inside the inference process.

The interaction follows a steno drill model: the learner sees one Vietnamese
target, an optional raw-stroke hint and highlighted physical keys, then writes
the target as a real chord on an external keyboard. Correct strokes advance
immediately. A misstroke reveals the expected stroke and keeps the same target
in place for immediate correction.

## Teaching language and progression

Learner-facing copy describes an action and its visible result, not the
implementation behind it. The browser says “gõ từng tiếng,” “gõ hai tiếng một
lượt,” “các cách viết,” and “sửa chỗ đang sáng.” Terms such as candidate,
inference island, alternating encoding, piecemeal cursor, and FSRS remain in
code, API payloads, and developer documentation only.

Lessons progress through concrete skills:

1. press and release several physical keys together;
2. add the beginning, mark, and ending needed to write a complete tiếng;
3. write two tiếng in one press by including Space;
4. choose the intended wording from the visible alternatives;
5. highlight one incorrect part and retype only that part;
6. write varied, complete sentences with any mixture of those actions.

The guided repair cards deliberately prescribe one sequence so the learner can
rehearse the controls. Sentence practice does not prescribe a strategy: it
embeds the real editor and allows whatever sequence produces the target text.

## Enrollment and privacy boundary

There is no signup API or signup page. An administrator creates every account
through the local CLI. The browser does not attach telemetry listeners before
both authentication and explicit consent.

After consent, the subsystem records:

- complete key-down and key-up events within the site;
- physical chords, raw V7 strokes, correctness, latency, and hint use;
- pointer movement (throttled to 10 samples per second), clicks, and targets;
- viewport size and changes;
- a DOM-level HTML snapshot every 30 seconds, plus scroll and viewport
  metadata. The server stores HTML and never renders screenshots.

Password inputs and scripts are removed from DOM snapshots, and current input
values are not serialized. Event batches are size-limited on both client and
server. All telemetry endpoints require a valid session whose user has accepted
the current consent version.

Before enrollment, the browser performs three real chord checks. The server
compares the maximum simultaneously held set with the required key set; partial
or ghosted chords do not pass.

## Adaptive practice

Practice material is defined in `src/drills.mjs`. It introduces vowels, onsets,
tones, codas, and two-syllable contextual V7 strokes as physical drills—not
multiple-choice questions.

Two kinds of advanced practice are deliberately separate:

- guided repair drills force a real inference request, physical candidate
  selection, a numbered piecemeal target, and a replacement stroke so the
  learner can rehearse the complete recovery mechanism;
- free sentence runs present a full sentence and let the learner mix
  deterministic syllables, predictive two-syllable islands, candidate
  selection, piecemeal repair, punctuation, and undo. Piecemeal is optional in
  these runs and is useful only when the inferred candidate needs repair.

Free sentence runs embed the production WebUI editor from `../static` rather
than reimplementing its state machine. The editor owns chord parsing,
deterministic orthography, inference islands, candidates, piecemeal editing,
punctuation, and undo. It emits editor-state and raw-stroke events that the
trainer uses only for target completion, FSRS scoring, and consented telemetry.
The trainer exposes an authenticated `/infer` proxy, so the embedded editor
still reaches inference through the Node backend.

`src/sentences.mjs` contains ten Vietnamese sentence sets spanning everyday
life, questions, instructions, narrative, formal language, travel, food,
technical language, explanations, and community topics. Every suggested
two-syllable island is generated from the same V7 encoding rules and is
round-trip tested. During a sentence run, each island is inferred with the
already committed sentence text as backend context.

Each attempt generates an FSRS rating automatically:

- wrong stroke: Again;
- correct but slower than seven seconds: Hard;
- correct in 2.5–7 seconds: Good;
- correct in at most 2.5 seconds: Easy.

`src/fsrs.mjs` applies the FSRS-5 memory-state equations and stores stability,
difficulty, lapses, review count, and next due time per user and card. The next
target is the earliest due card; unseen material is introduced when nothing is
due. This gives weak strokes short feedback loops without asking the learner
to grade themself.

## Backend inference boundary

Deterministic single-syllable drills are checked against their exact V7 stroke.
Predictive two-syllable drills are different: after the expected physical chord
is received, the Node backend sends that card's islands to:

```text
POST V7_INFERENCE_URL
{"islands":["","na0tro2"]}
```

The browser never calls inference directly. The trainer only consumes the
existing `/infer` HTTP contract. It neither connects to nor launches Stripped
Plover.

## Run locally

Node.js 22.5 or newer is required for the built-in SQLite module. Node 24 is
used by the container.

```sh
cd trainer
npm test
cd ..
npm run build
cd trainer
V7_TRAINER_DB=./data/trainer.sqlite3 \
V7_INFERENCE_URL=http://127.0.0.1:3000/infer \
npm start
```

Open `http://localhost:3001`. Start the existing inference service separately
before reaching predictive drills.

To create a user without placing the password in process arguments:

```sh
cd trainer
read -rs password
printf '%s' "$password" | npm run user:add -- learner
unset password
```

Other administrative commands are:

```sh
npm run user:list
npm run user:disable -- learner
```

With Compose, the database is stored in `trainer-data`:

```sh
docker compose up -d inference trainer
read -rs password
printf '%s' "$password" |
  docker compose run --rm -T trainer npm run user:add -- learner
unset password
```

Set `V7_TRAINER_ORIGIN` to the exact public origin in production to reject
cross-origin state-changing requests, and set `V7_TRAINER_SECURE_COOKIE=1`
behind HTTPS.

## HTTP API

| Endpoint                         | Purpose                                         | Gate           |
| -------------------------------- | ----------------------------------------------- | -------------- |
| `GET /api/status`                | Session, consent, and enrollment state          | None           |
| `POST /api/login`, `/api/logout` | Session lifecycle                               | Manual account |
| `POST /api/consent`              | Record current explicit consent                 | Authenticated  |
| `GET`, `POST /api/nkro`          | Required chord sets and results                 | Consented      |
| `GET /api/drill/next`            | FSRS-selected practice card                     | Enrolled       |
| `POST /api/drill/infer`          | Actual candidates for a guided predictive drill | Enrolled       |
| `POST /api/drill/attempt`        | Validate, infer when needed, and schedule       | Enrolled       |
| `POST /api/sentence/complete`    | Score and schedule a completed sentence         | Enrolled       |
| `POST /api/events`               | Store detailed event batches and DOM snapshots  | Consented      |

`/webui/*` serves the built production editor only to enrolled sessions.
`POST /infer` is the enrolled-session proxy used by that editor.

Sessions use random 256-bit bearer tokens. Only SHA-256 token digests are stored
in SQLite. Passwords use salted scrypt with a per-account random salt. Cookies
are HttpOnly and SameSite Strict; failed logins are rate-limited in memory.

## Validation

```sh
cd trainer
npm test
```

The tests cover FSRS state changes, absence of public signup, the
pre-consent telemetry barrier, exact NKRO enrollment, and adaptive attempt
storage. They also verify generated physical V7 hints for every sentence pair
and the authenticated inference proxy used by the production editor.
