#!/usr/bin/env python3
"""Audit the offline Mandarin syllable bank and produce a review queue.

Hard failures (missing, undecodable, silent, invalid duration) make the command
fail. Pitch-contour checks are deliberately advisory: they identify clips that
need a human or phoneme recognizer, rather than pretending acoustic heuristics
can certify a child's pronunciation lesson.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess

import numpy as np
import soundfile as sf

from generate_qwen_pronunciations import PROMPTS, ROOT, audio_metrics, quality_problem

HUMAN_REVIEW = Path(__file__).with_name("pronunciation-human-review.json")
SOURCE_MANIFEST = Path(__file__).with_name("pronunciation-source-manifest.json")


def estimate_pitch(waveform, sample_rate):
    waveform = np.asarray(waveform, dtype=np.float32).squeeze()
    frame_size = round(sample_rate * 0.04)
    hop = round(sample_rate * 0.01)
    min_lag = max(1, round(sample_rate / 500))
    max_lag = round(sample_rate / 80)
    pitches = []
    for start in range(0, max(0, len(waveform) - frame_size + 1), hop):
        frame = waveform[start:start + frame_size]
        rms = float(np.sqrt(np.mean(frame ** 2)))
        if rms < 0.012:
            continue
        frame = (frame - np.mean(frame)) * np.hanning(len(frame))
        correlation = np.correlate(frame, frame, mode="full")[len(frame) - 1:]
        if correlation[0] <= 0:
            continue
        window = correlation[min_lag:max_lag + 1]
        lag_offset = int(np.argmax(window))
        confidence = float(window[lag_offset] / correlation[0])
        if confidence < 0.28:
            continue
        pitches.append(sample_rate / (min_lag + lag_offset))
    if len(pitches) < 5:
        return []
    pitches = np.asarray(pitches, dtype=np.float32)
    median = float(np.median(pitches))
    pitches = pitches[(pitches > median / 1.7) & (pitches < median * 1.7)]
    if len(pitches) < 5:
        return []
    return pitches.tolist()


def assess_tone(key, waveform, sample_rate):
    target = int(key[-1]) if key and key[-1].isdigit() else 0
    if target == 0:
        return {"target": 0, "detected": None, "confidence": "not-applicable"}
    pitches = estimate_pitch(waveform, sample_rate)
    if len(pitches) < 5:
        return {"target": target, "detected": None, "confidence": "low", "reason": "insufficient-pitch"}
    values = np.asarray(pitches)
    groups = np.array_split(values, 3)
    start, middle, end = [float(np.median(group)) for group in groups]
    reference = float(np.median(values))
    start_st, middle_st, end_st = [12 * math.log2(value / reference) for value in (start, middle, end)]
    movement = end_st - start_st
    dip = min(start_st, end_st) - middle_st
    pitch_range = 12 * math.log2(float(np.max(values)) / float(np.min(values)))

    if movement <= -2.0:
        detected = 4
        strength = abs(movement)
    elif dip >= 0.8 and end_st - middle_st >= 0.8:
        detected = 3
        strength = dip + end_st - middle_st
    elif movement >= 1.5:
        detected = 2
        strength = movement
    elif pitch_range <= 2.8 and abs(movement) <= 1.4:
        detected = 1
        strength = max(0.0, 2.8 - pitch_range)
    else:
        detected = None
        strength = 0.0
    return {
        "target": target,
        "detected": detected,
        "confidence": "medium" if strength >= 1.5 else "low",
        "startSt": round(start_st, 2),
        "middleSt": round(middle_st, 2),
        "endSt": round(end_st, 2),
        "rangeSt": round(pitch_range, 2),
    }


def decode_file(ffmpeg, path):
    result = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", "24000", "-"],
        capture_output=True,
    )
    waveform = np.frombuffer(result.stdout, dtype="<f4").copy() if result.returncode == 0 else np.array([], dtype=np.float32)
    return path.stem, result.returncode == 0, result.stderr.decode("utf8", errors="replace").strip(), waveform


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "tools" / "pronunciation-audit.json")
    parser.add_argument("--skip-decode", action="store_true")
    args = parser.parse_args()
    prompts = json.loads(PROMPTS.read_text(encoding="utf-8"))
    human_review = json.loads(HUMAN_REVIEW.read_text(encoding="utf-8")) if HUMAN_REVIEW.exists() else {}
    source_manifest = json.loads(SOURCE_MANIFEST.read_text(encoding="utf-8")) if SOURCE_MANIFEST.exists() else {}
    source_verified = set(source_manifest.get("imported", [])) | set(source_manifest.get("supplemental", {}))
    audio_dir = ROOT / "public" / "audio" / "pronunciations"
    hard_failures = []
    review = []
    entries = {}

    ffmpeg = shutil.which("ffmpeg")
    decode_results = {}
    if not args.skip_decode:
        if not ffmpeg:
            raise RuntimeError("未找到 ffmpeg，无法执行解码检查")
        files = [audio_dir / f"{key}.m4a" for key in prompts if (audio_dir / f"{key}.m4a").exists()]
        with ThreadPoolExecutor(max_workers=12) as pool:
            decode_results = {
                key: (ok, error, waveform)
                for key, ok, error, waveform in pool.map(lambda path: decode_file(ffmpeg, path), files)
            }

    for key, sample in prompts.items():
        m4a_path = audio_dir / f"{key}.m4a"
        problems = []
        if not m4a_path.exists():
            problems.append("missing-m4a")
        if key in decode_results and not decode_results[key][0]:
            problems.append("decode-failed")
        if problems:
            hard_failures.append({"key": key, "sample": sample, "problems": problems})
            continue
        if args.skip_decode:
            waveform, sample_rate = sf.read(m4a_path, dtype="float32")
        else:
            waveform, sample_rate = decode_results[key][2], 24000
        metrics = audio_metrics(waveform, sample_rate)
        quality = quality_problem(waveform, sample_rate)
        if quality:
            problems.append(quality)
            hard_failures.append({"key": key, "sample": sample, "problems": problems})
        tone = assess_tone(key, waveform, sample_rate)
        entries[key] = {
            "sample": sample,
            "duration": round(metrics["duration"], 3),
            "rms": round(metrics["rms"], 5),
            "peak": round(metrics["peak"], 5),
            "sha256": hashlib.sha256(waveform.tobytes()).hexdigest(),
            "tone": tone,
        }

    # Compare each contour with the rest of the same target tone. This is more
    # useful than pretending a hand-written classifier can recognize Mandarin
    # tones perfectly; only strong acoustic outliers enter the review queue.
    for target_tone in (1, 2, 3, 4):
        keys = []
        features = []
        for key, entry in entries.items():
            tone = entry["tone"]
            if tone["target"] == target_tone and "startSt" in tone:
                keys.append(key)
                features.append([tone["startSt"], tone["middleSt"], tone["endSt"], tone["rangeSt"]])
        if not features:
            continue
        values = np.asarray(features, dtype=np.float32)
        median = np.median(values, axis=0)
        mad = np.median(np.abs(values - median), axis=0)
        robust_z = np.abs(values - median) / np.maximum(0.5, 1.4826 * mad)
        for key, score in zip(keys, np.max(robust_z, axis=1)):
            if score > 7 and key not in source_verified and human_review.get(key, {}).get("status") != "approved":
                review.append({
                    "key": key,
                    "sample": prompts[key],
                    "file": f"public/audio/pronunciations/{key}.m4a",
                    "reason": "tone-contour-outlier",
                    "score": round(float(score), 2),
                    "tone": entries[key]["tone"],
                })
    for key, entry in entries.items():
        if entry["tone"].get("reason") == "insufficient-pitch" and key not in source_verified and human_review.get(key, {}).get("status") != "approved":
            review.append({
                "key": key,
                "sample": prompts[key],
                "file": f"public/audio/pronunciations/{key}.m4a",
                "reason": "pitch-unavailable",
                "tone": entry["tone"],
            })

    report = {
        "summary": {
            "expected": len(prompts),
            "audited": len(entries),
            "hardFailures": len(hard_failures),
            "needsReview": len(review),
            "humanVerified": sum(item.get("status") == "approved" for item in human_review.values()),
            "sourceVerified": len(source_verified),
            "phonemeRecognition": "rejected; Whisper tiny hallucinated on isolated syllables and cannot certify tone",
        },
        "hardFailures": hard_failures,
        "review": review,
        "entries": entries,
    }
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    manifest = {
        key: {
            "sample": entry["sample"],
            "duration": entry["duration"],
            "rms": entry["rms"],
            "peak": entry["peak"],
            "sha256": entry["sha256"],
        }
        for key, entry in entries.items()
    }
    (ROOT / "public" / "audio" / "pronunciations-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report["summary"], ensure_ascii=False))
    print(f"审计报告：{args.output}")
    if hard_failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
