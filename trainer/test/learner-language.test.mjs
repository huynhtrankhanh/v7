import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const learnerFiles = [
  new URL("../public/app.js", import.meta.url),
  new URL("../public/index.html", import.meta.url),
  new URL("../src/drills.mjs", import.meta.url),
  new URL("../src/sentences.mjs", import.meta.url),
];

test("learner copy explains actions without leaking internal V7 labels", async () => {
  const copy = (
    await Promise.all(learnerFiles.map((file) => readFile(file, "utf8")))
  ).join("\n");

  for (const phrase of [
    "ứng viên",
    "âm tiết chắc chắn",
    "đảo hai âm tiết",
    "sửa từ phải",
    "đếm từ phải",
    "backend inference",
  ]) {
    assert.equal(copy.toLocaleLowerCase("vi").includes(phrase), false, phrase);
  }

  for (const phrase of [
    "Gõ từng tiếng",
    "Gõ hai tiếng một lượt",
    "Chọn cách viết",
    "Sửa chỗ đang sáng",
  ]) {
    assert.equal(copy.includes(phrase), true, phrase);
  }
});
