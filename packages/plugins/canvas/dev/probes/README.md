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

像素检查仅从正式kernel输出取样，排除页面承载的HTML atlas；蓝色判定保留既定地图透明度的混合结果，不假设所有图片都以原图全不透明度绘制。

`CANVAS_PERFORMANCE_BODY_PROFILE=1`将V8采样区间固定为近景定位请求前到首次正文完成后的收集结束，用于归因初次补图尖峰；另存`*-body.cpuprofile`。与拖动CPU采样一样，开启后`validHardwareRun=false`，不能以诊断采样代替无观测器的硬件门槛。

`CANVAS_PERFORMANCE_RESOURCE_PROFILE=1`仅为媒体初次资源接纳到全局正文完成的区间保存`*-resources.cpuprofile`；未收敛也先保存采样与状态再失败。此诊断同样取消硬件基线资格。

近景首次补图先启动采集并等待采集器自己的首个真实rAF建立基准，再调用closeView；不能把窗口开在定位之后，漏掉首次Graphics编译帧。该口径使用`production-dom-v5-body-baseline` / `production-media-provider-v2-body-baseline`；历史v4/v1原始证据保留，不混为同一冷补图基线。`CANVAS_PERFORMANCE_DISTRIBUTIONS=cluster`可缩小诊断窗口，CI仍强制六行齐全。

`CANVAS_PERFORMANCE_ZOOM_TRACE=1`仅诊断明确缩放故障：保存Electron43的Chromium trace（CPU ProfileChunks、GC、渲染/GPU轨道和UserTiming），以及同阶段逐rAF时间、实际draw和资源/队列计数。仅此模式安装观察器并在真实rAF基准后发送滚轮；输出永远取消硬件基线资格。GPU轨道或采样不足时如实保留限制，不能把host调用耗时视作GPU执行。实现比照[Electron43 contentTracing](https://github.com/electron/electron/blob/v43.8.1/docs/api/content-tracing.md)及[Playwright的CPU/timeline类别](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/crBrowser.ts)。

Dawn内部观测使用已核[Chromium150的明确类别映射](https://github.com/chromium/chromium/blob/150.0.7871.250/gpu/command_buffer/service/dawn_platform.cc#L225)`disabled-by-default-gpu.dawn`。报告保留安装版本`getCategories()`原件和该类别是否存在；缺失时不换成其他类别或改变GPU后端。

每段报告同时保存既有采集器的`frameIntervalsMs`原始间隔，不新增逐帧工作。平均、p95和最大值不足以证明常用档掉帧比例；验收需明确60Hz的16.667ms参考、超时间隔占比，以及长停顿漏掉的参考帧机会，另保留实际120Hz参考结果。历史缺原始间隔的报告不能反推这些比例。

scene视觉夹具只在自己的页面临时固定`performance.now`，按明确逻辑时间采样120ms纹理替换与160/200ms场景淡入。真实timer、RAF、Pixi、GPU和正文receipt不替换，采样前有界等待生产脉冲及实际主画布draw；首显必须为当前新像素且尚未完整，终点仍检查资源释放与完整draw。所有出口恢复原时钟。这样CI长暂停不会把64ms中间态推过终点，硬件性能探针仍使用真实时钟。做法参考[Playwright受控时钟](https://playwright.dev/docs/clock)，这里不模拟其timer/RAF调度。
