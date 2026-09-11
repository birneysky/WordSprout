"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import HanziWriter from "hanzi-writer";
import type { CharacterJson } from "hanzi-writer";
import { getReadingOptions, getReadings, getStrokeNames, Reading, STROKE_AUDIO_NAMES } from "./character-learning";

const EXAMPLES = ["日月山川", "天地人", "春风雨", "大小多少"];
const DEFAULT_TEXT = "永";
const HANZI_DATA_VERSION = "2.0.1";
type WriterStatus = "loading" | "ready" | "error" | "animating" | "practicing" | "complete";
type Pace = "slow" | "standard";

const PACE = {
  slow: { strokeSpeed: 0.42, betweenStrokes: 680, voiceLead: 170 },
  standard: { strokeSpeed: 0.62, betweenStrokes: 420, voiceLead: 120 },
} as const;

function onlyHanzi(value: string) {
  return Array.from(value).filter((char) => /[\u3400-\u9fff\uf900-\ufaff]/u.test(char)).slice(0, 12);
}

function isCharacterData(value: unknown): value is CharacterJson {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<CharacterJson>;
  return Array.isArray(data.strokes)
    && data.strokes.length > 0
    && Array.isArray(data.medians)
    && data.medians.length === data.strokes.length;
}

async function loadCharacterData(char: string) {
  const encodedChar = encodeURIComponent(char);
  const sources = [
    `/hanzi-data/${encodedChar}.json?v=${HANZI_DATA_VERSION}`,
    `https://cdn.jsdelivr.net/npm/hanzi-writer-data@${HANZI_DATA_VERSION}/${encodedChar}.json`,
    `https://unpkg.com/hanzi-writer-data@${HANZI_DATA_VERSION}/${encodedChar}.json`,
  ];
  let lastError: unknown;

  for (const source of sources) {
    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`character data request failed: ${response.status}`);
      const data: unknown = await response.json();
      if (!isCharacterData(data)) throw new Error("invalid character data");
      return data;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("character data unavailable");
}

