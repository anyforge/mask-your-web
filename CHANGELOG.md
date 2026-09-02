# Changelog

所有值得注意的变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。
All notable changes are documented here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-09-02

### Added · 新增

- **Canvas 表格脱敏 · Canvas table masking** — 对 canvas 渲染的表格（如飞书电子表格）截图并 OCR 识别后，在 canvas 上方用覆盖层打码，解决此类表格 DOM 无文本节点、传统「文本 / HTML 表格 / 图片」三条脱敏路径均失效的盲区。／Screenshot canvas-rendered tables (e.g. Feishu spreadsheets), OCR them, then mask matched text via an overlay — fixing the blind spot where such tables have no DOM text nodes.
- **开关与阈值 · Toggle & threshold** — 配置页新增「Canvas 表格脱敏」独立开关（默认关）+ 可配置最小尺寸阈值（宽 × 高，默认 200×200），打开开关时自动展开阈值输入。／New "Canvas table masking" toggle (default off) + configurable min-size threshold (default 200×200); the threshold inputs expand when the toggle is on.
- **动态更新 · Dynamic rescan** — canvas 打码周期重扫（2 秒）+ 滚动 / 滚轮 / 点击事件防抖触发，跟随表格滚动实时更新。／Rescans periodically (2s) and on scroll / wheel / click (debounced).

### Notes · 说明

- 仅使用「全文」规则（正则 / 词典）；「列名 / 列值」对 canvas 无列语义、不适用。／Uses only "Full text" recognizers (regex / dict); column-name / column-value rules don't apply.
- 真打码（无悬停显原文），覆盖层点击穿透（`pointer-events: none`）。／True masking (no hover); overlay is click-through.
- 跨域污染的 canvas（tainted）无法读取位图，自动跳过。／Tainted canvases are skipped.

## [1.0.0] - 2026-09-02

### Added · 新增

- **首个版本 · Initial release** — 文本脱敏（正文 + HTML 表格，保留首尾 N 字符、悬停显原文）、图片 OCR 打码、按站点开关、正则/词典规则、JSON 配置导入导出、中英双语界面。／Text masking (body + HTML tables, hover to reveal), image OCR redaction, per-site toggle, regex/dict rules, JSON config, bilingual UI.
