# Slides 幻灯片导航

`deckNavigator` 拥有 Slides 文档底部的导航条：横向幻灯片列表、单页／平铺视图切换、列表收起，“+”新建空白幻灯片与缩略图右键菜单。它只投影 `slidesStore`、`slidesRenderStore`、`slidesThumbnailStore` 与 `slidesUiStore` 的现有状态，不持有第二份页面列表。

## 交互

- **横向列表**：位于舞台下方。缩略图高度固定 72px，宽度随文稿 `slideSize` 变化（极宽画布封顶 240px 并降低高度），所以 preset 与自定义画布都不会改变导航条高度。列表用横向虚拟滚动；页数超出宽度时，悬停列表显示共享 `linnya` 主题的横向滚动条（位于缩略图下方留白，可拖拽），鼠标纵向滚轮转换为横向滚动，触控板横滑保持原生行为。当前页使用强调色描边与页码徽标；当前页变化时只做最小滚动让它完整可见。焦点在列表内时，左右方向键、Home／End 切换当前页，并把焦点移到对应项。
- **平铺视图**：替换主区域的单页舞台，并隐藏横向列表与舞台缩放工具条；工具行保留“+”与视图切换。列数取能容纳最小卡片宽度的最大值，余量均分，卡片过宽时封顶并居中；按行虚拟滚动。单击选中，双击或 Enter 回到单页视图并停在该页；方向键在网格中移动（上下跨一整行，不循环）。
- **收起**：单页视图下工具行右侧的箭头收起或展开横向列表；平铺视图没有列表，因此不显示该按钮。
- **新建空白幻灯片**：“+”在当前页之后插入一页，提交后的新修订模型装入即切到新页，随后等待该页完整画面呈现，避免先重绘旧页再切新页。仅在当前文档为 ready 的 generated deck、且可见 RenderModel 与 build state 是同一 revision 时可用；插入等待期间按钮禁用并显示等待态，一次只接纳一个插入。

- **右键菜单**：在底部缩略图上右键先选中该页，再显示“复制幻灯片／删除幻灯片”。复用 Renderer UI 的菜单、键盘导航和关闭语义，菜单限制在可见窗口内，关闭后焦点归还触发按钮。复制直接插在原页之后并选中副本，无剪贴板或粘贴步骤；删除选中该位置的下一页，删除末页则选中前一页，最后一张不能删除。所有页面结构操作共享等待态，同一时刻只接纳一个，修订或文稿切换会关闭旧菜单。

视图模式与列表收起属于 `slidesUiStore` 的瞬时 UI 状态，文稿切换时随 `$reset` 回到单页视图、列表展开。

## 写入路径

“+”不新建 IPC 或第二套写队列。`useSlideStructureActions` 把 `{ op: 'insert_blank_slide', index }` 交给 [manualEditing](../manualEditing/README.md) 的串行队列，复用精确 revision/sourceHash CAS、draft 保护、命令回执幂等、失败提示与画面结算。index 是当前可见修订内的 0-based 位置，只在该快照内解释。复制／删除分别提交 `duplicate_slide`／`delete_slide`，也使用同一队列。常见内联页面列表的空白页插入在 Backend 复用已有编译结果，复杂源码结构仍完整编译；不提前伪造已保存的页面。Backend 的源码改写与主题背景规则见 [presentationManualEditing](../../../backend/features/presentationManualEditing/README.md)。

平铺视图打开时单页舞台已卸载，不能再由 `SlideStage` 报告“当前页完整帧已呈现”。平铺视图是此时的可见画面：当前文稿的 RenderModel 修订装入后即记录 presented revision，新页格位立即出现（位图随后替换占位），队列据此结算。

## 缩略图位图

列表与平铺共用本 feature 的 `store/slidesThumbnailStore`。`SlidesView` 只挂载一次 `useSlideThumbnails`，负责模型/文档/尺寸订阅；`createSlideThumbnailRenderer` 拥有调度、位图生成与释放，store 仅保存展示映射和宽度请求。