export default function WritingStudio() {
  const [input, setInput] = useState(DEFAULT_TEXT);
  const [characters, setCharacters] = useState([DEFAULT_TEXT]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState<WriterStatus>("loading");
  const [voiceOn, setVoiceOn] = useState(true);
  const [pace, setPace] = useState<Pace>("slow");
  const [readingOverrides, setReadingOverrides] = useState<Record<number, string>>({});
  const [completed, setCompleted] = useState<string[]>([]);
  const [message, setMessage] = useState("先看一遍笔顺，再来亲手写写看");
  const writerHost = useRef<HTMLDivElement>(null);
  const writer = useRef<HanziWriter | null>(null);
  const strokeCount = useRef(0);
  const strokeNames = useRef<string[]>([]);
  const voiceEnabled = useRef(true);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioResolve = useRef<(() => void) | null>(null);
  const activeChar = characters[activeIndex] ?? DEFAULT_TEXT;
  const lessonText = characters.join("");
  const readings = useMemo(() => getReadings(lessonText), [lessonText]);
  const readingOptionsByCharacter = useMemo(() => getReadingOptions(lessonText), [lessonText]);
  const readingOptions = readingOptionsByCharacter[activeIndex] ?? [];
  const contextualReading = readings[activeIndex] ?? getReadings(activeChar)[0];
  const reading = readingOptions.find((item) => item.audioKey === readingOverrides[activeIndex]) ?? contextualReading;

  function playPrompt(name: string) {
    return new Promise<void>((resolve) => {
      if (!voiceEnabled.current) { resolve(); return; }
      stopAudio();
      const player = new Audio(`/audio/${name}.m4a`);
      audio.current = player;
      let timer = window.setTimeout(() => finish(), 8000);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        if (audio.current === player) audio.current = null;
        if (audioResolve.current === finish) audioResolve.current = null;
        resolve();
      };
      audioResolve.current = finish;
      player.onloadedmetadata = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(finish, Math.min(8000, player.duration * 1000 + 350));
      };
      player.onended = finish;
      player.onerror = finish;
      player.play().catch(finish);
    });
  }

  function stopAudio() {
    audio.current?.pause();
    audio.current = null;
    audioResolve.current?.();
    audioResolve.current = null;
  }

  function playPronunciation(key: string) {
    return playPrompt(`pronunciations/${key}`);
  }

  async function playReading() {
    if (!reading) return;
    await playPrompt("intro-reading");
    await playPronunciation(reading.audioKey);
    await playPrompt(`tone-${reading.tone || 5}`);
  }

  function toggleVoice() {
    const next = !voiceEnabled.current;
    voiceEnabled.current = next;
    setVoiceOn(next);
    if (!next) {
      stopAudio();
    }
  }

  useEffect(() => {
    const saved = window.localStorage.getItem("ziya-completed");
    if (saved) queueMicrotask(() => {
      try { setCompleted(JSON.parse(saved)); } catch { setCompleted([]); }
    });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    for (const item of getReadings(characters.join(""))) {
      fetch(`/audio/pronunciations/${item.audioKey}.m4a`).catch(() => undefined);
    }
  }, [characters]);

  useEffect(() => {
    if (!writerHost.current) return;
    const host = writerHost.current;
    const getWriterSize = () => Math.max(1, Math.floor(Math.min(host.clientWidth, host.clientHeight)));
    const getWriterPadding = (size: number) => size / 12;
    host.innerHTML = "";
    setStatus("loading");
    setMessage(`正在准备“${activeChar}”的字帖…`);
    const initialSize = getWriterSize();
    const currentWriter = HanziWriter.create(host, activeChar, {
      width: initialSize,
      height: initialSize,
      padding: getWriterPadding(initialSize),
      strokeColor: "#213e34",
      radicalColor: "#e36f43",
      outlineColor: "#d7d0bd",
      drawingColor: "#ef8354",
      drawingWidth: 24,
      strokeAnimationSpeed: PACE[pace].strokeSpeed,
      delayBetweenStrokes: PACE[pace].betweenStrokes,
      showCharacter: true,
      showOutline: true,
      charDataLoader: (char, onComplete, onError) => {
        loadCharacterData(char)
          .then(onComplete)
          .catch(onError);
      },
      onLoadCharDataSuccess: (data) => {
        strokeCount.current = data.strokes.length;
        strokeNames.current = getStrokeNames(activeChar);
        setStatus("ready");
        setMessage(`“${activeChar}”一共有 ${data.strokes.length} 画，准备好了吗？`);
      },
      onLoadCharDataError: () => {
        setStatus("error");
        setMessage(`暂时没有找到“${activeChar}”的笔顺数据`);
      },
    });
    writer.current = currentWriter;

    const resizeObserver = new ResizeObserver(() => {
      const size = getWriterSize();
      currentWriter.updateDimensions({
        width: size,
        height: size,
        padding: getWriterPadding(size),
      });
    });
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      currentWriter.cancelQuiz();
      stopAudio();
    };
  }, [activeChar, pace]);

  function startLesson(value = input) {
    const clean = onlyHanzi(value);
    if (!clean.length) { setMessage("请先输入一个汉字哦"); return; }
    setCharacters(clean);
    setActiveIndex(0);
    setReadingOverrides({});
    setMessage(`我们来学习“${clean.join("、")}”`);
  }

  function submit(event: FormEvent) { event.preventDefault(); startLesson(); }

  async function animate() {
    if (!writer.current || status === "loading") return;
    const currentWriter = writer.current;
    currentWriter.cancelQuiz();
    setStatus("animating");
    setMessage(`${activeChar} · ${reading?.pinyin ?? ""} · ${reading?.toneLabel ?? ""}`);
    await currentWriter.hideCharacter({ duration: 180 });
    await playReading();
    if (strokeCount.current <= 30) await playPrompt(`total-strokes-${String(strokeCount.current).padStart(2, "0")}`);
    await playPrompt("look-start");
    for (let index = 0; index < strokeCount.current; index += 1) {
      if (writer.current !== currentWriter) return;
      const strokeName = strokeNames.current[index] ?? "这一笔";
      setMessage(`第 ${index + 1} 笔：${strokeName}`);
      if (index < 30) await playPrompt(`stroke-${String(index + 1).padStart(2, "0")}`);
      const nameAudio = STROKE_AUDIO_NAMES[strokeName]
        ? playPrompt(`stroke-name-${STROKE_AUDIO_NAMES[strokeName]}`)
        : Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, PACE[pace].voiceLead));
      await Promise.all([nameAudio, currentWriter.animateStroke(index)]);
      await new Promise((resolve) => window.setTimeout(resolve, PACE[pace].betweenStrokes));
    }
    setMessage("看清楚了吗？现在轮到你啦");
    await playPrompt("look-complete");
    if (writer.current === currentWriter) setStatus("ready");
  }

  function practice() {
    if (!writer.current || status === "loading") return;
    setStatus("practicing");
    setMessage("请在米字格里写一遍");
    void playPrompt("practice-start");
    writer.current.quiz({
      showHintAfterMisses: 2,
      highlightOnComplete: true,
      onMistake: (info) => {
        setMessage(`再想一想，第 ${info.strokeNum + 1} 笔从哪里开始？`);
        void playPrompt("mistake");
      },
      onCorrectStroke: (info) => {
        setMessage(`第 ${info.strokeNum + 1} 笔写对啦，继续！`);
        void playPrompt("correct");
      },
      onComplete: () => {
        setStatus("complete");
        setMessage(`太棒了！你会写“${activeChar}”了`);
        void playPrompt("complete");
        setCompleted((current) => {
          const next = Array.from(new Set([...current, activeChar]));
          window.localStorage.setItem("ziya-completed", JSON.stringify(next));
          return next;
        });
      },
    });
  }

  function move(direction: -1 | 1) {
    const next = activeIndex + direction;
    if (next >= 0 && next < characters.length) setActiveIndex(next);
  }

  function chooseReading(option: Reading) {
    setReadingOverrides((current) => ({ ...current, [activeIndex]: option.audioKey }));
    setMessage(`已选择读音：${option.pinyin} · ${option.toneLabel}`);
    void playPronunciation(option.audioKey);
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="字芽首页">
          <span className="brand-seed" aria-hidden="true" />
          <span>字芽<small>一笔一画，慢慢长大</small></span>
        </a>
        <div className="header-actions">
          <span className="offline-badge"><i />可离线学习</span>
          <button className="icon-button" onClick={toggleVoice} aria-label={voiceOn ? "关闭语音" : "打开语音"}>{voiceOn ? "🔊" : "🔇"}</button>
        </div>
      </header>

      <section className="hero" id="top">
        <p className="eyebrow"><span>✦</span> 今天想学哪个字？</p>
        <h1>让每一笔，都长出<span>小小的力量</span></h1>
        <p className="intro">输入一个字或一句话，字芽会带着小朋友看笔顺、听提示，再亲手写一遍。</p>
        <form className="search" onSubmit={submit}>
          <label htmlFor="character-input">输入想学的汉字</label>
          <div>
            <input id="character-input" value={input} maxLength={24} onChange={(event) => setInput(event.target.value)} placeholder="比如：春风又绿江南岸" />
            <button type="submit">开始学习 <span>→</span></button>
          </div>
        </form>
        <div className="examples"><span>试试看</span>{EXAMPLES.map((item) => <button key={item} onClick={() => { setInput(item); startLesson(item); }}>{item}</button>)}</div>
      </section>

      <section className="lesson-shell" aria-live="polite">
        <aside className="lesson-list">
          <div className="section-title"><span>本次字帖</span><em>{activeIndex + 1} / {characters.length}</em></div>
          <div className="character-list">
            {characters.map((char, index) => (
              <button key={`${char}-${index}`} className={index === activeIndex ? "active" : ""} onClick={() => setActiveIndex(index)}>
                <span>{char}</span><small>{completed.includes(char) ? "已学会 ✓" : index === activeIndex ? "正在学" : "未开始"}</small>
              </button>
            ))}
          </div>
          <div className="tip-card"><span>🌱</span><p><b>小提示</b>先看笔顺，再动手写。写慢一点，会记得更牢哦。</p></div>
        </aside>

        <article className="practice-card">
          <div className="practice-head">
            <div>
              <p>正在学习</p>
              <h2>{activeChar} <small>{reading?.pinyin} · {reading?.toneLabel}</small></h2>
              {readingOptions.length > 1 && (
                <div className="reading-choices" role="group" aria-label={`${activeChar}字读音`}>
                  <span>多音字</span>
                  {readingOptions.map((option) => (
                    <button
                      key={option.audioKey}
                      type="button"
                      className={option.audioKey === reading?.audioKey ? "active" : ""}
                      aria-pressed={option.audioKey === reading?.audioKey}
                      aria-label={`选择读音 ${option.pinyin}`}
                      disabled={status === "animating"}
                      onClick={() => chooseReading(option)}
                    >
                      {option.pinyin}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="lesson-options">
              <button className="pace-button" onClick={() => setPace((current) => current === "slow" ? "standard" : "slow")} disabled={status === "animating"}>⏱ {pace === "slow" ? "慢速" : "标准"}</button>
              <button className="listen" disabled={status === "animating"} onClick={() => void playReading()}>🔊 听读音</button>
            </div>
          </div>
          <div className="workspace">
            <div className="paper-wrap">
              <div className="rice-grid"><i /><b /></div>
              <div ref={writerHost} className="writer-host" aria-label={`${activeChar}字书写区`} />
              {status === "loading" && <div className="loading">字帖发芽中…</div>}
              {status === "error" && <div className="loading error">这个字还没收进字芽的字库</div>}
            </div>
            <div className="coach"><span className={status === "complete" ? "coach-face happy" : "coach-face"}>{status === "complete" ? "★" : "芽"}</span><p>{message}</p></div>
          </div>
          <div className="controls">
            <button className="secondary" onClick={animate} disabled={status === "loading" || status === "error" || status === "animating"}><span>▶</span> {status === "animating" ? "演示中…" : "看笔顺"}</button>
            <button className="primary" onClick={practice} disabled={status === "loading" || status === "error" || status === "animating"}><span>✎</span> 我来写</button>
          </div>
          {characters.length > 1 && <div className="pager">
            <button onClick={() => move(-1)} disabled={activeIndex === 0}>← 上一个</button>
            <div>{characters.map((_, index) => <i key={index} className={index === activeIndex ? "active" : ""} />)}</div>
            <button onClick={() => move(1)} disabled={activeIndex === characters.length - 1}>下一个 →</button>
          </div>}
        </article>
      </section>
      <footer><span>字芽 ZIYA</span><p>愿每个孩子，都能在一撇一捺里找到书写的快乐。</p></footer>
    </main>
  );
}
