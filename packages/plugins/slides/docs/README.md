# Slides Runtime Plugin Docs

本目录记录 Slides 从 host 内建实现迁入 runtime 插件包后的包内约定。

- `src/shared`：跨 backend / renderer 的 Slides 契约。
- `src/backend`：PPT 引擎、工具、agent、IPC、迁移和文档 hook。
- `src/renderer`：Slides 前端 domain、页面、工具卡、样式和 renderer ports。

前端 renderer 的长期权威文档见 [`../src/renderer/docs/README.md`](../src/renderer/docs/README.md)；Konva builder 契约见 [`../src/renderer/features/konvaPreview/functions/builders/README.md`](../src/renderer/features/konvaPreview/functions/builders/README.md)。

背景、色块和线条的纯色/渐变合同见 [`visual-paint-contract.md`](./visual-paint-contract.md)。

迁移过程中如果需要临时桥接 host 路径，必须先写清楚边界和退出条件，避免把路径别名当成长期架构。
