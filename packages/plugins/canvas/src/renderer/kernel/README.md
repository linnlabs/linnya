# Canvas renderer kernel

内核消费 Canvas 元素快照，拥有场景、相机、命中、交互意图和绘制资源，不拥有保存、正文解析、Agent、Host store 或 Vue 状态。`index.ts` 只暴露 `CanvasKernel` 合同与创建入口。Pixi 仅出现在 `render/pixi`。

`setElements` 安装已提交或由调用方明确管理的场景投影；`setSelection` 只更新选择。`worldToScreen` / `screenToWorld` 是 DOM 编辑表面定位的共同坐标真源。Pointer 意图由 `onIntent` 发给 feature，最终移动在松手时产生；保存、冲突校验、撤销和组合多选移动由调用方负责。

`setBitmap` 接管 ImageBitmap 的所有权；版本失效、重复缓存键、超预算或销毁都会负责关闭。位图资源有 256MiB 默认预算。纯移动不淘汰正文；染纸/主题切换必须刷新同色墨色，材质切换保留正文。字体、DPR、界面缩放和内容版本的组合键由光栅 capability 提供，调用方在这些条件变化时重新调度。

`setRasterTiles` 接管同一卡片的可见纹理组；卡片可保持完整正文排版宽度，只上传可见横纵切片。`captureImage` 从同一场景输出指定物理比例的 PNG/JPEG，供后台导出使用，调用方保留快照序号并完成文件发布。

分片记录实际scale；分档模式允许高倍片向下复用，精确倍率模式只接受同一采样比例并使用独立内容键。`CanvasBitmapCache` 独占纹理/ImageBitmap生命周期及256MiB LRU，高倍局部补片会裁掉旧低倍的重叠UV，只保留不相交余片，避免透明文字反复叠黑。被裁开的多个Sprite仍只计一次底图字节，最后一个片释放时关闭底图。

远景标题在单个屏幕分辨率图层中按颜色、文档和面积优先避让。不能把文字字号放大成 `13 / zoom` 后仍用原始纹理分辨率；这会在低缩放下制造巨大文字纹理甚至 GPU OOM。近景文字位图走 DOM 光栅器；没有位图时保留标题身份牌。近景身份牌纹理也不能随每次缩放重建。

地图标题保留160 CSS px边界余量，同倍率小范围平移只移动投影纹理；倍率、标题、主题、内容或尺寸改变才重新排版。正文提取按卡片对象缓存，短标题宽度缓存有4096项上限。遮挡淡影的mask复用同一世界可见条块，不能把已经完全遮住的整卡继续叠画到stencil。

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

正文补图由独立microtask批次调度，不占纯绘制RAF闭包。正式可见表面在Page Visibility变成hidden时取消未完成paint，恢复visible后按当前需求重新准备；保留已有纹理，不将后台节流当正文失败。实际paint超时只记录可见性、连接状态、能力和尺寸，不记录正文或Host配置。离屏技术验证可显式关闭这一可见表面策略。

`CanvasSpatialProjection`按512世界px维护卡片几何索引和有界世界格缓存，命中只查询所在格与长卡；长卡不为整篇正文登记数千空格。各格从上层向下扣纸面，拖动只使受影响格失效。已完全被现有上层纸面遮住的低层移动可保留精确投影；不能证明遮挡时立即重算。索引保存独立bounds，避免display对象原地移动后丢失旧几何。`preview-changed`只通知正文投影刷新，不表示已提交内容。

线Mesh携带每条边的语义颜色索引，浅/深主题通过共享中间墨色palette切换uniform；默认中性线与独立选中高亮保持各自职责。不能只保存edge.color却把所有边绘为同一颜色。六色双主题、纸面淡影及拖动显露下层均有真实Electron像素断言。

CI可用 `CANVAS_PERFORMANCE_OFFSCREEN=1 node packages/plugins/canvas/dev/probes/run-performance-probe.mjs` 后执行 `node packages/plugins/canvas/dev/probes/verify-counts.mjs`。后者对fixture独立线性可见/命中oracle、空间候选、可见片段、位图预算与队列峰值作确定性断言，并输出counts-summary.json；容量从正式公开stats读取，不按机器锁帧时。离屏输出明确不代表真实GPU性能验收。

`prepareEditing(id)`强制当前单卡按相机×实际DPR精确采样，等待位图接纳后返回ready；不受40张阈值或100ms闲时条件限制。已有exact缓存直接复用，能力或资源失败返回unavailable供DOM编辑继续降级。准备期间普通补图不替换该任务；主题/DPR/字体及字体平滑发生变化时，旧结果不能进入新环境。字体平滑只读staging计算CSS，不依赖Host私有设置属性。50张可见卡的即时进入编辑、精确像素与缓存复用在真实Electron门禁验证。
