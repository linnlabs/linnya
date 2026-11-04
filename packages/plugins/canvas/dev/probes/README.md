# 文档光栅化技术探针

本入口验证真实 Electron 的 HTML-in-Canvas 排版、绘制与 WebGL 上传，不参与插件发布。它使用真实 Tiptap 文档树、Editor 排版 token、中文/拉丁文字/粗体/列表与约五万字长卡，不把手画文字当作 DOM 光栅化证据。

从仓库根完成冻结安装后运行：

```bash
node packages/plugins/canvas/dev/probes/run-render-probe.mjs
```

脚本只创建自己的 Electron 进程、窗口与独立 profile；输出在 `_dev_data/canvas-render-probe/`。结果包含 Electron/Chromium 版本、DPR、可见 DOM 与 canvas 子树的高度、实际像素墨迹和上传结果。只要候选窗口有一条真实排版和出图路径通过即成功；API 存在或没有抛错不算出图成功。

受管 worker 默认 `background` 模式仅承诺排版；需要实际后台绘制的 provider 声明 `renderingMode: 'offscreen'`。主窗口与 worker 共用 `CanvasDrawElement` 单一特性，renderer 仍要检测新旧 API。

独立制品的 `run-worker-smoke.mjs` 在显式 `CANVAS_PERFORMANCE_SOFTWARE=1` 下使用 SwiftShader，与软件计数探针采用相同后端选择；默认路径不改。首次 worker 调用前保存 `canvas-worker-smoke/rendering-environment.json`，记录请求的绘图 profile、Electron/Chromium 版本与实际 GPU 信息，成功报告也携带该事实。该测试设置不关闭 sandbox，不进入生产窗口策略，不提供硬件帧率资格。

2026-11-03 的 Electron 43.8.1 / Chromium 150 / macOS arm64 实测：普通隐藏 1×1 窗口可测高，但绘制结果完全透明；offscreen 窗口可测高、输出非空像素并成功上传 WebGL。两种窗口的默认 DPR 不同（普通 2、offscreen 1），因此业务请求必须传入目标 DPR，不能依赖窗口默认值。长卡这里只绘制 280×360 的可见框，没有分配全文纹理；不会据此宣称全量性能已通过。

相关事实以 [Electron offscreen 文档](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)和 [Chrome HTML-in-Canvas 文档](https://developer.chrome.com/docs/web-platform/html-in-canvas/2d)为参考，实际能力以本探针结果为准。

DOM、位图、Pixi 三个对照区按同一字体和当前 DPR 比较。CI 桌面不一定容纳整个对照区，因此保持原排版与窗口尺寸，按实际可见内容视口滚动并等待真实绘制，再用 [Electron 43 的 capturePage](https://github.com/electron/electron/blob/v43.8.1/docs/api/web-contents.md#contentscapturepagerect-opts) 逐块截取。每块按实际滚动位置（包括末块被浏览器限制的位置）和 DPR 直接复制物理像素，排除滚动条，要求完整覆盖；所有出口恢复原滚动位置。每块原始 PNG、视口/尺寸事实及完整拼接图均保存，范围或尺寸不匹配即失败，不补空白、不插值、不降低 DPR 或内容对比阈值。

不使用 CDP 的 `captureBeyondViewport`：其 [Chromium 150 实现](https://github.com/chromium/chromium/blob/150.0.7871.250/content/browser/devtools/protocol/page_handler.cc)会临时启用设备模拟并改变截取表面，已在真实对照中造成 HTML-in-Canvas/WebGL 图层丢失。这里的滚动只改变静态页面的可见区域，不重新生成正文、调整布局或改变被测质量。

内容视口使用 [VisualViewport 的分数 CSS 尺寸](https://drafts.csswg.org/cssom-view/#dom-visualviewport-width)与 pageLeft/pageTop；不使用整数 clientWidth/clientHeight。Windows 原生滚动条在页面缩放后可占半个 CSS 像素，整数 API 会把末块实际可见的最后一列/行误判为越界；保持分数尺寸后仍严格核对完整物理像素，不放宽范围检查。

Linux CI 显式使用已有 `CANVAS_PERFORMANCE_SOFTWARE=1` 路径和 SwiftShader；六组计数从 `canvas-software-probe/results.json` 校验，视觉报告也标记软件渲染。独立制品 smoke 继承相同软件环境，保留 worker 的实际 GPU/版本/渲染配置原件。软件结果只证明功能与确定性工作量，不能用作硬件帧率资格。独立制品 smoke 在依赖及平台准备成功后继续运行，即使前面的绘制/视觉失败；任何失败步骤仍使作业失败，不用 `continue-on-error` 掩盖。

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

`CANVAS_PERFORMANCE_PAINT_TRACE=1`仅诊断Linux软件绘图的paint兑现：记录原生requestPaint、真实paint、drawElementImage、逐片复制和bitmap transfer的真实时钟及尺寸/片数/测高卡数，保留既有timeout白名单现场，不记录正文。原生this/重载参数/返回值/异常不变，finally恢复全部descriptor；不开启时不安装观察器，也不进入生产插件入口。输出固定为独立`_dev_data/canvas-paint-diagnostic/`，不会覆盖六行counts原件，结果明确diagnostic/profiling且无硬件资格。可配既有`CANVAS_PERFORMANCE_BODY_PROFILE=1`和单例筛选；单例只作诊断，完整六行门禁仍需原样通过，不能仅延长2000ms paint或5000ms等待时限。

visible-update原默认保留color历史对照。`CANVAS_VISIBLE_UPDATE_CHANGE=text`切到独立`canvas-visible-text-update-probe`目录，固定r4首个500之前的逻辑状态：前50为20:NNN/rev21，其余为卡NNN/rev1，不额外执行20次warm写入；初始500当前body全部settled后一次改为21:NNN（6字符）、rev+1。固定高度、字体链、antialiased、1400×900/DPR2及逐数相机均匹配该场景。text默认仅polled-animated，`CANVAS_VISIBLE_UPDATE_CASE`可显式选择对照；500个animateIds走正式200ms batch。报告firstAny/allVisible/final当前revision实际draw和原始RAF间隔，仍无Backend及硬件资格。

可叠加`CANVAS_PERFORMANCE_PAINT_TRACE=1 CANVAS_VISIBLE_UPDATE_TRACE=1`保存原生paint阶段和Chromium timeline/CPU ProfileChunks；此时不再同时启动独立Profiler。原Zoom录制路径和默认标记保持不变，正文更新使用独立visible-update标记。单独`CANVAS_VISIBLE_UPDATE_PROFILE=1`仍可输出CPU profile。所有录制均仅作根因诊断，不能代替实际App的500正文门槛。

paint诊断另记录真实WebGL1/2的texImage2D/texSubImage2D原调用：区分Canvas身份牌与ImageBitmap正文来源、源/上传物理尺寸和时间，不读取像素。typed-array/null分配/buffer-offset分别保留，未识别源明确unknown；不同重载参数原样转发，停止时恢复原descriptor。host调用耗时仍不代表GPU执行，须与同钟GpuMain命令及呈现等待对照；overflow非零时不能把记录当作完整分账。
