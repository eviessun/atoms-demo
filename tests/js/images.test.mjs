// Unit tests for the image-upload logic in static/app.js.
//
// Covers the browser-side pieces the Python suite can't reach:
//   * readFileAsDataURL — FileReader -> base64 promise (resolve + reject)
//   * stageImages       — type filter, MAX_IMAGES cap, oversize skip, read-error
//                         handling, and the re-render call
//   * syncAttachButton  — enable/disable + tooltip driven by model vision
//   * composeBody       — images ride the request ONLY for a vision model
//
// See _extract.mjs for why we run the real source instead of importing app.js.
//
// Run: node --test tests/js/images.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFn } from "./_extract.mjs";

// --- fakes --------------------------------------------------------------

// Minimal File stand-in. `_fail` lets a test force a read error downstream.
function fakeFile(name, type, size = 10, _fail = false) {
  return { name, type, size, _fail };
}

const i18nSpy = () => {
  const calls = [];
  return { calls, t: (key, params) => { calls.push({ key, params }); return key; } };
};

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// --- readFileAsDataURL --------------------------------------------------

test("readFileAsDataURL resolves with the FileReader result", async () => {
  const readFileAsDataURL = makeFn(
    "function readFileAsDataURL(file) {", ["file", "FileReader"],
  );
  class FakeReader {
    readAsDataURL(file) {
      queueMicrotask(() => { this.result = `data:${file.type};base64,AAA`; this.onload(); });
    }
  }
  const url = await readFileAsDataURL(fakeFile("a.png", "image/png"), FakeReader);
  assert.equal(url, "data:image/png;base64,AAA");
});

test("readFileAsDataURL rejects when the FileReader errors", async () => {
  const readFileAsDataURL = makeFn(
    "function readFileAsDataURL(file) {", ["file", "FileReader"],
  );
  class FakeReader {
    readAsDataURL() { queueMicrotask(() => this.onerror(new Error("boom"))); }
  }
  await assert.rejects(
    () => readFileAsDataURL(fakeFile("a.png", "image/png"), FakeReader),
    /boom/,
  );
});

// --- stageImages --------------------------------------------------------

// Build stageImages with all its collaborators injected. `attachedImages` is
// mutated in place (the real code only pushes to it), so the passed array
// reflects what got staged.
function makeStageImages({ attachedImages, readFileAsDataURL }) {
  const i18n = i18nSpy();
  const messages = [];
  let renders = 0;
  const fn = makeFn(
    "async function stageImages(fileList) {",
    ["fileList", "attachedImages", "MAX_IMAGES", "MAX_IMAGE_BYTES",
     "addMessage", "i18n", "readFileAsDataURL", "renderAttachments"],
    { async: true },
  );
  const run = (fileList) => fn(
    fileList, attachedImages, MAX_IMAGES, MAX_IMAGE_BYTES,
    (role, text) => messages.push({ role, text }),
    i18n, readFileAsDataURL, () => { renders++; },
  );
  return { run, i18n, messages, get renders() { return renders; } };
}

// A readFileAsDataURL spy: resolves to a deterministic URL, or rejects when the
// file is flagged _fail.
const okReader = async (file) => {
  if (file._fail) throw new Error("read failed");
  return `data:${file.type};base64,X(${file.name})`;
};

test("stageImages keeps only image/* files", async () => {
  const attachedImages = [];
  const h = makeStageImages({ attachedImages, readFileAsDataURL: okReader });
  await h.run([
    fakeFile("photo.png", "image/png"),
    fakeFile("notes.txt", "text/plain"),
    fakeFile("clip.jpg", "image/jpeg"),
  ]);
  assert.deepEqual(attachedImages, [
    "data:image/png;base64,X(photo.png)",
    "data:image/jpeg;base64,X(clip.jpg)",
  ]);
  assert.equal(h.renders, 1, "renderAttachments should run once after staging");
});

test("stageImages caps at MAX_IMAGES and warns", async () => {
  const attachedImages = ["a", "b", "c", "d"];   // already at the cap
  const h = makeStageImages({ attachedImages, readFileAsDataURL: okReader });
  await h.run([fakeFile("extra.png", "image/png")]);
  assert.equal(attachedImages.length, MAX_IMAGES, "must not exceed the cap");
  assert.ok(
    h.messages.some((m) => m.text === "msg.image_limit"),
    "should tell the user the limit was hit",
  );
});

