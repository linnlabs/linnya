# Slides 幻灯片导航

`deckNavigator` 拥有 Slides 文档底部的导航条：横向幻灯片列表、单页／平铺视图切换、列表收起，以及“+”新建空白幻灯片。它只投影 `slidesStore`、`slidesRenderStore`、`slidesThumbnailStore` 与 `slidesUiStore` 的现有状态，不持有第二份页面列表。

## 交互

- **横向列表**：位于舞台下方。缩略图高度固定 72px，宽度随文稿 `slideSize` 变化（极宽画布封顶 240px 并降低高度），所以 preset 与自定义画布都不会改变导航条高度。列表用横向虚拟滚动；鼠标纵向滚轮转换为横向滚动，触控板横滑保持原生行为。当前页使用强调色描边与页码徽标；当前页变化时只做最小滚动让它完整可见。焦点在列表内时，左右方向键、Home／End 切换当前页，并把焦点移到对应项。
- **平铺视图**：替换主区域的单页舞台，并隐藏横向列表与舞台缩放工具条；工具行保留“+”与视图切换。列数取能容纳最小卡片宽度的最大值，余量均分，卡片过宽时封顶并居中；按行虚拟滚动。单击选中，双击或 Enter 回到单页视图并停在该页；方向键在网格中移动（上下跨一整行，不循环）。
- **收起**：单页视图下工具行右侧的箭头收起或展开横向列表；平铺视图没有列表，因此不显示该按钮。
- **新建空白幻灯片**：“+”在当前页之后插入一页，呈现后自动成为当前页。仅在当前文档为 ready 的 generated deck、且可见 RenderModel 与 build state 是同一 revision 时可用；插入等待期间按钮禁用并显示等待态，一次只接纳一个插入。

视图模式与列表收起属于 `slidesUiStore` 的瞬时 UI 状态，文稿切换时随 `$reset` 回到单页视图、列表展开。

## 写入路径

“+”不新建 IPC 或第二套写队列。`useBlankSlideInsertion` 把 `{ op: 'insert_blank_slide', index }` 交给 [manualEditing](../manualEditing/README.md) 的串行队列，复用精确 revision/sourceHash CAS、draft 保护、命令回执幂等、失败提示与画面结算。index 是当前可见修订内的 0-based 位置，只在该快照内解释。Backend 的源码改写与主题背景规则见 [presentationManualEditing](../../../backend/features/presentationManualEditing/README.md)。

平铺视图打开时单页舞台已卸载，不能再由 `SlideStage` 报告“当前页完整帧已呈现”。平铺视图是此时的可见画面：当前文稿的 RenderModel 修订装入后即记录 presented revision，新页格位立即出现（位图随后替换占位），队列据此结算。

## 缩略图位图

列表与平铺共用 `slidesThumbnailStore` 的同一份 `ImageBitmap`。平铺视图按卡片宽度（64px 档位、最多 384px）调用 `requestRasterWidth`，宽度增大时整组重绘，旧位图在替换前继续显示；离开平铺时撤销请求但不立即重绘，下次 RenderModel 变化时收敛回列表尺寸。`SlideThumbnail` 按显示尺寸与设备像素比分配 canvas，并以高质量缩放绘制位图。

## 模块布局

| 位置 | 职责 |
| --- | --- |
| definitions | 网格布局、键盘键位与插入可用性类型；中英文案目录 |
| functions | 网格布局、方向键目标页、最小滚动距离、插入可用性与位置等纯规则 |
| orchestration | `useBlankSlideInsertion`：入队、等待态与呈现后的选页 |
| ui | `DeckNavigatorBar`、`DeckFilmstrip`、`SlideGridView`、`SlideThumbnail` 与 Slides 自有视图图标 |

OverlayScrollbars 会改写自定义视口的 padding，因此列表与平铺的留白都放在视口内层内容元素上，滚动定位使用同一常量。

## 测试

- `functions/deckNavigatorRules.test.ts`：网格列数／卡片尺寸／位图档位、列表与网格方向键、最小滚动、插入可用性。
- `orchestration/useBlankSlideInsertion.test.ts`：真实提交队列下的命令快照、等待期间重复点击、呈现后选页与失败停留。
- `ui/DeckFilmstrip.test.ts`：共享滚动视口装配、比例派生尺寸、当前页标记与键盘切换。
- `../../ui/deck/DeckViewer.test.ts`：平铺视图替换舞台、隐藏舞台工具条。
- `../../shared/thumbnailGeometry.test.ts` 与 `../../store/slidesThumbnailStore.test.ts`：列表尺寸与位图宽度请求。
