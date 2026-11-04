# Canvas renderer kernel

内核消费 Canvas 元素快照，拥有场景、相机、命中、交互意图和绘制资源，不拥有保存、正文解析、Agent、Host store 或 Vue 状态。`index.ts` 只暴露 `CanvasKernel` 合同与创建入口。Pixi 仅出现在 `render/pixi`。

`setElements(elements,{animateIds,batch})` 安装已提交或由调用方明确管理的场景投影；调用方根据正式提交来源选择动画ID，kernel不识别Agent。`setSelection` 只更新选择。`worldToScreen` / `screenToWorld` 是 DOM 编辑表面定位的共同坐标真源。Pointer 意图由 `onIntent` 发给 feature，最终移动在松手时产生；保存、冲突校验、撤销和组合多选移动由调用方负责。

整代元素安装期间，位图owner仍同步取消过渡、释放纹理和关闭失效ImageBitmap；资源变化回调只在该同步作用域内省去对旧view的重复投影，末尾统一完成新代的可见性、样式和绘制安排。作用域由finally释放，独立内容失效、预算回收和fade完成仍立即更新视图。首次创建/直接移动仍先应用显示位置再计算可见片段，避免旧container边界裁掉新卡。

`setBitmap` 接管 ImageBitmap 的所有权；版本失效、重复缓存键、超预算或销毁都会负责关闭。位图资源有 256MiB 默认预算。纯移动不淘汰正文；染纸/主题切换必须刷新同色墨色，材质切换保留正文。字体、DPR、界面缩放和内容版本的组合键由光栅 capability 提供，调用方在这些条件变化时重新调度。

`setRasterTiles` 接管同一卡片的可见纹理组；卡片可保持完整正文排版宽度，只上传可见横纵切片。`captureImage` 从同一场景输出指定物理比例的 PNG/JPEG，供后台导出使用，调用方保留快照序号并完成文件发布。

分片记录实际scale；分档模式允许高倍片向下复用，精确倍率模式只接受同一采样比例并使用独立内容键。`CanvasBitmapCache` 独占纹理/ImageBitmap生命周期及256MiB LRU，高倍局部补片会裁掉旧低倍的重叠UV，只保留不相交余片，避免透明文字反复叠黑。被裁开的多个Sprite仍只计一次底图字节，最后一个片释放时关闭底图。

远景标题在单个屏幕分辨率图层中按颜色、文档和面积优先避让。不能把文字字号放大成 `13 / zoom` 后仍用原始纹理分辨率；这会在低缩放下制造巨大文字纹理甚至 GPU OOM。近景文字位图走 DOM 光栅器；没有位图时保留标题身份牌。近景身份牌纹理也不能随每次缩放重建。

地图标题保留160 CSS px边界余量，同倍率小范围平移只移动投影纹理；倍率、标题、主题、内容或尺寸改变才重新排版。正文提取按卡片对象缓存，短标题宽度缓存有4096项上限。遮挡淡影的mask复用同一世界可见条块，不能把已经完全遮住的整卡继续叠画到stencil。

标题候选为空时隐藏地图标题Sprite、清理已绘ID与投影身份，不上传整层透明Canvas。纯图片与文档缩略图仍由正文层绘制；重新进入非空候选时必须按当前标题重画，不能复用空层前的旧文字。该规则只判断明确的空候选数组，不扩大到其他裁切或降级场景。

标题前缀与宽度拟合共用浏览器[`Intl.Segmenter`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter)的grapheme边界，保留ZWJ emoji、旗帜及组合音标。UTF-16长度已不超过18/120上限且没有换行的完整短标题直接保留原串，因为grapheme数不会超过UTF-16长度；其余地图首行18组、近景首行120组的前缀仍按需迭代，不为五万字正文展开整篇字符数组；地图继续无省略号、近景与线标签继续使用省略号，既有缓存上限不变。

线条纯几何来自 shared/geometry，前后台共用卡边裁切、同侧排开、迟滞与收敛曲线。Pixi 线适配使用静态世界 Mesh 和相机 uniform 保持 1 CSS px；远景直线与近景曲线缓存分开，缩放不反复 stroke 三角化。线层提供点击、高亮、端点、标签、纸面淡影和超过 3000 条可见线时的选中关系简化。`readEdgeGeometry` 给 DOM 交互实际排开后的坐标，不能由另一个表面猜曲线中点。

