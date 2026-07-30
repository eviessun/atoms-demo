// Unit test for the preview-refresh fix in static/app.js (`showPreview`).
//
// Bug it guards against: showPreview used to set `iframe.srcdoc` and reveal the
// iframe (`switchTab("preview")`) in the SAME synchronous task. During
// streaming the iframe is on the hidden Code tab, so assigning srcdoc + un-
// hiding together left Chromium rendering the frame blank/stale after each
// generate/iterate — it only refreshed on a manual tab toggle. The fix defers
// the reveal to `requestAnimationFrame(...)`, reproducing the clean
// display:none -> block transition that a manual tab click performs.
//
// app.js is a monolithic browser script with no exports and a side-effectful
// load (getElementById on ~40 nodes + an async init() IIFE), so we can't
// import it. Instead we extract the real `showPreview` source from the shipped
// file and run it in an isolated sandbox with injected spies. That keeps the
// test tied to the actual code while needing no jsdom/bundler — only Node's
// built-in test runner.
//
// Run: node --test tests/js/showPreview.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APP_JS = join(here, "..", "..", "static", "app.js");

// Pull the real showPreview(html) body out of app.js. The body has no nested
// `\n}` (the only closure is a brace-less arrow), so a non-greedy match up to
// the first line-starting `}` captures exactly the function body.
function extractShowPreviewBody() {
  const src = readFileSync(APP_JS, "utf8");
  const m = src.match(/function showPreview\(html\)\s*\{\n([\s\S]*?)\n\}/);
  assert.ok(m, "could not locate showPreview(html) in static/app.js — was it renamed?");
  return m[1];
}

// Rebuild showPreview as a callable with its collaborators injected as params,
// so the extracted source runs against our spies instead of app.js globals.
function makeShowPreview(deps) {
  const body = extractShowPreviewBody();
  const fn = new Function(
    "html", "setCode", "previewEl", "requestAnimationFrame", "switchTab",
    body,
  );
  return (html) =>
    fn(html, deps.setCode, deps.previewEl, deps.requestAnimationFrame, deps.switchTab);
}

// A harness that records the ORDER of the side effects we care about, and lets
// the test control when the requestAnimationFrame callback fires.
function makeHarness() {
  const events = [];
  let rafCb = null;

  const previewEl = {
    _srcdoc: "",
    set srcdoc(v) { this._srcdoc = v; events.push("srcdoc"); },
    get srcdoc() { return this._srcdoc; },
  };

  const deps = {
    setCode: (v) => { events.push("setCode"); previewEl._setCodeArg = v; },
    previewEl,
    requestAnimationFrame: (cb) => { events.push("raf"); rafCb = cb; },
    switchTab: (tab) => { events.push(`switchTab:${tab}`); },
  };

  return {
    showPreview: makeShowPreview(deps),
    events,
    previewEl,
    // Simulate the browser firing the next animation frame.
    flushFrame() {
      assert.ok(rafCb, "requestAnimationFrame was never scheduled");
      rafCb();
    },
  };
}

const HTML = "<h1>hello world</h1>";

test("showPreview does NOT reveal the tab synchronously — it schedules a frame", () => {
  const h = makeHarness();
  h.showPreview(HTML);

  // Synchronously: content mirrored + srcdoc written + a frame scheduled...
  assert.equal(h.previewEl._setCodeArg, HTML, "code view should mirror the html");
  assert.equal(h.previewEl.srcdoc, HTML, "srcdoc should be set synchronously");
  assert.ok(
    h.events.includes("raf"),
    "reveal must be scheduled via requestAnimationFrame",
  );
  // ...but the reveal itself must be deferred. This is the regression guard:
  // the buggy version called switchTab('preview') synchronously here.
  assert.ok(
    !h.events.some((e) => e.startsWith("switchTab")),
    "switchTab must NOT run synchronously (that caused the stale/blank preview)",
  );
});

test("showPreview reveals the Preview tab once the frame fires", () => {
  const h = makeHarness();
  h.showPreview(HTML);
  h.flushFrame();

  assert.ok(
    h.events.includes("switchTab:preview"),
    "after the frame, it should switch to the preview tab",
  );
});

test("srcdoc is assigned BEFORE the tab reveal (ordering guarantees a repaint)", () => {
  const h = makeHarness();
  h.showPreview(HTML);
  h.flushFrame();

  const srcdocAt = h.events.indexOf("srcdoc");
  const revealAt = h.events.indexOf("switchTab:preview");
  assert.ok(srcdocAt !== -1 && revealAt !== -1, "both srcdoc and reveal should occur");
  assert.ok(
    srcdocAt < revealAt,
    `srcdoc (@${srcdocAt}) must be set before the reveal (@${revealAt})`,
  );
});

test("switchTab is called exactly once with 'preview'", () => {
  const h = makeHarness();
  h.showPreview(HTML);
  h.flushFrame();

  const reveals = h.events.filter((e) => e.startsWith("switchTab"));
  assert.deepEqual(reveals, ["switchTab:preview"]);
});
