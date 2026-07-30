// Unit test for the optimistic "generating…" placeholder in static/app.js
// (`renderProjects`).
//
// UX bug it guards against: a brand-new app is only persisted after the model
// finishes generating, and the projects list is only refreshed then. So after
// hitting "generate" the "My projects" panel sat unchanged for the whole
// generation — the new app seemed to "appear slowly / not at all". The fix
// shows an optimistic, non-clickable "生成中…" placeholder row at the TOP of
// the list the moment generation starts (driven by the module-level
// `pendingProjectTitle`), then swaps it for the real row once loadProjects()
// refreshes. This test locks in that behavior:
//   - placeholder shown at the top when pendingProjectTitle is set,
//   - the "no apps yet" empty hint is suppressed while a placeholder is up,
//   - once real rows arrive with the flag cleared, exactly the real rows show
//     (no leftover/duplicate placeholder),
//   - the placeholder is NOT clickable (no openProject wired to it).
//
// Like showPreview.test.mjs, app.js is a monolithic side-effectful browser
// script with no exports, so we extract the real renderProjects source from
// the shipped file and run it in an isolated sandbox with injected
// collaborators + a tiny DOM stub. No jsdom/bundler — only Node's test runner.
//
// Run: node --test tests/js/renderProjects.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APP_JS = join(here, "..", "..", "static", "app.js");

// Pull the real renderProjects(items) body out of app.js. The body contains
// nested `}` lines, so match up to the function's closing brace at column 0
// (a line that is exactly "}"), which terminates a top-level function.
function extractRenderProjectsBody() {
  const src = readFileSync(APP_JS, "utf8");
  const m = src.match(/function renderProjects\(items\)\s*\{\n([\s\S]*?)\n\}\n/);
  assert.ok(m, "could not locate renderProjects(items) in static/app.js — was it renamed?");
  return m[1];
}

// --- minimal DOM stubs ---------------------------------------------------
// Just enough of Element/document for renderProjects: createElement, className,
// textContent, append/appendChild, innerHTML reset, and onclick.
function makeEl(tag) {
  return {
    tagName: tag,
    className: "",
    textContent: "",
    onclick: null,
    children: [],
    append(...kids) { this.children.push(...kids); },
    appendChild(kid) { this.children.push(kid); return kid; },
    set innerHTML(v) { if (v === "") this.children = []; },
    get innerHTML() { return ""; },
  };
}

// Rebuild renderProjects with its collaborators/globals injected as params so
// the extracted source runs against our stubs instead of app.js globals.
function makeRenderProjects(ctx) {
  const body = extractRenderProjectsBody();
  const fn = new Function(
    "items",
    "projectsList", "currentUser", "pendingProjectTitle", "i18n",
    "document", "formatBeijingTime", "openProject",
    // `lastProjects` is assigned inside the body; declare it as a local so the
    // assignment doesn't leak to a global and we can read the cache back.
    "let lastProjects;\n" + body + "\nreturn lastProjects;",
  );
  return (items) => fn(
    items,
    ctx.projectsList, ctx.currentUser, ctx.pendingProjectTitle, ctx.i18n,
    ctx.document, ctx.formatBeijingTime, ctx.openProject,
  );
}

function makeCtx({ currentUser = { id: 1 }, pendingProjectTitle = null } = {}) {
  const projectsList = makeEl("ul");
  const openCalls = [];
  return {
    projectsList,
    currentUser,
    pendingProjectTitle,
    // Echo the key back so assertions are readable and locale-independent.
    i18n: { t: (k) => k },
    document: { createElement: makeEl },
    formatBeijingTime: () => "2026-07-30 12:00:00",
    openProject: (id) => openCalls.push(id),
    openCalls,
    rows: () => projectsList.children,
  };
}

const PROJECTS = [
  { id: 1, prompt: "a counter app", provider: "mock", created_at: "2026-07-30T04:00:00Z" },
];

test("placeholder: shows a pending row at the top when a new app is generating", () => {
  const ctx = makeCtx({ pendingProjectTitle: "a counter app" });
  makeRenderProjects(ctx)([]);   // no real projects yet — generation just started

  const rows = ctx.rows();
  assert.equal(rows.length, 1, "only the placeholder should show while the list is empty");
  const li = rows[0];
  assert.equal(li.className, "item pending", "placeholder carries the .pending class");
  // Title echoes the prompt; meta is the localized 'saving' hint with the spinner.
  assert.equal(li.children[0].textContent, "a counter app");
  assert.equal(li.children[1].textContent, "⏳ app.project_pending_meta");
});

test("placeholder is NOT clickable (it isn't a real project yet)", () => {
  const ctx = makeCtx({ pendingProjectTitle: "a counter app" });
  makeRenderProjects(ctx)([]);

  const li = ctx.rows()[0];
  assert.equal(li.onclick, null, "the placeholder row must not wire an openProject handler");
});

test("placeholder suppresses the 'no apps yet' empty hint", () => {
  const ctx = makeCtx({ pendingProjectTitle: "a counter app" });
  makeRenderProjects(ctx)([]);

  const classes = ctx.rows().map((li) => li.className);
  assert.ok(
    !classes.includes("empty"),
    "the empty-state hint must not appear alongside a pending placeholder",
  );
});

test("empty hint still shows when nothing is pending and there are no projects", () => {
  const ctx = makeCtx({ pendingProjectTitle: null });
  makeRenderProjects(ctx)([]);

  const rows = ctx.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].className, "empty");
  assert.equal(rows[0].textContent, "app.projects_empty_none");
});

test("placeholder sits ABOVE existing real projects (top of the list)", () => {
  const ctx = makeCtx({ pendingProjectTitle: "a counter app" });
  makeRenderProjects(ctx)(PROJECTS);

  const rows = ctx.rows();
  assert.equal(rows.length, 2, "placeholder + one real project");
  assert.equal(rows[0].className, "item pending", "placeholder must be first");
  assert.equal(rows[1].className, "item", "real project follows");
});

test("once persisted (flag cleared), only the real row shows — no leftover/duplicate", () => {
  // Simulates afterGenerate(): loadProjects() re-renders with the real row and
  // pendingProjectTitle already reset to null.
  const ctx = makeCtx({ pendingProjectTitle: null });
  makeRenderProjects(ctx)(PROJECTS);

  const rows = ctx.rows();
  assert.equal(rows.length, 1, "exactly one row — the real project");
  assert.equal(rows[0].className, "item");
  assert.ok(
    !rows.some((li) => li.className.includes("pending")),
    "no pending placeholder should linger after the real row arrives",
  );
  // The real row IS clickable.
  assert.equal(typeof rows[0].onclick, "function");
  rows[0].onclick();
  assert.deepEqual(ctx.openCalls, [1], "clicking the real row opens that project");
});

test("guests never see a placeholder (login hint takes precedence)", () => {
  const ctx = makeCtx({ currentUser: null, pendingProjectTitle: "a counter app" });
  makeRenderProjects(ctx)([]);

  const rows = ctx.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].className, "empty");
  assert.equal(rows[0].textContent, "app.projects_empty_guest");
});
