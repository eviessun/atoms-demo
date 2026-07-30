// Unit test for looksLikeChat in static/app.js.
//
// We only want to divert OBVIOUSLY conversational turns away from app
// generation. A false positive is expensive (the user asked for an app but only
// gets a chat reply), so the detector is intentionally conservative.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFn } from "./_extract.mjs";

const looksLikeChat = makeFn(
  "function looksLikeChat(prompt) {",
  ["prompt"],
);

test("greeting counts as chat", () => {
  assert.equal(looksLikeChat("你好"), true);
  assert.equal(looksLikeChat("what can you do?"), true);
});

test("plain question with no app keywords counts as chat", () => {
  assert.equal(looksLikeChat("为什么今天这么困？"), true);
  assert.equal(looksLikeChat("解释一下这个词是什么意思？"), true);
});

test("obvious build request does NOT count as chat", () => {
  assert.equal(looksLikeChat("做一个显示当前时间的时钟"), false);
  assert.equal(looksLikeChat("帮我生成一个待办应用"), false);
});

test("obvious edit request does NOT count as chat", () => {
  assert.equal(looksLikeChat("把按钮改成蓝色"), false);
  assert.equal(looksLikeChat("修改这个页面的登录表单样式"), false);
});
