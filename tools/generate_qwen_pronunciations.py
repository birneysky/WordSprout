#!/usr/bin/env python3
"""Generate Qwen pronunciation assets for offline character readings."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from generate_ziya_audio import MODEL, ROOT, VOICE, convert, normalize

PROMPTS = Path(__file__).with_name("pronunciation-prompts.json")
CACHE = Path(__file__).with_name(".pronunciation-cache")

GENERATION_TEXT_OVERRIDES = {
    "bei0": "杯",
    "bo0": "波",
    "chen0": "陈",
    "da0": "大",
    "lou0": "漏",
    "lu0": "路",
    "men0": "门",
    "shang0": "商",
    "xu0": "徐",
    "zhe0": "遮",
}


def pronunciation_instruction(key):
    base = key[:-1].replace("v", "ü")
    tone = int(key[-1])
    tone_text = "轻声" if tone == 0 else f"第{'一二三四'[tone - 1]}声"
    tone_guidance = {
        0: "读得短而轻，不要带明显升降调",
        1: "整个音节保持高而平，尾音不要下降",
        2: "从中音自然上升，尾音明显抬高",
        3: "先下降再回升，保留完整的转折",
        4: "从高音快速下降，收音干净有力",
    }[tone]
    neutral_contexts = {
        "a0": "好啊",
        "ba0": "好吧",
        "bei0": "宝贝",
        "bo0": "萝卜",
        "chen0": "早晨",
        "da0": "疙瘩",
        "de0": "我的",
        "lou0": "走喽",
        "lu0": "葫芦",
        "ma0": "好吗",
        "me0": "什么",
        "men0": "我们",
        "ne0": "你呢",
        "shang0": "衣裳",
        "xu0": "苜蓿",
        "ya0": "来呀",
        "zhe0": "看着",
    }
    uncommon_guidance = {
        "kei1": "这里的字读北京口语‘剋人’的 kēi，不读 kè，也不要读英文字母 K。",
    }.get(key, "")
    neutral_guidance = (
        f"这个音节在“{neutral_contexts[key]}”中位于末尾并读轻声。"
        "请借助这个词语确定发音，但最终只读末尾的一个轻声音节，绝对不要读出完整词语。"
        if key in neutral_contexts else ""
    )
    return (
        f"{VOICE} 只朗读输入的一个汉字一次，不要解释，不要添加其他字词。"
        f"它的标准普通话读音必须是拼音 {base}，{tone_text}；{tone_guidance}。"
        f"{uncommon_guidance}{neutral_guidance}"
        "请准确读出这个声母、韵母和声调。"
    )


def first_utterance(waveform, sample_rate):
    """Keep the first spoken syllable and discard occasional model tail speech."""
    waveform = np.asarray(waveform, dtype=np.float32).squeeze()
    frame = max(1, round(sample_rate * 0.02))
    rms = np.array([
        np.sqrt(np.mean(waveform[index:index + frame] ** 2))
        for index in range(0, len(waveform), frame)
    ])
    voiced = np.flatnonzero(rms > 0.012)
    if not len(voiced):
        return waveform[:round(sample_rate * 1.5)]
    start_frame = max(0, int(voiced[0]) - 2)
    end_frame = min(len(rms), start_frame + round(1.5 / 0.02))
    # A third tone often has a low-energy valley. Requiring a longer voiced
    # section and a longer silence prevents that valley from being cut off.
    minimum_end = int(voiced[0]) + round(0.42 / 0.02)
    quiet_run = round(0.20 / 0.02)
    for index in range(minimum_end, end_frame - quiet_run):
        if np.all(rms[index:index + quiet_run] <= 0.012):
            end_frame = index + 2
            break
    clipped = waveform[start_frame * frame:min(len(waveform), end_frame * frame)].copy()
    fade = min(len(clipped), round(sample_rate * 0.025))
    if fade:
        clipped[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
    return clipped


def audio_metrics(waveform, sample_rate):
    waveform = np.asarray(waveform, dtype=np.float32).squeeze()
    peak = float(np.max(np.abs(waveform))) if waveform.size else 0.0
    rms = float(np.sqrt(np.mean(waveform ** 2))) if waveform.size else 0.0
    return {
        "duration": len(waveform) / sample_rate,
        "rms": rms,
        "peak": peak,
    }


def quality_problem(waveform, sample_rate):
    metrics = audio_metrics(waveform, sample_rate)
    if not 0.25 <= metrics["duration"] <= 2.0:
        return f"时长 {metrics['duration']:.2f}s"
    if metrics["rms"] < 0.018:
        return f"平均响度过低 RMS={metrics['rms']:.4f}"
    if metrics["peak"] < 0.10:
        return f"峰值过低 peak={metrics['peak']:.4f}"
    return None


def normalize_loudness(waveform, target_rms=0.09):
    """Normalize clips for consistent playback without allowing extreme gain."""
    waveform = np.asarray(waveform, dtype=np.float32).squeeze().copy()
    if not waveform.size:
        return waveform
    rms = float(np.sqrt(np.mean(waveform ** 2)))
    if rms > 0:
        gain = min(8.0, max(0.35, target_rms / rms))
        waveform *= gain
    peak = float(np.max(np.abs(waveform)))
    if peak > 0.92:
        waveform *= 0.92 / peak
    return waveform


def valid_cached_file(path):
    if not path.exists():
        return False
    import soundfile as sf
    waveform, sample_rate = sf.read(path, dtype="float32")
    return quality_problem(waveform, sample_rate) is None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "public" / "audio")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--assemble-only", action="store_true")
    parser.add_argument("--export-files", action="store_true")
    parser.add_argument("--keys", nargs="*", help="只重新生成指定的拼音键，例如 bi3 xue3")
    parser.add_argument("--seed-offset", type=int, default=0, help="人工复核时生成另一版候选音频")
    args = parser.parse_args()
    target = args.output / "pronunciations.m4a"
    index_target = args.output / "pronunciations.json"
    prompts = json.loads(PROMPTS.read_text(encoding="utf-8"))
    CACHE.mkdir(parents=True, exist_ok=True)
    unknown_keys = sorted(set(args.keys or []) - set(prompts))
    if unknown_keys:
        raise RuntimeError(f"未知拼音键：{', '.join(unknown_keys)}")
    requested_keys = set(args.keys or [])
    missing = [] if args.assemble_only or args.export_files else [
        (key, char)
        for key, char in prompts.items()
        if (not requested_keys or key in requested_keys)
        and (args.overwrite or requested_keys or not valid_cached_file(CACHE / f"{key}.wav"))
    ]
    print(f"读音总数：{len(prompts)}；待生成：{len(missing)}", flush=True)

    if missing:
        import mlx.core as mx
        import soundfile as sf
        from mlx_audio.tts.utils import load_model

        model = load_model(MODEL)
        for offset in range(0, len(missing), args.batch_size):
            batch = missing[offset:offset + args.batch_size]
            position = min(offset + len(batch), len(missing))
            print(f"[{position}/{len(missing)}] 批量生成 {batch[0][0]} … {batch[-1][0]}", flush=True)
            mx.random.seed(3101 + args.seed_offset + offset)
            results = list(model.batch_generate(
                texts=[f"{GENERATION_TEXT_OVERRIDES.get(key, char)}。" for key, char in batch],
                instructs=[pronunciation_instruction(key) for key, _ in batch],
                lang_code="Chinese",
                max_tokens=32,
            ))
            if len(results) != len(batch):
                raise RuntimeError(f"批量生成不完整：应有 {len(batch)}，实际 {len(results)}")
            by_index = {result.sequence_idx: result for result in results}
            for sequence_idx, (key, char) in enumerate(batch):
                result = by_index.get(sequence_idx)
                if result is None:
                    raise RuntimeError(f"批量生成缺少读音：{key}")
                sample_rate = int(getattr(result, "sample_rate", 0) or getattr(model, "sample_rate", 24000))
                waveform = normalize(result.audio)
                # Long output usually means the model ignored the one-character
                # instruction and added commentary. Retry only that syllable.
                for attempt in range(3):
                    problem = quality_problem(waveform, sample_rate)
                    if problem is None:
                        break
                    print(f"  {key} 音频异常（{problem}），单独重试 {attempt + 1}/3", flush=True)
                    mx.random.seed(7103 + args.seed_offset + offset + sequence_idx * 11 + attempt)
                    retry_results = list(model.generate_voice_design(
                        text=f"{GENERATION_TEXT_OVERRIDES.get(key, char)}。",
                        instruct=pronunciation_instruction(key),
                        language="Chinese",
                        max_tokens=32,
                    ))
                    if not retry_results:
                        continue
                    retry = retry_results[0]
                    sample_rate = int(getattr(retry, "sample_rate", 0) or getattr(model, "sample_rate", 24000))
                    waveform = normalize(retry.audio)
                problem = quality_problem(waveform, sample_rate)
                if problem is not None:
                    raise RuntimeError(f"读音反复生成异常：{key}，{problem}")
                sf.write(CACHE / f"{key}.wav", waveform, sample_rate, subtype="PCM_16")

    import soundfile as sf

    sample_rate = 24000
    if args.export_files or not args.assemble_only:
        output_dir = args.output / "pronunciations"
        output_dir.mkdir(parents=True, exist_ok=True)
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("未找到 ffmpeg")
        jobs = [
            (key, char)
            for key, char in prompts.items()
            if (not requested_keys or key in requested_keys)
            and (args.overwrite or not (output_dir / f"{key}.m4a").exists())
        ]
        print(f"待导出独立读音：{len(jobs)}", flush=True)
        with tempfile.TemporaryDirectory(prefix="ziya-pronunciation-files-") as temp_dir:
            temp = Path(temp_dir)
            def export(job):
                key, char = job
                waveform, current_rate = sf.read(CACHE / f"{key}.wav", dtype="float32")
                if current_rate != sample_rate:
                    raise RuntimeError(f"采样率不一致：{key} = {current_rate}")
                wav = temp / f"{key}.wav"
                clipped = normalize_loudness(first_utterance(waveform, sample_rate))
                sf.write(wav, clipped, sample_rate, subtype="PCM_16")
                subprocess.run([
                    ffmpeg, "-loglevel", "error", "-y", "-i", str(wav),
                    "-c:a", "aac", "-b:a", "48k", str(output_dir / f"{key}.m4a"),
                ], check=True)
                return key, {
                    "sample": char,
                    "duration": round(len(clipped) / sample_rate, 3),
                    "sha256": hashlib.sha256(clipped.tobytes()).hexdigest(),
                }
            with ThreadPoolExecutor(max_workers=8) as pool:
                for position, _ in enumerate(pool.map(export, jobs), 1):
                    if position % 100 == 0 or position == len(jobs):
                        print(f"[{position}/{len(jobs)}] 已导出", flush=True)
        manifest = {}
        for key, char in prompts.items():
            waveform, current_rate = sf.read(CACHE / f"{key}.wav", dtype="float32")
            if current_rate != sample_rate:
                raise RuntimeError(f"采样率不一致：{key} = {current_rate}")
            clipped = normalize_loudness(first_utterance(waveform, sample_rate))
            metrics = audio_metrics(clipped, sample_rate)
            manifest[key] = {
                "sample": char,
                "duration": round(metrics["duration"], 3),
                "rms": round(metrics["rms"], 5),
                "peak": round(metrics["peak"], 5),
                "sha256": hashlib.sha256(clipped.tobytes()).hexdigest(),
            }
        manifest_target = args.output / "pronunciations-manifest.json"
        manifest_target.write_text(
            json.dumps(dict(sorted(manifest.items())), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"完成：{len(prompts)} 个按需读音文件", flush=True)
        return

    silence = np.zeros(round(sample_rate * 0.12), dtype=np.float32)
    parts = []
    entries = {}
    cursor = 0
    for key, char in prompts.items():
        waveform, current_rate = sf.read(CACHE / f"{key}.wav", dtype="float32")
        if current_rate != sample_rate:
            raise RuntimeError(f"采样率不一致：{key} = {current_rate}")
        waveform = np.asarray(waveform, dtype=np.float32).squeeze()
        waveform = first_utterance(waveform, sample_rate)
        start = cursor / sample_rate
        duration = len(waveform) / sample_rate
        entries[key] = {"start": round(start, 4), "duration": round(duration, 4), "sample": char}
        parts.extend((waveform, silence))
        cursor += len(waveform) + len(silence)

    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ziya-pronunciations-") as temp_dir:
        wav = Path(temp_dir) / "pronunciations.wav"
        sf.write(wav, np.concatenate(parts), sample_rate, subtype="PCM_16")
        convert(wav, target)
    index_target.write_text(json.dumps({"audio": "/audio/pronunciations.m4a", "entries": entries}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"完成：{target}（{target.stat().st_size / 1024 / 1024:.1f} MB）", flush=True)


if __name__ == "__main__":
    main()
