// Unit test for upsertTaggedMessage in static/app.js.
//
// Regression guard: repeated featured-card clicks used to append the same
// "已打开精选作品…" bubble N times, cluttering the chat. Now openFeatured tags
// that bubble and re-uses the tag; consecutive same-tag calls swap the text
// of the existing bubble instead of appending a new one.
//
// Run: node --test tests/js/upsertMessage.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APP_JS = join(here, "..", "..", "static", "app.js");

// Extract the real upsertTaggedMessage source and evaluate it with an injected
// `messagesEl` — no DOM lib needed, we just fake the tiny API surface the
// function actually uses. formatMessageTime is a same-file collaborator; we
// inject a deterministic stub so tests don't depend on the wall clock.
function loadUpsert() {
  const src = readFileSync(APP_JS, "utf8");
  const m = src.match(/function upsertTaggedMessage\(role, text, tag\)\s*\{\n([\s\S]*?)\n\}\n/);
  assert.ok(m, "could not locate upsertTaggedMessage(role, text, tag) in static/app.js");
  return new Function("messagesEl", "formatMessageTime", "role", "text", "tag", m[1]);
}

const upsertRaw = loadUpsert();
let clock = 0;
const nowStub = () => `stamp:${++clock}`;
const upsert = (container, role, text, tag) => upsertRaw(container, nowStub, role, text, tag);

// Minimal fake element: only the props the function reads/writes.
function makeEl({ tag = null, text = "" } = {}) {
  const p = { textContent: text };
  return {
    dataset: tag ? { tag } : {},
    className: "",
    _p: p,
    querySelector(sel) { return sel === "p" ? p : null; },
  };
}

function makeContainer(children = []) {
  const container = {
    children: [...children],
    scrollTop: 0,
    scrollHeight: 0,
    get lastElementChild() { return this.children[this.children.length - 1] || null; },
    appendChild(node) {
      this.children.push(node);
      // pretend the new bubble made the log grow — the function sets scrollTop
      // to scrollHeight to keep the newest message in view.
      this.scrollHeight += 20;
    },
  };
  // In production the container appendChild is what wires up the created div;
  // we don't need to model createElement, so upsert's `document.createElement`
  // will actually run in this Node runtime. Instead, we monkey-patch a tiny
  // global doc that produces our fake nodes.
  return container;
}

// Minimal DOM shim so `document.createElement(...)` works inside upsert.
globalThis.document = {
  createElement(tag) {
    if (tag === "p") return { textContent: "" };
    const el = {
      className: "",
      dataset: {},
      title: "",
      children: [],
      _p: null,
      appendChild(child) {
        this.children.push(child);
        if (child && typeof child.textContent === "string" && !("appendChild" in child)) {
          this._p = child;
        }
      },
      querySelector(sel) { return sel === "p" ? this._p : null; },
    };
    return el;
  },
};

test("first call appends a fresh tagged bubble", () => {
  const container = makeContainer();
  upsert(container, "assistant", "hello", "featured-loaded");
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].dataset.tag, "featured-loaded");
  assert.equal(container.children[0]._p.textContent, "hello");
  assert.equal(container.scrollTop, container.scrollHeight);
});

test("second call with SAME tag replaces the text in place (no new bubble)", () => {
  const container = makeContainer();
  clock = 0;
  upsert(container, "assistant", "opened A", "featured-loaded");
  const firstStamp = container.children[0].title;
  upsert(container, "assistant", "opened B", "featured-loaded");
  assert.equal(container.children.length, 1, "should still be 1 bubble");
  assert.equal(container.children[0]._p.textContent, "opened B");
  // The tooltip should reflect the LATEST event, not the original one — the
  // bubble now stands for the newer "opened…" moment, so hovering it should
  // show that time. Different stamp from the first call proves it refreshed.
  assert.notEqual(container.children[0].title, firstStamp);
});

test("call with DIFFERENT tag appends a new bubble", () => {
  const container = makeContainer();
  upsert(container, "assistant", "opened A", "featured-loaded");
  upsert(container, "assistant", "please log in", "featured-login-hint");
  assert.equal(container.children.length, 2);
  assert.equal(container.children[0].dataset.tag, "featured-loaded");
  assert.equal(container.children[1].dataset.tag, "featured-login-hint");
});

test("un-tagged intervening bubble breaks the collapse: next same-tag appends a NEW one", () => {
  const container = makeContainer();
  upsert(container, "assistant", "opened A", "featured-loaded");
  // Simulate an intervening plain addMessage (no tag).
  container.appendChild(makeEl({ tag: null, text: "some other message" }));
  upsert(container, "assistant", "opened B", "featured-loaded");
  assert.equal(container.children.length, 3);
  assert.equal(container.children[2]._p.textContent, "opened B");
});
