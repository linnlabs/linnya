# 文档光栅化技术探针

本入口验证真实 Electron 的 HTML-in-Canvas 排版、绘制与 WebGL 上传，不参与插件发布。它使用真实 Tiptap 文档树、Editor 排版 token、中文/拉丁文字/粗体/列表与约五万字长卡，不把手画文字当作 DOM 光栅化证据。

DOM/bitmap 的 Windows LCD 与灰阶 AA 区分、真实逐字簇/行边界、原 raw 指标和损坏反例门禁由 [文字视觉 oracle](./visualOracle/README.md) 拥有。旧 PNG 没有新 metadata 时只保留诊断，不补造通过。

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

完整截图窗口另由 Electron [client-area bounds](https://www.electronjs.org/docs/latest/api/base-window#wingetcontentbounds)除以[实际网页zoom](https://www.electronjs.org/docs/latest/api/web-contents#contentsgetzoomfactor)取得CSS尺寸，再结合当前DPR严格核对PNG物理大小。DOM整数innerWidth/innerHeight只作观测，不能用来推断奇数DIP窗口在2倍zoom下的半CSS像素。每块在验证前保存DOM视口、native contentSize/contentBounds、capture前后zoom与实际PNG尺寸；缺少这些事实的历史Linux截图不能补造新口径资格。仍拒绝任何尺寸或字节不符，不接受任意更大的截图。

Linux CI 显式使用已有 `CANVAS_PERFORMANCE_SOFTWARE=1` 路径和 SwiftShader；六组计数从 `canvas-software-probe/results.json` 校验，视觉报告也标记软件渲染。独立制品 smoke 继承相同软件环境，保留 worker 的实际 GPU/版本/渲染配置原件。软件结果只证明功能与确定性工作量，不能用作硬件帧率资格。独立制品 smoke 在依赖及平台准备成功后继续运行，即使前面的绘制/视觉失败；任何失败步骤仍使作业失败，不用 `continue-on-error` 掩盖。

静态DOM/位图/Pixi正文比较使用正式worker已有的`renderingMode: capture`，要求Kernel实际resolution与DOM/raster DPR一致、canvas真实物理尺寸匹配CSS卡框×DPR。采样事实先独立写出，失败也保留mode/resolution/物理尺寸/renderStatus；截图裁成2x不能把1x软件交互画布冒充2x质量。软件交互的1x降级继续由counts及既有冒烟验证；fade/scene/motion入口不全局改成capture，生产降级、绘制质量与视觉阈值均不改。

正文完成等待保持5000ms时限及两个真实rAF确认。最终返回前重新读取失败、排队、运行、媒体资源、纹理过渡和当前正文readiness；两帧期间新出现的paint失败不能被先前空队列掩盖。近景文字和媒体共用正式当前内容键的readiness，旧正文receipt或尚未draw的新正文都不算完成；远景仍遵循既有地图/缩略图LOD，不强迫绘制不需要的正文。

performance初始化先保存安装前的Kernel实际renders，再等待该计数增加；身份牌的独立准备task可能跨过第一rAF，不能把回调发生当成首画。等待使用既有5s完成边界且超时失败，不调用capture强制准备或draw。installMs与包含初始化/预热的firstFrameMs均计入这段真实等待；它只证明几何首画，当前正文完整仍由独立readiness与实际draw门判断。

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

`CANVAS_VISIBLE_UPDATE_CHANGE=identity-control CANVAS_VISIBLE_IDENTITY_ARM=changing|stable`是独立两臂实验，各用`canvas-visible-identity-<arm>-probe`目录和profile。相同before为500张两段20:NNN正文、rev1；两臂先实际绘制全部旧身份牌再补齐旧body，显式共同glyph预热。after均为rev2且第二段21:NNN，changing首段也变21，stable首段保留20；唯一主变量为身份牌首行是否改变。固定高度、字体、相机、DPR、500个Agent动画ID和绘制门禁均相同，另存before/after图片与每卡下段实际像素变化、首行变更计数及上传分类。此warm夹具不代表r4原始单行状态或实际App性能；默认color/text入口不加此预热。

`node packages/plugins/canvas/dev/probes/run-identity-atlas-probe.mjs`验证身份牌图集和同机原Pixi Text：中文、ZWJ emoji、RTL、组合符、连字与Indic整串，在DPR1/2及分数世界缩放下比较真实RGBA墨迹，保存双方PNG后才按IoU≥.995/归一alpha误差≤.01断言。另验证同串共享、单页预算下DPR替换、隐藏页淘汰后复用、最后视图释放及生成器消费失败后的资源归还。它是独立功能像素门禁，不作帧率验收。原完整visual probe继续验证内核fallback、contextloss、正文实际draw/淡入与裁切。

同一入口另以真实MapLabels/Kernel验证18/120个grapheme边界与宽度省略：已知完整emoji/ZWJ/音标前缀交给独立浏览器Canvas或原Pixi Text作参考，不调用被测prefix/fitting生成期望值。先保双方PNG及实际尺寸，再沿用IoU≥.995墨迹门；近景确认body为零且实际draw后身份牌存在，不以纯字符串结果代替GPU接线。

`CANVAS_PERFORMANCE_ZOOM_PAINT_TRACE=1 CANVAS_PERFORMANCE_ZOOM_TRACE=1`仅在正式100×20ms缩放段安装paint/GL来源分类，输出独立`canvas-zoom-paint-diagnostic`，不让2500张全景初载占满事件上限。开启后明确diagnostic/profiling且无硬件资格；事件仍有16384上限，overflow非零不能宣称完整分账。详帧增加实际camera、可见卡数、identityBytes与队列请求量；逐wheel保存Node发送区间和Renderer实际收到的同钟时间，不能用末端资源快照推峰期。trace不启用Screenshot，录制期间不截图；测量前既有PNG步骤和所有原动作不改。原默认Native入口及普通ZOOM_TRACE观察字段不变。

`CANVAS_PERFORMANCE_COMPARISON=1`仅把固定版本对照标为`diagnostic:comparison`、`validHardwareRun:false`；未启用Profiler时`profiling`仍为false。该标记不改变动作、延时、窗口或Renderer，默认入口不变。对照必须各用独立输出/profile，并在外部manifest分别记录Renderer payload和共用Node harness的source/hash、实际driver与缓存温度；不能把混合来源或有限A/B/A结果当成完整硬件验收。

每例仅在内存保留已有阶段结果；异常时一次写`*-failure-progress.json`，包括具体stage、已经取得的initial/overview/pan/body/zoom/drag target/frames/intents。正常计时不增加阶段文件I/O，旧首败未落盘的数据不补造。

`CANVAS_PERFORMANCE_INPUT_TRACE=1`固定单次image2500uniform与拖500，输出独立`canvas-input-diagnostic`。它保持原输入动作、延时与焦点策略，绝不自动focus或重试；[Electron43官方合同](https://github.com/electron/electron/blob/v43.8.1/docs/api/web-contents.md#contentssendinputeventinputevent)要求所属BrowserWindow已聚焦，macOS的webContents焦点也不能代替窗口焦点。因此Node同时记录Window/webContents focus/blur、每个原send的前后时间与isFocused；Renderer只观察本夹具pointer/focus及既有intent，保存mainCanvas目标、坐标、相机、选择与命中卡当前正文receipt，不读取键入正文/其它页面内容。两端各限512条且保留overflow，结束移除监听；未知或截断不能冒完整分账。该模式始终diagnostic且无硬件资格，`profiling`仍只陈述实际Profiler/trace是否开启。默认不安装逐输入诊断观察器，失败原件不因新诊断回填。

正式Native另有窄焦点资格，区别于逐输入诊断：pan/zoom/drag各自开始/结束读取Window和webContents焦点，既有采集start/finish携带documentFocus。活动段仅保留两进程首次blur，重新聚焦不能抹掉段内失焦；不记录pointer或正文，不增加正常IPC、阶段磁盘I/O或每帧工作。末尾`inputQualification`保存三段事实与首次违反原因，`validHardwareRun`要求它合格；动作即使move500成功也不能补资格。所有段末/失败收口卸载owned监听，失焦只标未具资格，不自动focus、等待或重试。旧647/77c/9e原件未记录这些事实，仍按当时字段解释并明确焦点证据缺失，不能回填或借新诊断升级资格。
