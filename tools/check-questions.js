#!/usr/bin/env node
// 問題データの整合性チェック。
//   node tools/check-questions.js
// 問題を追加・編集したら実行し、エラーが 0 件であることを確認する。
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const files = ["questions/core.js", "questions/lpic201.js", "questions/lpic202.js"];
const matcher = require(path.join(root, "matcher.js"));

const sandbox = { window: {} };
vm.createContext(sandbox);
for (const file of files) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox, { filename: file });
}
const questions = sandbox.window.LINUX_ALARM_QUESTIONS || [];

const CATEGORIES = new Set(["field", "lpic1", "lpic201", "lpic202", "deep"]);
const TYPES = new Set(["single", "multi", "command", "fill"]);
const TOPIC_RANGE = { lpic201: [200, 206], lpic202: [207, 212] };

const errors = [];
const seen = new Set();
const fail = (q, message) => errors.push(`${q && q.id ? q.id : "(id なし)"}: ${message}`);

for (const q of questions) {
  if (!q.id || typeof q.id !== "string") fail(q, "id がない");
  else if (seen.has(q.id)) fail(q, "id が重複している");
  seen.add(q.id);

  if (!CATEGORIES.has(q.category)) fail(q, `未知の category: ${q.category}`);
  if (!TYPES.has(q.type)) fail(q, `未知の type: ${q.type}`);
  if (!q.text || typeof q.text !== "string") fail(q, "text がない");
  if (!q.hint) fail(q, "hint がない");

  if (TOPIC_RANGE[q.category]) {
    const [min, max] = TOPIC_RANGE[q.category];
    const topic = Number(q.topic);
    if (!(topic >= min && topic <= max)) fail(q, `topic ${q.topic} が ${min}〜${max} の範囲外`);
    if (![1, 2, 3].includes(q.freq)) fail(q, "freq は 1〜3 で指定する");
    if (!q.explain) fail(q, "explain（解説）がない");
    if (!q.id.startsWith(String(q.topic)) && !q.id.startsWith("lpic2-")) fail(q, "id は主題番号で始める");
  }

  if (q.type === "single" || q.type === "multi") {
    if (!Array.isArray(q.options) || q.options.length < 2) fail(q, "options は 2 つ以上必要");
    if (!Array.isArray(q.answer) || q.answer.length === 0) fail(q, "answer がない");
    const options = q.options || [];
    const answer = q.answer || [];
    if (new Set(options).size !== options.length) fail(q, "options に重複がある");
    if (answer.some((index) => !Number.isInteger(index) || index < 0 || index >= options.length)) {
      fail(q, "answer の番号が options の範囲外");
    }
    if (new Set(answer).size !== answer.length) fail(q, "answer に重複がある");
    if (q.type === "single" && answer.length !== 1) fail(q, "single の answer は 1 つだけ");
    if (q.type === "multi" && answer.length < 2) fail(q, "multi の answer は 2 つ以上");
    const count = /(\d+)\s*つ選択/.exec(q.text);
    if (q.type === "multi" && count && Number(count[1]) !== answer.length) {
      fail(q, `問題文は ${count[1]} つ選択だが answer は ${answer.length} 個`);
    }
  } else if (q.type === "command" || q.type === "fill") {
    if (!Array.isArray(q.answers) || q.answers.length === 0) fail(q, "answers がない");
    if (!["normalized", "orderedTokens"].includes(q.match)) fail(q, `match が不正: ${q.match}`);
    for (const answer of q.answers || []) {
      if (!matcher.matchesAny(answer, q.answers, q.match, q.ignoreCase)) fail(q, `正答 "${answer}" が自分自身に一致しない`);
    }
  }
}

const count = (filter) => questions.filter(filter).length;
const byCategory = {};
const byTopic = {};
for (const q of questions) {
  byCategory[q.category] = (byCategory[q.category] || 0) + 1;
  if (q.topic) byTopic[q.topic] = (byTopic[q.topic] || 0) + 1;
}

console.log(`問題数: ${questions.length}`);
console.log("カテゴリ別:", byCategory);
console.log("主題別:", byTopic);
console.log(
  "形式別:",
  Object.fromEntries([...TYPES].map((type) => [type, count((q) => q.type === type)])),
);

if (errors.length) {
  console.error(`\nエラー ${errors.length} 件`);
  errors.forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}
console.log("\nエラーなし");