每次正式 RenderModel 变化，`createSlideThumbnailSources` 按页面尺寸、背景和节点视觉内容生成缓存身份；排除页码、元素 ID、源码位置及作者编辑元数据，递归处理分组和形状内文本。不能按 `slideId` 判断是否变化：它含页序，插入或删除会改变后续页 ID。新增只渲染未命中的画面，复制直接共用相同内容的位图，删除/重排只重建当前页序映射；最后一个使用者消失时才关闭该位图。仍在生成的未变画面跨修订继续使用，删除或文档切换会取消过期任务，迟到结果只释放、不发布。

缺失位图在画面更新后的空闲时段逐张生成，当前页优先，不再立即并发渲染前四页。页面条和网格都能立即使用命中的位图。平铺按卡片宽度（64px 档位、最多 384px）调用 `requestRasterWidth`，仅升级分辨率不足的缓存，升级时继续显示旧图；离开平铺后保留更清晰的位图，后续修订和重新打开平铺不会降级重画。`SlideThumbnail` 按显示尺寸与设备像素比分配 canvas，并以高质量缩放绘制位图。

这是缩略图栅格的增量更新；Backend 仍提供完整的正式 RenderModel，点击到新页可见还包含命令提交、模型查询与主舞台呈现。诊断沿用 `linnya.slides.debug=verbose`：`Thumbnail` 输出实际重画页与耗时，`ManualEditTrace` 输出 input-to-response / refresh / frame 分段，不能把缩略图局部耗时当作完整交互延迟。

缩略图阴影固定为“选中环 + 单层投影”两层，列表与平铺只通过 `--slide-thumbnail-ring-width`、`--slide-thumbnail-ring-color`、`--slide-thumbnail-shadow` 表达默认、悬停与选中态；切换选中时环的几何不变、只过渡颜色，避免模糊投影与强调色环互相插值造成外扩闪烁。键盘焦点使用 outline。平铺卡片的悬停抬起对当前页同样生效，点击选中时不会先落回原位。

## 模块布局

| 位置 | 职责 |
| --- | --- |
| definitions | 网格布局、键盘键位、插入可用性、缩略图状态与渲染端口；中英文案目录 |
| functions | 网格布局、方向键目标页、最小滚动距离、插入规则、缩略图视觉身份 |
| orchestration | 页面结构操作入队/选页；缩略图模型订阅、增量渲染与资源生命周期 |
| store | 缩略图展示映射、生成状态与分辨率请求；同步 action |
| ui | `DeckNavigatorBar`、`DeckFilmstrip`、`SlideGridView`、`SlideThumbnail`、`SlideContextMenu` 与 Slides 自有视图图标 |

两个视口都接入 `@linnya/renderer-ui/scroll`：平铺沿用共享默认的纵向滚动；横向列表只局部覆盖 `overflow`（x 滚动、y 隐藏），主题与 hover 可见性仍用共享 data-attribute，不另写滚动条样式。OverlayScrollbars 会改写自定义视口的 padding，因此列表与平铺的留白都放在视口内层内容元素上，滚动定位使用同一常量。

## 测试

- `functions/deckNavigatorRules.test.ts`：网格列数／卡片尺寸／位图档位、列表与网格方向键、最小滚动、插入可用性。
- `orchestration/useSlideStructureActions.test.ts`：真实提交队列下的命令快照、等待期间互斥、复制／删除后、目标帧呈现前的选页、最后一页保护与失败停留。
- `ui/DeckFilmstrip.test.ts`：共享滚动视口装配、比例派生尺寸、当前页标记、键盘切换与真实右键菜单到命令的交互。
- `../../ui/deck/DeckViewer.test.ts`：平铺视图替换舞台、隐藏舞台工具条。
- `../../shared/thumbnailGeometry.test.ts`：列表比例与尺寸。
- `orchestration/createSlideThumbnailRenderer.test.ts`、`useSlideThumbnails.test.ts`：插入/复制/删除/重排渲染次数、内容失效、跨修订进行中任务、切换文档、共享位图释放与分辨率升级。
- `../../../../dev/tools/thumbnailIncrementalBrowser.ts`（`pnpm --dir packages/plugins/slides run smoke:preview-transitions --thumbnails-only`）：30 页、540 个形状的真实 Chromium/Konva 增量栅格，检查 `SlideThumbnail` 像素与独立重绘一致，并输出全量参考耗时、增量渲染页数与耗时；结果保存到 `dist/dev/thumbnail-incremental-trace.json`。不传参数时同时运行完整预览交互 smoke。
