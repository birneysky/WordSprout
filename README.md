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
- 读音文件自动执行解码、时长、响度、峰值和声调轮廓审计；不合格音频不会作为可播放选项
- 内置完整的 9,574 字 Hanzi Writer 笔顺库；本地静态资源异常时自动切换双 CDN 数据源
- PWA 离线缓存：应用和已经打开过的字可断网继续使用
- 桌面端、平板与手机自适应

## 本地运行

需要 Node.js 22.13 或更新版本。

```bash
nvm use
pnpm install
pnpm dev
```

项目带有 `.nvmrc`。即使当前终端仍使用旧版 Node，`npm run dev`、`npm run build` 和 `npm test` 也会尝试自动调用本机 NVM 中已经安装的 Node 22；若尚未安装，请先运行 `nvm install 22`。

打开 `http://localhost:3000`。

## 构建与检查

```bash
pnpm build
pnpm test
pnpm lint
```

笔顺数据来自 `hanzi-writer-data`，书写交互由 `hanzi-writer` 驱动。教学提示和笔画名称由 Qwen3-TTS VoiceDesign 老师音色生成；绝大多数汉字读音采用 `audio-cmn` 真人录音，轻声和少数缺失音节使用本地生成的回退音频。所有音频均随应用离线提供，课程只按需加载当前输入汉字的读音。第三方音频来源及许可见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

重新生成教学提示音：

```bash
/opt/homebrew/bin/python3.12 tools/generate_ziya_audio.py --overwrite
/Users/bruce/.nvm/versions/node/v22.23.2/bin/node tools/build_pronunciation_prompts.mjs
/opt/homebrew/bin/python3.12 tools/generate_qwen_pronunciations.py --overwrite
```

重新导入并转换 `audio-cmn` 真人读音（会覆盖所有可匹配的非轻声音节）：

```bash
/Users/bruce/.nvm/versions/node/v22.23.2/bin/node tools/import_audio_cmn.mjs
```

重新生成后执行全量读音审计：

```bash
/opt/homebrew/bin/python3.12 tools/audit_pronunciations.py
/Users/bruce/.nvm/versions/node/v22.23.2/bin/node tools/audit_pronunciation_mapping.mjs
```

第一条命令会验证 1,232 个读音是否缺失、损坏、过轻或时长异常，并使用音高轮廓筛选需要人工复核的声调离群项；第二条命令验证每个音频键和样本字的字典读音是否一致。声调轮廓属于筛查手段，不替代最终的普通话人工验收。
