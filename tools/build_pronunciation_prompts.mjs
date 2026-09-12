#!/usr/bin/env node

import { readdir, writeFile } from "node:fs/promises";
import cnchar from "cnchar";
import { pinyin } from "pinyin-pro";

const dataUrl = new URL("../public/hanzi-data/", import.meta.url);
const outputUrl = new URL("./pronunciation-prompts.json", import.meta.url);
const files = await readdir(dataUrl);
const candidates = new Map();
const available = new Set();
const verifiedCommonSamples = {
  bai1: "掰",
  bi3: "笔",
  bi2: "鼻",
  cang1: "仓",
  chai2: "柴",
  che1: "车",
  chuai4: "踹",
  da1: "搭",
  e3: "恶",
  gan4: "干",
  ma4: "骂",
  nie4: "镊",
  ru4: "入",
  run4: "润",
  shun4: "顺",
  tang3: "躺",
  ti3: "体",
  ti4: "替",
  wei2: "为",
  xiao1: "消",
  xue3: "雪",
  yu4: "玉",
  zheng3: "整",
  zhu3: "主",
  zong4: "纵",
  zuo4: "做",
};

for (const file of files) {
  if (!file.endsWith(".json")) continue;
  const char = file.slice(0, -5);
  if (Array.from(char).length !== 1 || !/[\u3400-\u9fff\uf900-\ufaff]/u.test(char)) continue;
  available.add(char);
  const reading = pinyin(char, { type: "array", toneType: "num" })[0];
  if (!/^[a-zü]+[0-5]$/i.test(reading)) continue;
  const key = reading.toLowerCase().replaceAll("ü", "v");
  const existing = candidates.get(key);
  if (!existing || (char >= "一" && char <= "龥" && !(existing >= "一" && existing <= "龥"))) candidates.set(key, char);
}

for (const key of candidates.keys()) {
  let reverseCandidates = [];
  try {
    reverseCandidates = Array.from(cnchar.spellToWord(key) || "");
  } catch {
    continue;
  }
  const preferred = reverseCandidates.find((char) => {
    if (!available.has(char)) return false;
    const defaultReading = pinyin(char, { type: "array", toneType: "num" })[0]
      ?.toLowerCase().replaceAll("ü", "v");
    return defaultReading === key;
  });
  if (preferred) candidates.set(key, preferred);
}

for (const [key, char] of Object.entries(verifiedCommonSamples)) {
  if (!available.has(char)) throw new Error(`读音样本不在本地字库中：${key} -> ${char}`);
  const readings = pinyin(char, { type: "array", toneType: "num", multiple: true })
    .map((reading) => reading.toLowerCase().replaceAll("ü", "v"));
  if (!readings.includes(key)) throw new Error(`读音样本不匹配：${key} -> ${char} (${readings.join(", ")})`);
  candidates.set(key, char);
}

const prompts = Object.fromEntries([...candidates].sort(([left], [right]) => left.localeCompare(right)));
await writeFile(outputUrl, `${JSON.stringify(prompts, null, 2)}\n`);
console.log(`已整理 ${Object.keys(prompts).length} 个带声调音节：${outputUrl.pathname}`);
