# Canvas renderer kernel

内核消费 Canvas 元素快照，拥有场景、相机、命中、交互意图和绘制资源，不拥有保存、正文解析、Agent、Host store 或 Vue 状态。`index.ts` 只暴露 `CanvasKernel` 合同与创建入口。Pixi 仅出现在 `render/pixi`。

`setElements` 安装已提交或由调用方明确管理的场景投影；`setSelection` 只更新选择。`worldToScreen` / `screenToWorld` 是 DOM 编辑表面定位的共同坐标真源。Pointer 意图由 `onIntent` 发给 feature，最终移动在松手时产生；保存、冲突校验、撤销和组合多选移动由调用方负责。

`setBitmap` 接管 ImageBitmap 的所有权；版本失效、重复缓存键、超预算或销毁都会负责关闭。位图资源有 256MiB 默认预算。纯移动/颜色更改不淘汰正文；主题切换必须刷新正文，材质切换保留正文。字体、DPR、界面缩放和内容版本的组合键由光栅 capability 提供，调用方在这些条件变化时重新调度。

`setRasterTiles` 接管同一卡片的可见纹理组；卡片可保持完整正文排版宽度，只上传可见横纵切片。`captureImage` 从同一场景输出指定物理比例的 PNG/JPEG，供后台导出使用，调用方保留快照序号并完成文件发布。

远景标题在单个屏幕分辨率图层中按颜色、文档和面积优先避让。不能把文字字号放大成 `13 / zoom` 后仍用原始纹理分辨率；这会在低缩放下制造巨大文字纹理甚至 GPU OOM。近景文字位图走 DOM 光栅器；没有位图时保留标题身份牌。近景身份牌纹理也不能随每次缩放重建。

线条纯几何来自 shared/geometry，前后台共用卡边裁切、同侧排开、迟滞与收敛曲线。Pixi 线适配使用静态世界 Mesh 和相机 uniform 保持 1 CSS px；远景直线与近景曲线缓存分开，缩放不反复 stroke 三角化。线层提供点击、高亮、端点、标签、纸面淡影和超过 3000 条可见线时的选中关系简化。`readEdgeGeometry` 给 DOM 交互实际排开后的坐标，不能由另一个表面猜曲线中点。

`visibleCards` 保持视口相交的几何语义。世界矩形差按位置/层级缓存，阴影与圆角只取保守内接纸面作遮挡；相机变化只裁视口。`readVisibleCardRegions` 返回仍可见的卡内局部条块，`renderableCards` 排除无可见片段的卡，不改变框选范围。`readMissingBitmapRegions` 使平移只补缺片，同键纹理按片段合并并仍受256MiB LRU预算约束。

纸面淡影先把线层合成，再统一淡化；不能直接把不透明浅色线画在正文上（会擦断笔画），也不能每根线单独加透明度（交叉处会不断变深）。授权文档标题通过 setDocumentTitles 注入，缺失元数据一律显示通用“文档”，不显示内部身份。

验证：插件 typecheck、lint、test；真实 Electron 入口 `node packages/plugins/canvas/dev/probes/run-render-probe.mjs`。探针的三档场景验证几何、标题 LOD、线与平移，不代表完整业务 UI、全量正文位图吞吐和真实鼠标交互已验收。

正式正文和产品调度的测量入口：`node packages/plugins/canvas/dev/probes/run-performance-probe.mjs`，真实显示窗口、原生 pointer/wheel、DPR 和实际帧间隔，输出三规模×均匀/聚簇结果。`CANVAS_PERFORMANCE_COUNTS=2500` 可定向复演。它输出证据，不自动宣称全部业务或硬件门槛通过；首次正文加载、停手清晰时限、输入回落和内存必须分别检查。
