# Canvas renderer kernel

内核消费 Canvas 元素快照，拥有场景、相机、命中、交互意图和绘制资源，不拥有保存、正文解析、Agent、Host store 或 Vue 状态。`index.ts` 只暴露 `CanvasKernel` 合同与创建入口。Pixi 仅出现在 `render/pixi`。

`setElements` 安装已提交或由调用方明确管理的场景投影；`setSelection` 只更新选择。`worldToScreen` / `screenToWorld` 是 DOM 编辑表面定位的共同坐标真源。Pointer 意图由 `onIntent` 发给 feature，最终移动在松手时产生；保存、冲突校验、撤销和组合多选移动由调用方负责。

`setBitmap` 接管 ImageBitmap 的所有权；版本失效、重复缓存键、超预算或销毁都会负责关闭。位图资源有 256MiB 默认预算。纯移动/颜色更改不淘汰正文；主题切换必须刷新正文，材质切换保留正文。字体、DPR、界面缩放和内容版本的组合键由光栅 capability 提供，调用方在这些条件变化时重新调度。

`setRasterTiles` 接管同一卡片的可见纹理组；卡片可保持完整正文排版宽度，只上传可见横纵切片。`captureImage` 从同一场景输出指定物理比例的 PNG/JPEG，供后台导出使用，调用方保留快照序号并完成文件发布。

远景标题在单个屏幕分辨率图层中按颜色、文档和面积优先避让。不能把文字字号放大成 `13 / zoom` 后仍用原始纹理分辨率；这会在低缩放下制造巨大文字纹理甚至 GPU OOM。近景文字位图走 DOM 光栅器；没有位图时保留标题身份牌。线条曲线自行计算有界均匀采样，避免渲染引擎的长曲线细分误差。

验证：插件 typecheck、lint、test；真实 Electron 入口 `node packages/plugins/canvas/dev/probes/run-render-probe.mjs`。探针的三档场景验证几何、标题 LOD、线与平移，不代表完整业务 UI、全量正文位图吞吐和真实鼠标交互已验收。