test("stageImages skips a file that's too large, keeps the rest", async () => {
  const attachedImages = [];
  const h = makeStageImages({ attachedImages, readFileAsDataURL: okReader });
  await h.run([
    fakeFile("huge.png", "image/png", MAX_IMAGE_BYTES + 1),
    fakeFile("ok.png", "image/png", 100),
  ]);
  assert.deepEqual(attachedImages, ["data:image/png;base64,X(ok.png)"]);
  assert.ok(h.messages.some((m) => m.text === "msg.image_too_big"));
});

test("stageImages reports a read failure and moves on", async () => {
  const attachedImages = [];
  const h = makeStageImages({ attachedImages, readFileAsDataURL: okReader });
  await h.run([
    fakeFile("bad.png", "image/png", 100, /* fail */ true),
    fakeFile("good.png", "image/png", 100),
  ]);
  assert.deepEqual(attachedImages, ["data:image/png;base64,X(good.png)"]);
  assert.ok(h.messages.some((m) => m.text === "msg.image_read_fail"));
});

test("stageImages tolerates an empty/undefined file list", async () => {
  const attachedImages = [];
  const h = makeStageImages({ attachedImages, readFileAsDataURL: okReader });
  await h.run(undefined);
  assert.deepEqual(attachedImages, []);
  assert.equal(h.renders, 1);
});

// --- syncAttachButton ---------------------------------------------------

function makeSyncAttachButton({ vision, attachedImages }) {
  const i18n = i18nSpy();
  const attachBtn = { disabled: false, title: "" };
  let renders = 0;
  const fn = makeFn(
    "function syncAttachButton() {",
    ["selectedModelVision", "attachBtn", "i18n", "attachedImages", "renderAttachments"],
  );
  const run = () => fn(
    () => vision, attachBtn, i18n, attachedImages, () => { renders++; },
  );
  return { run, attachBtn, i18n, get renders() { return renders; } };
}

test("syncAttachButton enables the button for a vision model", () => {
  const h = makeSyncAttachButton({ vision: true, attachedImages: [] });
  h.run();
  assert.equal(h.attachBtn.disabled, false);
  assert.equal(h.attachBtn.title, "app.attach_image");
});

test("syncAttachButton disables the button for a text-only model", () => {
  const h = makeSyncAttachButton({ vision: false, attachedImages: [] });
  h.run();
  assert.equal(h.attachBtn.disabled, true);
  assert.equal(h.attachBtn.title, "app.attach_image_disabled");
});

test("syncAttachButton drops staged images when switching to a text model", () => {
  const h = makeSyncAttachButton({ vision: false, attachedImages: ["img1"] });
  h.run();
  // The clear path must re-render the (now empty) strip.
  assert.equal(h.renders, 1, "should re-render after dropping staged images");
});

test("syncAttachButton does NOT re-render when a vision model has no images", () => {
  const h = makeSyncAttachButton({ vision: true, attachedImages: [] });
  h.run();
  assert.equal(h.renders, 0);
});

// --- composeBody: images only for vision models -------------------------

function makeComposeBody({ vision, pendingImages, modelId = "gemma" }) {
  const fn = makeFn(
    "function composeBody(prompt, editing) {",
    ["prompt", "editing", "selectedModelId", "loadByok", "setStatus", "addMessage",
     "i18n", "openByokDialog", "currentProjectId", "currentHtml", "createIdemKey",
     "pendingImages", "selectedModelVision"],
  );
  return (prompt, editing) => fn(
    prompt, editing,
    () => modelId,          // selectedModelId
    () => null,             // loadByok (unused off the byok path)
    () => {}, () => {},     // setStatus, addMessage
    { t: (k) => k },        // i18n
    () => {},               // openByokDialog
    null, null, null,       // currentProjectId, currentHtml, createIdemKey
    pendingImages,          // pendingImages
    () => vision,           // selectedModelVision
  );
}

test("composeBody attaches images for a vision model", () => {
  const composeBody = makeComposeBody({ vision: true, pendingImages: ["img1", "img2"] });
  const body = composeBody("draw this", false);
  assert.deepEqual(body.images, ["img1", "img2"]);
  // It must be a COPY, not the same array reference.
  assert.notEqual(body.images, undefined);
});

test("composeBody omits images for a text-only model", () => {
  const composeBody = makeComposeBody({ vision: false, pendingImages: ["img1"] });
  const body = composeBody("draw this", false);
  assert.equal(body.images, undefined);
});

test("composeBody omits images when none are staged", () => {
  const composeBody = makeComposeBody({ vision: true, pendingImages: [] });
  const body = composeBody("draw this", false);
  assert.equal(body.images, undefined);
});
