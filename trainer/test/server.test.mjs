import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { TrainerDatabase } from "../src/database.mjs";
import { getCard } from "../src/drills.mjs";
import { createTrainerServer } from "../src/server.mjs";

async function fixture() {
  const database = new TrainerDatabase(":memory:");
  await database.createUser("learner", "a sufficiently long password");
  const server = createTrainerServer({
    database,
    inferenceUrl: "http://127.0.0.1:1/infer",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    database,
    server,
    request: async (path, options = {}) => {
      const response = await fetch(`${base}${path}`, options);
      const body = await response.json();
      return { response, body };
    },
  };
}

test("accounts cannot be created through the web API", async (t) => {
  const context = await fixture();
  t.after(() => {
    context.server.close();
    context.database.close();
  });
  const result = await context.request("/api/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "intruder", password: "not relevant" }),
  });
  assert.equal(result.response.status, 404);
  assert.equal(context.database.listUsers().length, 1);
});

test("tracking is unavailable until explicit consent", async (t) => {
  const context = await fixture();
  t.after(() => {
    context.server.close();
    context.database.close();
  });

  const login = await context.request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "learner",
      password: "a sufficiently long password",
    }),
  });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get("set-cookie").split(";")[0];

  const before = await context.request("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ events: [] }),
  });
  assert.equal(before.response.status, 403);

  const consent = await context.request("/api/consent", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ accepted: true, version: "2026-07-25" }),
  });
  assert.equal(consent.response.status, 200);

  const after = await context.request("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      events: [
        {
          sequence: 1,
          type: "keydown",
          occurredAt: Date.now(),
          path: "/",
          viewport: { width: 1000, height: 700 },
          payload: { code: "KeyA" },
        },
      ],
    }),
  });
  assert.equal(after.response.status, 202);
  assert.equal(after.body.accepted, 1);
});

test("all exact NKRO chords are required before drills", async (t) => {
  const context = await fixture();
  t.after(() => {
    context.server.close();
    context.database.close();
  });
  const token = await context.database.login(
    "learner",
    "a sufficiently long password",
  );
  const user = context.database.userForToken(token);
  context.database.acceptConsent(user.id, "2026-07-25");

  assert.equal(context.database.recordNkroRound(user.id, 0, ["KeyQ"]), false);
  assert.equal(
    context.database.recordNkroRound(user.id, 0, [
      "KeyA",
      "KeyR",
      "KeyE",
      "KeyW",
      "KeyQ",
    ]),
    true,
  );
  assert.equal(
    context.database.status(context.database.userForToken(token)).enrolled,
    false,
  );
  context.database.recordNkroRound(user.id, 1, [
    "KeyU",
    "KeyI",
    "KeyO",
    "KeyP",
    "Semicolon",
  ]);
  context.database.recordNkroRound(user.id, 2, [
    "KeyA",
    "KeyS",
    "KeyD",
    "KeyF",
    "KeyJ",
    "KeyK",
    "KeyL",
    "Semicolon",
  ]);
  assert.equal(
    context.database.status(context.database.userForToken(token)).enrolled,
    true,
  );
});

test("practice attempts update adaptive review state", async (t) => {
  const database = new TrainerDatabase(":memory:");
  t.after(() => database.close());
  await database.createUser("learner", "a sufficiently long password");
  const token = await database.login("learner", "a sufficiently long password");
  const user = database.userForToken(token);
  const next = database.nextCard(user.id);
  assert.equal(next.card.id, "v-a");

  const result = database.saveAttempt(user.id, {
    cardId: "v-a",
    observedStrokes: ["A"],
    resolvedText: "a",
    correct: true,
    latencyMs: 1200,
  });
  assert.equal(result.rating, 4);
  assert.equal(result.stats.accuracy, 100);
  assert.ok(database.reviewFor(user.id, "v-a").dueAt > Date.now());
});

test("the embedded production editor proxy sends real islands to backend inference", async (t) => {
  const inferenceRequests = [];
  const inference = createHttpServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    inferenceRequests.push(payload);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ candidates: [["sáng nay"]] }));
  });
  inference.listen(0, "127.0.0.1");
  await once(inference, "listening");

  const database = new TrainerDatabase(":memory:");
  await database.createUser("learner", "a sufficiently long password");
  const token = await database.login("learner", "a sufficiently long password");
  const user = database.userForToken(token);
  database.acceptConsent(user.id, "2026-07-25");
  database.db
    .prepare("UPDATE users SET enrolled_at = ? WHERE id = ?")
    .run(Date.now(), user.id);

  const server = createTrainerServer({
    database,
    inferenceUrl: `http://127.0.0.1:${inference.address().port}/infer`,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    inference.close();
    database.close();
  });

  const card = getCard("sentence-morning");
  const cookie = `v7_trainer_session=${token}`;
  const firstResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/infer`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        islands: ["", card.pairs[0].code],
      }),
    },
  );
  const first = await firstResponse.json();
  assert.deepEqual(first.candidates, [["sáng nay"]]);
  assert.deepEqual(inferenceRequests, [{ islands: ["", card.pairs[0].code] }]);
});