拖动时关联边与静态线分层。`createCanvasEdgeLayout` 缓存端点分组，只更新移动卡的连接和同侧排开的邻线，未关联曲线保留原对象。Bézier按控制点凸包到弦段的1/4屏幕像素误差自适应细分，不能按一段长直线的长度生成上百个冗余点。world使用[Pixi RenderGroup](https://pixijs.com/8.x/guides/concepts/render-groups)使相机变换在GPU整组执行，保留图文缩略的原层级。

`visibleCards` 保持视口相交的几何语义。世界矩形差按位置/层级缓存，阴影与圆角只取保守内接纸面作遮挡；相机变化只裁视口。`readVisibleCardRegions` 返回仍可见的卡内局部条块，`renderableCards` 排除无可见片段的卡，不改变框选范围。`readMissingBitmapRegions` 使平移只补缺片，同键纹理按片段合并并仍受256MiB LRU预算约束。

纸面淡影先把线层合成，再统一淡化；不能直接把不透明浅色线画在正文上（会擦断笔画），也不能每根线单独加透明度（交叉处会不断变深）。授权文档标题通过 setDocumentTitles 注入，缺失元数据一律显示通用“文档”，不显示内部身份。

内容owner可经 `setThumbnailCards` 指定远景保留画面的卡片，kernel不识别具体插件/文档类型。图片始终保留，普通文档默认标题；`rasterCards` 是当前真正需要正文位图的集合，前后台不能另猜远景规则。

WebGL适配器识别SwiftShader/llvmpipe软件绘图，交互模式自动将实际分辨率限制为1、简化远景线与纸面淡影，并发送 `render-status` 的“性能受限”状态。`readResolution` 是正文光栅的目标比例；不能仍按窗口DPR生成高倍正文。后台出图明确使用 `renderingMode:'capture'`，保持请求DPR和图像合同，不静默降低导出质量。

上下文丢失时保留元素和ImageBitmap，暂停绘制并报告恢复状态；此时或出图期间发生丢失，capture明确失败。Pixi恢复资源后重画同一内容。HTML-in-Canvas开关不可用时正式调度保留标题牌并报告正文能力不可用，不以空白图片冒充成功；真实禁用开关和context-loss像素恢复覆盖在visual probe。

验证：插件 typecheck、lint、test；真实 Electron 入口 `node packages/plugins/canvas/dev/probes/run-render-probe.mjs`。探针的三档场景验证几何、标题 LOD、线与平移，不代表完整业务 UI、全量正文位图吞吐和真实鼠标交互已验收。

正式正文和产品调度的测量入口：`node packages/plugins/canvas/dev/probes/run-performance-probe.mjs`，真实显示窗口、原生 pointer/wheel、DPR 和实际帧间隔，输出三规模×均匀/聚簇结果。`CANVAS_PERFORMANCE_COUNTS=2500` 可定向复演。它输出证据，不自动宣称全部业务或硬件门槛通过；首次正文加载、停手清晰时限、输入回落和内存必须分别检查。

加 `CANVAS_PERFORMANCE_DRAG=1` 可测最多500张选中卡的正式pointer预览与松手intent（这里只测内核，不代替Host提交验收）。整条轨迹必须在窗口内，松手没有产生完整move intent则探针失败。报告记录源码commit/dirty、解锁状态/锁屏事件、实际显示器频率、热状态及原始帧间隔；不得四舍五入原始值后判断门槛。

`CANVAS_PERFORMANCE_SOFTWARE=1 CANVAS_PERFORMANCE_COUNTS=250` 运行独立SwiftShader/offscreen降级冒烟，输出到单独的canvas-software-probe并明确validHardwareRun=false。它验证自动简化、实际分辨率与状态，不证明真实显卡帧率或手感。

正文补图由独立task批次调度，不占纯绘制RAF闭包。正式可见表面在Page Visibility变成hidden时取消未完成paint，恢复visible后按当前需求重新准备；保留已有纹理，不将后台节流当正文失败。实际paint超时只记录可见性、连接状态、能力和尺寸，不记录正文或Host配置。离屏技术验证可显式关闭这一可见表面策略。

`CanvasSpatialProjection`按512世界px维护卡片几何索引和有界世界格缓存，命中只查询所在格与长卡；长卡不为整篇正文登记数千空格。各格从上层向下扣纸面，拖动只使受影响格失效。已完全被现有上层纸面遮住的低层移动可保留精确投影；不能证明遮挡时立即重算。索引保存独立bounds，避免display对象原地移动后丢失旧几何。`preview-changed`只通知正文投影刷新，不表示已提交内容。

缓存发布时按相同边跨度合并精确相邻片段，消除世界格边界造成的重复DOM及纹理；真实遮挡洞不合并。每轮必须减少片段数，否则立即结束，结果随世界格缓存复用，不放入纯绘制回调。

线Mesh携带每条边的语义颜色索引，浅/深主题通过共享中间墨色palette切换uniform；默认中性线与独立选中高亮保持各自职责。不能只保存edge.color却把所有边绘为同一颜色。六色双主题、纸面淡影及拖动显露下层均有真实Electron像素断言。

CI可用 `CANVAS_PERFORMANCE_OFFSCREEN=1 node packages/plugins/canvas/dev/probes/run-performance-probe.mjs` 后执行 `node packages/plugins/canvas/dev/probes/verify-counts.mjs`。后者对fixture独立线性可见/命中oracle、空间候选、可见片段、位图预算与队列峰值作确定性断言，并输出counts-summary.json；容量从正式公开stats读取，不按机器锁帧时。离屏输出明确不代表真实GPU性能验收。

`prepareEditing(id)`强制当前单卡按相机×实际DPR精确采样，等待位图接纳后返回ready；不受40张阈值或100ms闲时条件限制。已有exact缓存直接复用，能力或资源失败返回unavailable供DOM编辑继续降级。准备期间普通补图不替换该任务；主题/DPR/字体及字体平滑发生变化时，旧结果不能进入新环境。字体平滑只读staging计算CSS，不依赖Host私有设置属性。50张可见卡的即时进入编辑、精确像素与缓存复用在真实Electron门禁验证。

拖动或平移改变需求区域时，同内容、同采样比例的在途正文片仍有效；先接纳它们，再补最新缺片。仅正文/环境/采样改变或卡退出需求时取消，避免每个pointer把仍正确的paint丢掉。拖动曲线按当前相机保持同一1/4屏幕px误差，缩放时重算当前关联曲线，不为每次移动一律生成最大4倍倍率的冗余顶点。

`CANVAS_PERFORMANCE_CPU_PROFILE=1`可生成拖动CPU profile辅助定位；带Profiler的输出明确不计真实硬件基线，不能用它的时延作为性能验收结论。

可见旧/新正文纹理在同一世界位置交叉淡入120ms，连续升级从当前混合权重继续。系统`prefers-reduced-motion`变化会立即完成当前替换并释放退休层；capture和软件GPU降级也立即替换。首图尚未显示时不为未见过的旧片制造淡入。退休层与新层共享唯一位图owner，均计入原256MiB预算；预算紧张先结束退休层，再淘汰LRU，不增加预算。alpha由任务脉冲准备，纯绘制RAF仍只绘制。

生命周期参考[MapLibre栅格淡入](https://maplibre.org/maplibre-style-spec/layers/#raster-fade-duration)及其[零时长仍保留旧瓦片的问题](https://github.com/maplibre/maplibre-gl-js/issues/2445)：禁用动效也要释放退休资源，不能只把时长设零。系统偏好使用原生[MediaQueryList变化事件](https://developer.mozilla.org/en-US/docs/Web/API/MediaQueryList)，不修改拖动等功能本身。

缩放中每50ms按当前视口重排待办，指针附近的可见正文优先；采样需求继续接纳最新缩放，不等鼠标释放。复杂正文单批32张、移动时减半为16；短纯文字在同一64任务容量内按像素/DOM预算合批至64张，移动时减半至32，可见正文超过1500张或进入降级时暂停缩放中补图，停手恢复。近景不超过40张的精确采样不再额外等待100ms；手动进入编辑的单卡任务优先于远处补图。

macOS硬件探针还读取当前console的IOConsoleLocked与CGS session锁屏事实；powerMonitor的idle只能作辅助。锁屏/未登录/非console用户在创建窗口前拒绝，报告仅保留boolean状态，不写用户身份。被拒绝的新运行写preflight.json并保留上一原始结果；此前仅powerMonitor校验的旧输出不能单独证明解锁态，不得作为正式基线。

光栅回执通过readCard读取当前display事实，不能为每张位图重新分配并扫描整张画布的visibleCards；环境身份校验也不应重复执行缺片矩形差。可见性仍由当前片段验证，旧内容或已退出视口的结果释放。

`node packages/plugins/canvas/dev/probes/run-visibility-probe.mjs`需要已解锁桌面，使用与正式主窗口相同的backgroundThrottling设置，执行原生hide、隐藏期间更新正文、超过paint超时时间后show，并与全新前景绘图比较像素。锁屏在建窗前拒绝；该验证不作为帧率基线。

`readReadiness(ids)`按当前环境、外部内容世代与可见缺片读取正文事实，不泄露正文缓存键。body只有在匹配位图已接纳、120ms替换已完成、该卡可见且随后实际draw后才ready；进入/退出DOM编辑或重新进入视口也须等新draw。overview/thumbnail/outside分别报告，不能充当正文完成；complete要求非空可见交集全部body ready且无精确升级/隐藏暂停。内容序号的几何首帧由调用方另行关联，不能拿位图旧回执替代新提交的实际投影。stats分别报告fadingCards/retiringBytes/retiringTiles，总rasterTiles包含退休层；停手清晰测量必须等待fade归零。

body的`firstPresented`只表示当前正文键已有新像素在非零透明度下完成实际draw，可在仍缺其他片或仍淡入时成立。位图替换和scene淡入分别记录首次alpha大于零时的render下界，上传、alpha零帧和旧正文键不算首显；`ready`继续等待全部可见正文和过渡结束后的draw。调用方以本次变化卡及当前revision关联这两个阶段，不能用首显替代完整正文完成。

授权文档标题按目标差量更新身份牌；内容相同的元数据通知不启动新draw。地图标题的内容不参与占位优先序，只有已显示的代表标签改名时才需重画。thumbnail偏好只改变相应卡片正文/身份牌可见性和标题候选，不改变几何或遮挡，不重新扫描空间投影。退回身份牌仍重新选择代表标签，之后相机改变会按最新候选排版。

初始化对1×1独立RenderTexture执行一次真实`no-batch`Graphics绘制，提前完成首次Graphics程序绑定；这部分成本进入开图耗时，不计主画布renders或正文receipt。临时Graphics/目标在成功和失败时均释放，保留共享白纹理。[Pixi prepare](https://github.com/pixijs/pixijs/blob/v8.22.0/src/prepare/PrepareUpload.ts#L71)仅上传几何/纹理，实际程序绑定发生在[Graphics adaptor](https://github.com/pixijs/pixijs/blob/v8.22.0/src/scene/graphics/gl/GlGraphicsAdaptor.ts#L81)；单小矩形默认batch不能代替这条路径。

同次离屏绘制包含近景连线使用的AlphaFilter合成程序；只预热Graphics会把首次阻塞留在filter程序。临时filter单独destroy但不销毁共享program，成功和异常路径均释放，不修改实际连线滤镜或透明度。

地图标签按选中、染纸、文档与面积优先；选中变化只作稳定分区并更新相关卡的远景透明度。单卡编辑的精确采样在DOM接管前保持，普通补图不能立即降回档位；相机倍率/环境改变或离开需求后解除。Pixi stage不另作交互命中（eventMode:none），所有意图仍走原生DOM事件与唯一空间索引，参见[Pixi事件合同](https://pixijs.com/8.x/guides/components/events)。

场景显示与逻辑target分开：普通指定新增以96%大小淡入160ms，移动220ms，删除保留旧显示120ms；超过200个有效指定ID或显式batch时统一200ms淡入，避免逐卡飞行。删除的显示不再参与逻辑命中，仍持有的位图继续计入原有预算，退休后释放。透明新增阶段不扣除下层正文，地图标签跟随相同alpha。`sceneTransitions`和`cameraTransition`暴露实际未完成任务；正文回执还须等待场景过渡结束后的真正draw。

`readDisplayPosition`返回当前视觉起点。真实拖动在阈值通过后冻结该起点，后续无关增量不重置预览，松手提交明确的绝对positions；取消恢复最新逻辑target。`finishTransitions(ids?)`同步到目标并刷新空间投影；编辑器和只读详情接管前使用它，正在编辑的卡不参与新动画。`animateCamera`默认320ms，用户相机输入从当前显示中断飞行；同值`setCamera`只取消任务，不额外重建投影。系统减少动态即时完成卡片、相机和纹理过渡，清理所有相关定时任务。

`setRasterContentKey`用于不透明的外部内容/授权世代。世代变化立即释放当前卡的旧正文及退休纹理，不能把已失去访问权的封面或标签保留120ms淡出；普通采样升级才允许交叉淡入。

相机中断和系统减少动态参考[tldraw公开动画合同](https://tldraw.dev/sdk-features/animation)：程序定位在用户平移/缩放时让位；shape与camera都必须消费减少动态偏好，不能只关闭相机动画。这里的过渡只修改显示投影，Canvas持久字段与撤销链不受动画tick影响。

近景缺图身份牌使用卡内单行省略标题，按同一15px字体度量；不能把120字在窄卡内自动折成上百行并溢出纸面。小卡缩小内边距，高度不足一行时不画溢出字形。拟合结果有4096项上限，颜色通过GPU tint改变，避免染纸时重新生成每张身份牌的文字纹理；正文仍保留全部内容。80×32长中文/emoji卡片的真实像素门禁验证纸面之外无标题墨迹。

身份牌由`CanvasIdentityAtlas`集中准备：仍使用固定Pixi8.22的root导出`CanvasTextGenerator`完成整串排版，不拆字，不改system-ui15、白字tint、DPR或世界坐标。生成器带`@internal`兼容性标记，因此只由一个窄适配器消费，升级依赖时须重过同机Pixi Text整串像素门禁。借来的Canvas同步复制到自有页后立即归还；frame为临时物理矩形，Texture子框按source.resolution换算为逻辑单位。每个输入/异步批次只更新脏页一次，纯绘制RAF不准备文字。

身份牌准备使用独立task，不接在同步场景投影后的微任务链里；已兑现Promise或`queueMicrotask`都不会让浏览器处理输入/绘制。活动身份牌未准备完成前保留上一帧，取消过早安排的新场景draw；准备结束后才安排主画布RAF。准备失败仍安排清除旧像素的draw并传播原错误，销毁取消自有任务；显式出图继续同步准备，不把等待或失败当成成功。

页有2物理px透明间隔，按完整1024×512或更大独立字符串页计账。可见缺图牌持有活动引用，正文覆盖后的视图仍可复用缓存；无活动引用的页可LRU淘汰，最后视图移除时整页释放。页面销毁会清掉所有绑定的子纹理，不能留下已释放source的Sprite；上下文恢复从保留的自有Canvas重传同一页。

页内所有绑定（含隐藏视图）的合计引用只由同一owner的attach/detach同步维护，末次释放以O(1)判定；不能在每张卡改名时复制并扫描整页entry。活动引用仍独立决定预算淘汰：隐藏页即使还有绑定也可回收，销页直接detach全部视图，不经release递归销毁。此边界与[Pixi8.22文字资源引用计数](https://github.com/pixijs/pixijs/blob/v8.22.0/src/scene/text/shared/AbstractTextSystem.ts)的末引用释放原则一致，不引入延迟退休或另一份资源所有权。

`bitmapBudgetBytes`继续限制正文（包括退休层），默认256MiB。正文与身份牌另共用固定256MiB逻辑RGBA纹理估算上限：新页先准入并让正文LRU回收，正文接纳也扣除完整atlas页占用；不把空白槽、隐藏缓存或退休正文漏账。stats分别报告bitmapBytes、identityBytes、identityCanvasBytes和派生estimatedTextureBytes/textureBudgetBytes。CPU Canvas backing另列，不声称这些估算代表驱动或全进程物理内存。所有权与子框遵循[Pixi TextureSource/Texture](https://pixijs.com/8.x/guides/components/textures)，排版来自[固定8.22 CanvasTextGenerator](https://github.com/pixijs/pixijs/blob/v8.22.0/src/scene/text/canvas/CanvasTextGenerator.ts)。

活动页本身超过总容量时明确拒绝分配，不隐藏/延迟正确标题或增加预算。容量异常经既有render-status显示后仍抛出，不能把绘制失败当保存失败或成功出图；视口变化后成功准备会清掉容量提示。相同失败工作集不由纯draw任务无限重试，显式capture仍返回原错误；正文、可见性、DPR或资源变化才重新准备。该边界不影响Backend内容与保存，未证明可容纳的极端活动标题规模不能列入性能支持范围。低于.15的隐藏身份牌不登记活动引用，同倍率平移也遵循同一规则；identityActiveLabels供确定性工作量检查。

`createCanvasCardTextureCaches`仅组合两个owner的预算准入，不拥有UI或GL。独立probe以相同组合入口、2MiB加20,000字节总预算和实际40,000字节ImageBitmap验证：atlas先让旧正文释放，隐藏atlas再让新正文接纳，最终两边都释放；不为测试扩张Kernel公共合同，也不需分配整份256MiB资源。

同内容键下互不重叠的新增片段直接追加，保留已经显示的Sprite/Texture所有权，不为没有旧像素的新区域重建并淡入整张卡。只有没有在途替换时才走追加路径；相交采样升级、内容键切换及仍在进行的旧/新替换继续使用120ms流程。真实Electron门禁验证既有像素在追加前后完全一致、新区域可见、两张底图分别只关闭一次，内存仍计入原预算。

线段四角使用[Pixi Geometry索引缓冲](https://pixijs.download/v8.22.0/docs/rendering.Geometry.html)共享给两个三角形，替代六份重复属性；法向量在每段只求一次。三角形覆盖、曲线细分误差、屏幕线宽、虚线相位及箭头保持同一几何，减少动态连线的CPU填充和GPU上传，不以降低线条质量换帧率。
