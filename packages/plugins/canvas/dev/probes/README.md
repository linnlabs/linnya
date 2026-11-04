# 文档光栅化技术探针

本入口验证真实 Electron 的 HTML-in-Canvas 排版、绘制与 WebGL 上传，不参与插件发布。它使用真实 Tiptap 文档树、Editor 排版 token、中文/拉丁文字/粗体/列表与约五万字长卡，不把手画文字当作 DOM 光栅化证据。

从仓库根完成冻结安装后运行：

```bash
node packages/plugins/canvas/dev/probes/run-render-probe.mjs
```

脚本只创建自己的 Electron 进程、窗口与独立 profile；输出在 `_dev_data/canvas-render-probe/`。结果包含 Electron/Chromium 版本、DPR、可见 DOM 与 canvas 子树的高度、实际像素墨迹和上传结果。只要候选窗口有一条真实排版和出图路径通过即成功；API 存在或没有抛错不算出图成功。

受管 worker 默认 `background` 模式仅承诺排版；需要实际后台绘制的 provider 声明 `renderingMode: 'offscreen'`。主窗口与 worker 共用 `CanvasDrawElement` 单一特性，renderer 仍要检测新旧 API。

2026-11-03 的 Electron 43.8.1 / Chromium 150 / macOS arm64 实测：普通隐藏 1×1 窗口可测高，但绘制结果完全透明；offscreen 窗口可测高、输出非空像素并成功上传 WebGL。两种窗口的默认 DPR 不同（普通 2、offscreen 1），因此业务请求必须传入目标 DPR，不能依赖窗口默认值。长卡这里只绘制 280×360 的可见框，没有分配全文纹理；不会据此宣称全量性能已通过。

相关事实以 [Electron offscreen 文档](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)和 [Chrome HTML-in-Canvas 文档](https://developer.chrome.com/docs/web-platform/html-in-canvas/2d)为参考，实际能力以本探针结果为准。

`node packages/plugins/canvas/dev/probes/run-visible-update-probe.mjs` 聚焦500张当前视口正文的冷更与实际绘制，先等待初始正文完整，再分别对比是否逐帧读取readiness；`CANVAS_VISIBLE_UPDATE_PROFILE=1`输出CPU profile。固定场景为25×20张88×72卡、104×88间隔、1400×900视口及DPR2，记录实际相机/视口，方便与产品表面对照。它只测kernel输入到当前正文已上传并实际绘制，明确不包含Backend提交，也始终标记offscreen diagnostic，不能代替正式Agent链或硬件验收。

硬件基线用`CANVAS_PERFORMANCE_INTERNAL_120=1`将探针窗口固定在活动的内建120Hz屏幕，并在开始/结束验证实际目标。外接屏改变primary不能静默改变基线；找不到目标或运行中移出目标则该次不具备硬件基线资格。报告保留当前commit、dirty与Renderer tree，只有计时后端变化时也能明确Renderer代码是否一致。此选项只定位探针窗口，不修改系统显示设置。

媒体上限基准加`CANVAS_PERFORMANCE_MEDIA=1 CANVAS_PERFORMANCE_COUNTS=2500`，默认依次测图片/文档的均匀与聚簇四组；`CANVAS_PERFORMANCE_KINDS=document`仅用于单类型定位。入口仍是同一performance runner；普通文字六组与媒体报告的fixtureVersion分开，不把过滤结果当完整CI计数门禁。

媒体使用正式`createCanvasCardContent`、引用元数据、4并发预读、128项/32MiB预览与图片显示缓存。Host只读端口返回固定同项目DTO和一份640×400蓝橙PNG（经过真实显示派生）；2500张图片共享该受管资源，文档有2500个独立目标，一半声明thumbnail封面、一半摘要。该夹具覆盖绘制与资源调度，不代表2500份不同原图的冷磁盘I/O。

每组先要求全局视口实际包含2500卡、当前资源与正文队列完成、250ms无持续重取及画面含固定图像的真实像素，随后走相同原生pan/zoom/500卡拖动。报告保留readImage/reference/preview次数、峰值并发、单目标最大重读次数与settled后计数；失败前也先写overview-settle现场，禁止只留Zod断言或成功API。预算和LOD来自生产代码，探针不覆盖它们。

`CANVAS_PERFORMANCE_BODY_PROFILE=1`将V8采样区间固定为近景定位请求前到首次正文完成后的收集结束，用于归因初次补图尖峰；另存`*-body.cpuprofile`。与拖动CPU采样一样，开启后`validHardwareRun=false`，不能以诊断采样代替无观测器的硬件门槛。
