import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the 字芽 learning experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>字芽 · 一笔一画学汉字<\/title>/);
  assert.match(html, /今天想学哪个字/);
  assert.match(html, /开始学习/);
  assert.match(html, /看笔顺/);
  assert.match(html, /我来写/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("exposes installable offline app metadata", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /theme-color/);
  assert.match(html, /og\.png/);
});

test("ships synchronized Qwen prompts for readings, stroke numbers, and names", async () => {
  const [files, pronunciationFiles, studio, serviceWorker] = await Promise.all([
    readdir(new URL("../public/audio/", import.meta.url)),
    readdir(new URL("../public/audio/pronunciations/", import.meta.url)),
    readFile(new URL("../app/writing-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  assert.ok(files.filter((file) => file.endsWith(".m4a")).length >= 102);
  assert.equal(pronunciationFiles.filter((file) => file.endsWith(".m4a")).length, 1232);
  assert.match(studio, /playPrompt\(`stroke-/);
  assert.match(studio, /STROKE_AUDIO_NAMES/);
  assert.match(studio, /Promise\.all\(\[nameAudio, currentWriter\.animateStroke\(index\)\]\)/);
  assert.match(studio, /toneLabel/);
  assert.match(studio, /playPronunciation/);
  assert.match(studio, /playPrompt\(`pronunciations\/\$\{key\}`\)/);
  assert.doesNotMatch(studio, /currentTime|createBufferSource|pronunciations\.json/);
  assert.doesNotMatch(studio, /speechSynthesis|SpeechSynthesisUtterance/);
  assert.match(studio, /pace === "slow"/);
  assert.match(studio, /animateStroke\(index\)/);
  assert.match(serviceWorker, /PROMPT_AUDIO/);
});

test("keeps the writing grid responsive and the mobile footer visible", async () => {
  const [studio, styles] = await Promise.all([
    readFile(new URL("../app/writing-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(studio, /new ResizeObserver/);
  assert.match(studio, /currentWriter\.updateDimensions/);
  assert.match(styles, /\.lesson-shell \{ grid-template-columns:1fr; margin-bottom:0; \}/);
  assert.match(styles, /footer \{ min-height:auto;/);
});

test("uses the 字芽 seed mark for the page and browser icon", async () => {
  const [studio, styles, layout, favicon, manifest, serviceWorker] = await Promise.all([
    readFile(new URL("../app/writing-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/favicon.svg", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(studio, /className="brand-seed"/);
  assert.match(styles, /background:url\("\/favicon\.svg\?v=2"\)/);
  assert.match(layout, /icon: "\/favicon\.svg\?v=2"/);
  assert.match(manifest, /"src": "\/favicon\.svg\?v=2"/);
  assert.match(favicon, /<circle[^>]+fill="#2F6B55"/);
  assert.match(favicon, /fill="#FFF8E8"/);
  assert.doesNotMatch(favicon, /#2E9EFF|#0C79D8|#68C4FF/);
  assert.match(serviceWorker, /const CACHE = "ziya-v10"/);
});

test("ships the complete Hanzi Writer library with resilient remote fallbacks", async () => {
  const [localFiles, packageFiles, studio, serviceWorker] = await Promise.all([
    readdir(new URL("../public/hanzi-data/", import.meta.url)),
    readdir(new URL("../node_modules/hanzi-writer-data/", import.meta.url)),
    readFile(new URL("../app/writing-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  const isCharacterFile = (file) => file.endsWith(".json") && Array.from(file.slice(0, -5)).length === 1;
  const localCharacters = localFiles.filter(isCharacterFile).sort();
  const packageCharacters = packageFiles.filter(isCharacterFile).sort();

  assert.equal(localCharacters.length, 9574);
  assert.deepEqual(localCharacters, packageCharacters);
  const invalidCharacters = [];
  for (const file of localCharacters) {
    try {
      const data = JSON.parse(await readFile(new URL(`../public/hanzi-data/${file}`, import.meta.url), "utf8"));
      if (!Array.isArray(data.strokes) || data.strokes.length === 0 || data.strokes.length !== data.medians?.length) {
        invalidCharacters.push(file);
      }
    } catch {
      invalidCharacters.push(file);
    }
  }
  assert.deepEqual(invalidCharacters, []);
  for (const char of ["辨", "辩", "辫", "己", "已", "巳", "诣", "酗"]) {
    assert.ok(localCharacters.includes(`${char}.json`), `${char} should be included in the local library`);
  }

  assert.match(studio, /cdn\.jsdelivr\.net\/npm\/hanzi-writer-data@/);
  assert.match(studio, /unpkg\.com\/hanzi-writer-data@/);
  assert.match(studio, /if \(!response\.ok\)/);
  assert.match(serviceWorker, /if \(response\.ok\)/);
  assert.doesNotMatch(serviceWorker, /catch\(\(\) => caches\.match\("\/"\)\)\)\);/);
});

test("supports contextual and selectable polyphonic readings", async () => {
  const [learning, studio] = await Promise.all([
    readFile(new URL("../app/character-learning.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/writing-studio.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(learning, /盛饭: "chéng fàn"/);
  assert.match(learning, /背东西: "bēi dōng xi"/);
  assert.match(learning, /export function getReadingOptions/);
  assert.match(learning, /polyphonic\(text/);
  assert.match(studio, /readingOptions\.length > 1/);
  assert.match(studio, /aria-pressed=/);
  assert.match(studio, /chooseReading\(option\)/);
});
