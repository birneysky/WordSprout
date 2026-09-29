#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const prompts = JSON.parse(await readFile(new URL("./pronunciation-prompts.json", import.meta.url), "utf8"));
const manifestUrl = new URL("./pronunciation-source-manifest.json", import.meta.url);
const sourceBase = "https://raw.githubusercontent.com/hugolpz/audio-cmn/master/64k/syllabs";
const staging = await mkdtemp(join(tmpdir(), "ziya-audio-cmn-"));
const keys = Object.keys(prompts);
const imported = [];
const unavailable = [];
let cursor = 0;

async function download(key) {
  const sourceKey = key.endsWith("0") ? `${key.slice(0, -1)}5` : key;
  const url = `${sourceBase}/cmn-${sourceKey}.mp3`;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const mp3 = join(staging, `${key}.mp3`);
      const firstPass = join(staging, `${key}-raw.m4a`);
      const m4a = join(staging, `${key}.m4a`);
      await writeFile(mp3, Buffer.from(await response.arrayBuffer()));
      await execFileAsync("ffmpeg", [
        "-loglevel", "error", "-y", "-i", mp3,
        "-c:a", "aac", "-b:a", "48k", firstPass,
      ]);
      const measured = await execFileAsync("ffmpeg", [
        "-hide_banner", "-i", firstPass, "-af", "volumedetect", "-f", "null", "-",
      ]).catch((error) => error);
      const maxVolume = Number(measured.stderr?.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1]);
      if (!Number.isFinite(maxVolume)) throw new Error("无法测量峰值音量");
      const gain = Math.min(36, Math.max(-12, -3 - maxVolume));
      await execFileAsync("ffmpeg", [
        "-loglevel", "error", "-y", "-i", firstPass,
        "-af", `volume=${gain.toFixed(2)}dB`,
        "-c:a", "aac", "-b:a", "48k", m4a,
      ]);
      const { stdout: durationText } = await execFileAsync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", m4a,
      ]);
      const duration = Number(durationText.trim());
      if (!Number.isFinite(duration) || duration < 0.25 || duration > 2) return false;
      await rename(m4a, new URL(`../public/audio/pronunciations/${key}.m4a`, import.meta.url));
      return true;
    } catch (error) {
      if (attempt === 4) throw new Error(`${key}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  return false;
}

async function worker() {
  while (cursor < keys.length) {
    const key = keys[cursor];
    cursor += 1;
    if (await download(key)) imported.push(key);
    else unavailable.push(key);
    const completed = imported.length + unavailable.length;
    if (completed % 100 === 0 || completed === keys.length) {
      console.log(`[${completed}/${keys.length}] 已检查`);
    }
  }
}

try {
  await Promise.all(Array.from({ length: 16 }, () => worker()));
  imported.sort();
  unavailable.sort();
  const retained = Object.keys(prompts).filter((key) => !imported.includes(key)).sort();
  await writeFile(manifestUrl, `${JSON.stringify({
    source: "https://github.com/hugolpz/audio-cmn",
    sourceRevision: "master",
    license: "CC BY-SA",
    attribution: "Chen Wang; audio-cmn collection maintained by Hugo Lopez",
    neutralToneMapping: "WordSprout tone 0 uses audio-cmn tone 5 when available",
    imported,
    retained,
    unavailable,
  }, null, 2)}\n`);
  console.log(JSON.stringify({ imported: imported.length, retained: retained.length, unavailable }, null, 2));
} finally {
  await rm(staging, { recursive: true, force: true });
}
