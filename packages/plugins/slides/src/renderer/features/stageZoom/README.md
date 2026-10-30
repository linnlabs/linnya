# Slides 舞台缩放

`stageZoom` 拥有单页舞台的缩放控件 `StageZoomControls`：缩小、滑块、放大与百分比菜单。`DeckViewer` 把它放进 [deckNavigator](../deckNavigator/README.md) 底栏的 `view-controls` 插槽，排在视图切换左侧，舞台上不再有浮动工具条，放大后的内容不会被遮挡。控件使用宿主工具栏的扁平按钮样式，不自带背景或阴影。

- 加减按钮按 5% 步进，到 10%／300% 边界时禁用；滑块按 1% 步进。控件只发出目标百分比，夹取与写入由 `DeckViewer` 通过 `clampStageZoomPercent` 和 `slidesUiStore` 完成。
- 宽度由最近的 inline-size 容器（底栏工具行）决定：不足 640px 时收起滑块，百分比移到加减之间，保留“− 百分比 +”。

百分比本身是按钮，点击后向上展开动作菜单：第一项“适应窗口”，分隔线后是 25%、50%、75%、100%、150%、200% 常用档位。它取代了原来的“适应窗口”图标按钮。

- 当前项：fit 模式下只标记“适应窗口”，即使适配结果恰好等于某个档位；手动模式下只标记数值完全相同的档位，中间值不标记。
- 菜单只发出 `{ kind: 'fit' }` 或 `{ kind: 'percent', percent }`，缩放写入仍由 `DeckViewer` 调用 `slidesUiStore`；滑块、加减按钮、Ctrl/⌘ 滚轮与菜单共用同一缩放状态。
- 菜单使用 `@linnya/renderer-ui` 的 `CustomSelect`（manual 模式、`semantic-role="menu"`、外部触发器与 `parent-is-open`），由共享组件负责外部点击、Escape、键盘焦点进入与归还；本 feature 只定位面板并提供选项。
- 平铺视图没有舞台，`DeckViewer` 不提供插槽内容，底栏随之省去缩放组与分隔线；视图切换靠右对齐，位置不变。

`functions/stageZoomMenu.test.ts` 覆盖选项构造与动作解析；`../../ui/deck/DeckViewer.test.ts` 通过真实菜单与加减按钮验证档位、步进、边界禁用与适应窗口写回 UI store。

## 舞台视口

`useSlideStageViewport` 拥有实际 viewport 测量、滚动容器生命周期、fit/手动缩放锚点、光栅清晰度与 overlay 几何更新。它只接收页尺寸、活动/显示页身份和可渲染事实；不读取选区或提交编辑。SlideStage 负责将它的坐标结果连接到画布与编辑浮层。
