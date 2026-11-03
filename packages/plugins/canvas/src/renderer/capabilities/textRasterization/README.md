# DOM 卡片光栅化

本 capability 接受正式正文 renderer 给出的 HTMLElement，不理解 Tiptap JSON，不复制正文 schema。`measure` 与 `rasterize` 使用同宽 DOM、产品 CSS 与字体；后者只画指定的可见框，支持横纵 offset 和 tileWidth，最大纹理边默认 4096，长卡由调用方分块。完整 width 决定正文排版，tileWidth 只决定当前纹理宽，不能用切片宽重新换行。

DOM 安装后等待 fonts 和图片 decode。图片必须经内容 provider 从受管字节转成 blob/data URL；不放宽媒体协议 CORS。普通隐藏窗口可能成功触发 paint 却输出透明图，后台提供者必须选择已验证的 offscreen Host 能力。实验 API 不可用、paint 超时或中断时返回错误，由文档类型决定身份牌反馈，不伪造出图成功。

`measureBatch` 先安装同批各自宽度的DOM，再集中读取高度，避免每张卡交替写入和读取布局。结果按请求顺序返回标准 settled result；某张图片解码失败不阻断其他正文，取消仍中止整批。正式正文调度一次至多32卡，共享一个staging和paint流程。

`createLatestRasterQueue` 串行使用 staging DOM，默认至多一个运行任务和 64 个待处理项。同一 key 的旧任务被替换；已完成的旧结果也会释放。调用方取消离屏请求，并对 dropped 结果按当前可见需求重新调度，不保留无限积压。

`cardRasterKey` 覆盖正文修订、主题、DPR、材质、LOD、字体和界面缩放；业务应按实际影响区分正文与外框，材质只影响外框时复用正文。光栅器销毁后不再安装 DOM，返回的 bitmap 由接收者或队列释放。

`rasterizeBatch` 将同批可见片段装入最长边4096的 paint atlas，再通过独立 OffscreenCanvas 裁出每个 ImageBitmap，防止小碎片保留整页底图。队列的 executeBatch 仍只有一个运行批次；同批一张卡取消只释放它的结果，其他卡继续完成。销毁会中断 paint 等待。

同 runner/DPR 的正文视觉 gate：`node packages/plugins/canvas/dev/probes/run-visual-probe.mjs`。实时 DOM、HTML 光栅、Pixi 三者都使用正式正文 fragment、CSS 和 system-ui 字体，覆盖中文、Emoji、列表、行内格式、引用、代码与表格，以及两主题/两材质。比较实时 DOM 墨迹范围内的前景交并比（下限 0.95），排除材质外框。它检查正文缺失、截断与错位，不锁定外观布局；输出只在 `_dev_data/canvas-visual-probe/`。
