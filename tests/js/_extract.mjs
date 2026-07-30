// Shared helper for the app.js unit tests.
//
// static/app.js is a monolithic browser script: no exports, a side-effectful
// load (getElementById on ~40 nodes + an async init() IIFE), so it can't be
// imported. The established convention (see showPreview.test.mjs) is to pull a
// function's REAL source out of the shipped file and run it in isolation with
// its collaborators injected as parameters — the test stays tied to the actual
// code while needing no jsdom/bundler, only Node's built-in test runner.
//
// showPreview.test.mjs used a single non-greedy regex because that body has no
// nested line-starting `}`. stageImages/setupVoice/the voice handlers DO nest
// braces, so this module brace-matches instead. It skips over string and
// line-comment contents so a `{`/`}` inside them can't throw off the count.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const APP_JS = join(here, "..", "..", "static", "app.js");

export function readAppJs() {
  return readFileSync(APP_JS, "utf8");
}

// Return the source BETWEEN the braces of the block introduced by `marker`
// (which must include the block's opening `{`, e.g.
// 'async function stageImages(fileList) {'). Balanced-brace aware; skips
// strings ("..", '..', `..`) and // line comments while counting.
export function readBalancedBody(src, marker) {
  const at = src.indexOf(marker);
  if (at === -1) throw new Error(`extract: marker not found: ${marker}`);
  let i = at + marker.lastIndexOf("{");   // index of the opening brace
  let depth = 0;
  let started = false;
  let body = "";
  for (; i < src.length; i++) {
    const c = src[i];
    // String literal — copy verbatim, respecting escapes, without counting braces.
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      let s = c;
      i++;
      while (i < src.length) {
        const d = src[i];
        if (d === "\\") { s += d + (src[i + 1] ?? ""); i += 2; continue; }
        s += d;
        if (d === q) break;
        i++;
      }
      if (started) body += s;
      continue;
    }
    // Line comment — copy through end of line without counting braces.
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") { if (started) body += src[i]; i++; }
      if (started && i < src.length) body += "\n";
      continue;
    }
    if (c === "{") {
      depth++;
      if (!started) { started = true; continue; }   // drop the outer opening brace
      body += c;
      continue;
    }
    if (c === "}") {
      depth--;
      if (depth === 0) return body;                  // drop the outer closing brace
      body += c;
      continue;
    }
    if (started) body += c;
  }
  throw new Error(`extract: unbalanced braces after marker: ${marker}`);
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Rebuild an extracted body as a callable with `paramNames` injected, so the
// real source runs against test spies instead of app.js module globals.
export function makeFn(marker, paramNames, { async = false } = {}) {
  const body = readBalancedBody(readAppJs(), marker);
  const Ctor = async ? AsyncFunction : Function;
  return new Ctor(...paramNames, body);
}
