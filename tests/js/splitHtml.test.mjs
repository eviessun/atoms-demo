// Unit test for splitHtmlIntoFiles in static/app.js.
//
// Newly-generated user apps arrive as a single self-contained HTML blob.
// For parity with the featured showcases (which come as three files) we split
// inline <style>/<script> out into style.css / app.js FOR THE CODE TAB ONLY.
// The preview iframe still renders the original html unchanged via srcdoc.
//
// Run: node --test tests/js/splitHtml.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APP_JS = join(here, "..", "..", "static", "app.js");

// Extract the real splitHtmlIntoFiles source from app.js and evaluate it into
// an isolated callable, the same technique showPreview.test.mjs uses.
function loadSplit() {
  const src = readFileSync(APP_JS, "utf8");
  const m = src.match(/function splitHtmlIntoFiles\(html\)\s*\{\n([\s\S]*?)\n\}/);
  assert.ok(m, "could not locate splitHtmlIntoFiles(html) in static/app.js");
  return new Function("html", m[1]);
}

const split = loadSplit();

test("splits an html blob with inline <style> and <script> into three files", () => {
  const html = `
<!doctype html>
<html>
<head>
<title>t</title>
<style>body { color: red; }</style>
</head>
<body>
<h1>hi</h1>
<script>console.log("hi")</script>
</body>
</html>`;
  const out = split(html);
  assert.equal(out.hasSplit, true);
  assert.equal(out.files.length, 3);
  assert.deepEqual(out.files.map((f) => f.name), ["index.html", "style.css", "app.js"]);
  assert.equal(out.files[1].content, "body { color: red; }");
  assert.equal(out.files[2].content, 'console.log("hi")');
  // Original inline tags stripped from index.html; external structure kept.
  assert.ok(!/\<style/i.test(out.files[0].content), "index.html should not still contain <style>");
  assert.ok(!/\<script/i.test(out.files[0].content), "index.html should not still contain inline <script>");
  assert.ok(/<h1>hi<\/h1>/.test(out.files[0].content), "index.html should keep body markup");
});

test("preserves external <script src=...> in index.html", () => {
  const html = `<!doctype html><html><body>
<script src="https://cdn.example.com/lib.js"></script>
<script>alert(1)</script>
</body></html>`;
  const out = split(html);
  assert.equal(out.hasSplit, true);
  // External script stays in index.html; inline one is extracted.
  assert.ok(/<script src="https:\/\/cdn.example.com\/lib.js"><\/script>/.test(out.files[0].content));
  const appJs = out.files.find((f) => f.name === "app.js");
  assert.equal(appJs.content, "alert(1)");
});

test("returns hasSplit=false for a body with no inline style or script", () => {
  const html = `<!doctype html><html><body><h1>hi</h1></body></html>`;
  const out = split(html);
  assert.equal(out.hasSplit, false);
  assert.equal(out.files, null);
});

test("concatenates multiple inline <style>/<script> blocks", () => {
  const html = `<!doctype html><html><head>
<style>a{color:red}</style>
<style>b{color:blue}</style>
</head><body>
<script>one()</script>
<script>two()</script>
</body></html>`;
  const out = split(html);
  assert.equal(out.hasSplit, true);
  const css = out.files.find((f) => f.name === "style.css").content;
  const js = out.files.find((f) => f.name === "app.js").content;
  assert.ok(css.includes("a{color:red}") && css.includes("b{color:blue}"));
  assert.ok(js.includes("one()") && js.includes("two()"));
});

test("index.html tab is still the (view-only) entry: name + language + non-empty content", () => {
  const html = `<!doctype html><html><head><style>x{}</style></head><body><h1>hi</h1><script>y()</script></body></html>`;
  const out = split(html);
  const entry = out.files[0];
  assert.equal(entry.name, "index.html");
  assert.equal(entry.language, "html");
  assert.ok(entry.content.length > 0);
});
