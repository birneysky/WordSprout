# 字芽 WordSprout

字芽是一款给小朋友使用的汉字书写启蒙 Web 应用。输入一个或多个汉字后，可以逐字观看标准笔顺动画、在米字格里跟写，并听到中文语音鼓励与纠错提示。

## 已实现

- 输入最多 12 个汉字并逐字学习
- 标准笔顺动画和自由跟写练习
- 开场讲解汉字读音、声调和总笔画数
- 逐笔播报“第几笔 + 笔画名称”，语音与书写同步
- 默认慢速演示，可在慢速和标准节奏间切换
- 写错提示、完成反馈与本机学习记录
- Qwen3-TTS 生成的自然中文逐笔提示、纠错与鼓励语音
- 内置完整的 9,574 字 Hanzi Writer 笔顺库；本地静态资源异常时自动切换双 CDN 数据源
- PWA 离线缓存：应用和已经打开过的字可断网继续使用
- 桌面端、平板与手机自适应

## 本地运行

需要 Node.js 22.13 或更新版本。

```bash
pnpm install
pnpm dev
```

打开 `http://localhost:3000`。

## 构建与检查

```bash
pnpm build
pnpm test
pnpm lint
```

笔顺数据来自 `hanzi-writer-data`，书写交互由 `hanzi-writer` 驱动。汉字读音、教学提示和笔画名称均由同一套 Qwen3-TTS VoiceDesign 老师音色生成，并随应用离线提供。带声调的汉字读音保存为独立小文件，课程只按需加载当前输入汉字的读音。

重新生成教学提示音：

```bash
/opt/homebrew/bin/python3.12 tools/generate_ziya_audio.py --overwrite
/Users/bruce/.nvm/versions/node/v22.23.2/bin/node tools/build_pronunciation_prompts.mjs
/opt/homebrew/bin/python3.12 tools/generate_qwen_pronunciations.py --overwrite
```
