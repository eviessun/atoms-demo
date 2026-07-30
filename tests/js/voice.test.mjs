// Unit tests for the voice-input logic in static/app.js (Web Speech API).
//
// Covers the browser-only pieces the Python suite can't reach:
//   * setupVoice — hides the mic when unsupported; otherwise wires a
//     recognition instance (lang from i18n) whose result/end/error handlers
//     transcribe into the textarea, toggle the .listening class, and surface
//     an error message (but stay quiet on 'aborted'/'no-speech').
//
// setupVoice reassigns the module-scoped `recognition`, which a `new Function`
// param can't observe from outside — so instead we capture the instance our
// fake SpeechRecognition constructor creates (we hold the reference) and drive
// its registered listeners directly. See _extract.mjs for the overall approach.
//
// Run: node --test tests/js/voice.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFn } from "./_extract.mjs";

// A fake SpeechRecognition whose instances record their config + listeners and
// let a test fire "result"/"end"/"error". The factory hands back the shared
// `instances` array so the test can grab whatever setupVoice constructed.
function makeSpeechRecognition() {
  const instances = [];
  class FakeRecognition {
    constructor() {
      this.listeners = {};
      this.continuous = null;
      this.interimResults = null;
      this.lang = null;
      instances.push(this);
    }
    addEventListener(type, cb) { this.listeners[type] = cb; }
    // Test helpers to fire events the way the browser would.
    fire(type, evt) { this.listeners[type]?.(evt); }
  }
  return { FakeRecognition, instances };
}

// classList spy good enough for add/remove/contains assertions.
function fakeClassList() {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    _set: set,
  };
}

function makeTextarea(initial = "") {
  return { value: initial, focused: 0, focus() { this.focused++; } };
}

// Build setupVoice() with its collaborators injected. Returns the harness.
function runSetupVoice({ SpeechRecognition, lang = "en" }) {
  const { FakeRecognition, instances } = SpeechRecognition
    ? SpeechRecognition
    : { FakeRecognition: null, instances: [] };

  const micBtn = { classList: fakeClassList() };
  const promptEl = makeTextarea();
  const messages = [];
  const i18n = { getLang: () => lang, t: (k) => k };

  // setupVoice assigns `recognition`/`listening` (module-scoped in app.js);
  // as `new Function` params those assignments stay local, which is fine —
  // we observe the instance via `instances` and side effects via the spies.
  const fn = makeFn(
    "function setupVoice() {",
    ["SpeechRecognition", "micBtn", "recognition", "listening", "i18n",
     "promptEl", "addMessage"],
  );
  fn(
    FakeRecognition, micBtn, null, false, i18n, promptEl,
    (role, text) => messages.push({ role, text }),
  );

  return { micBtn, promptEl, messages, instance: instances[0] };
}

// --- unsupported browser ------------------------------------------------

test("setupVoice hides the mic button when the API is unavailable", () => {
  const h = runSetupVoice({ SpeechRecognition: null });
  assert.ok(h.micBtn.classList.contains("hidden"), "mic should be hidden");
  assert.equal(h.instance, undefined, "no recognition instance should be created");
});

// --- supported: configuration ------------------------------------------

test("setupVoice configures recognition (non-continuous, en-US) in English", () => {
  const h = runSetupVoice({ SpeechRecognition: makeSpeechRecognition(), lang: "en" });
  assert.ok(h.instance, "a recognition instance should be created");
  assert.equal(h.instance.continuous, false);
  assert.equal(h.instance.interimResults, false);
  assert.equal(h.instance.lang, "en-US");
  assert.ok(!h.micBtn.classList.contains("hidden"), "mic stays visible when supported");
});

test("setupVoice uses zh-CN when the UI language is Chinese", () => {
  const h = runSetupVoice({ SpeechRecognition: makeSpeechRecognition(), lang: "zh" });
  assert.equal(h.instance.lang, "zh-CN");
});

// --- supported: result handler (transcription) --------------------------

// The real handler shape: e.results is array-like of results, each result[0]
// has .transcript. It joins them.
function resultEvent(...transcripts) {
  return { results: transcripts.map((t) => [{ transcript: t }]) };
}

test("result handler writes the transcript into an empty textarea", () => {
  const h = runSetupVoice({ SpeechRecognition: makeSpeechRecognition() });
  h.instance.fire("result", resultEvent("hello world"));
  assert.equal(h.promptEl.value, "hello world");
  assert.equal(h.promptEl.focused, 1, "focus should return to the textarea");
});

test("result handler appends with a separating space after existing text", () => {
  const h = runSetupVoice({ SpeechRecognition: makeSpeechRecognition() });
  h.promptEl.value = "make a";
  h.instance.fire("result", resultEvent("todo list"));
  assert.equal(h.promptEl.value, "make a todo list");
});

test("result handler does not double-space when text already ends in a space", () => {
  const h = runSetupVoice({ SpeechRecognition: makeSpeechRecognition() });
  h.promptEl.value = "make a ";
  h.instance.fire("result", resultEvent("timer"));
  assert.equal(h.promptEl.value, "make a timer");
});

test("result handler joins multiple result chunks", () => {
  const h = runSetupVoice({ SpeechRecognition: makeSpeechRecognition() });
  h.instance.fire("result", resultEvent("foo ", "bar"));
  assert.equal(h.promptEl.value, "foo bar");
});

test("result handler ignores an empty transcript", () => {
  const h = runSetupVoice({ SpeechRecognition: makeSpeechRecognition() });
  h.promptEl.value = "keep me";
  h.instance.fire("result", resultEvent(""));
  assert.equal(h.promptEl.value, "keep me");
  assert.equal(h.promptEl.focused, 0, "no focus when nothing was transcribed");
});

// --- supported: end + error handlers ------------------------------------

test("end handler clears the .listening class", () => {
  const h = runSetupVoice({ SpeechRecognition: makeSpeechRecognition() });
  h.micBtn.classList.add("listening");
  h.instance.fire("end", {});
  assert.ok(!h.micBtn.classList.contains("listening"), "listening should be cleared");
});

test("error handler surfaces a message for a real error", () => {
  const h = runSetupVoice({ SpeechRecognition: makeSpeechRecognition() });
  h.instance.fire("error", { error: "network" });
  assert.ok(
    h.messages.some((m) => m.role === "assistant" && m.text === "msg.voice_error"),
    "a real error should be reported to the user",
  );
});

test("error handler stays silent for 'aborted' and 'no-speech'", () => {
  for (const kind of ["aborted", "no-speech"]) {
    const h = runSetupVoice({ SpeechRecognition: makeSpeechRecognition() });
    h.micBtn.classList.add("listening");
    h.instance.fire("error", { error: kind });
    assert.equal(h.messages.length, 0, `no message for '${kind}'`);
    // ...but it still stops listening.
    assert.ok(!h.micBtn.classList.contains("listening"), `'${kind}' still stops listening`);
  }
});
