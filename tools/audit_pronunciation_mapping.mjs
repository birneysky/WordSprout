#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pinyin } from "pinyin-pro";

const prompts = JSON.parse(await readFile(new URL("./pronunciation-prompts.json", import.meta.url), "utf8"));
const mismatches = [];

for (const [key, sample] of Object.entries(prompts)) {
  const readings = pinyin(sample, { type: "array", toneType: "num", multiple: true })
    .map((reading) => reading.toLowerCase().replaceAll("ü", "v"));
  if (!readings.includes(key)) mismatches.push({ key, sample, readings });
}

const result = { entries: Object.keys(prompts).length, dictionaryMismatches: mismatches.length, mismatches };
console.log(JSON.stringify(result, null, 2));
if (mismatches.length) process.exitCode = 1;
