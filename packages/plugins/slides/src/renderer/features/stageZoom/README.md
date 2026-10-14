# Slides 舞台缩放菜单

`stageZoom` 拥有舞台右下角工具条中的百分比菜单。百分比本身是按钮，点击后向上展开动作菜单：第一项“适应窗口”，分隔线后是 25%、50%、75%、100%、150%、200% 常用档位。它取代了原来的“适应窗口”图标按钮。

- 当前项：fit 模式下只标记“适应窗口”，即使适配结果恰好等于某个档位；手动模式下只标记数值完全相同的档位，中间值不标记。
- 菜单只发出 `{ kind: 'fit' }` 或 `{ kind: 'percent', percent }`，缩放写入仍由 `DeckViewer` 调用 `slidesUiStore`；滑块、加减按钮、Ctrl/⌘ 滚轮与菜单共用同一缩放状态。
- 菜单使用 `@linnya/renderer-ui` 的 `CustomSelect`（manual 模式、`semantic-role="menu"`、外部触发器与 `parent-is-open`），由共享组件负责外部点击、Escape、键盘焦点进入与归还；本 feature 只定位面板并提供选项。
- 平铺视图没有舞台，整条缩放工具条隐藏。

`functions/stageZoomMenu.test.ts` 覆盖选项构造与动作解析；`../../ui/deck/DeckViewer.test.ts` 通过真实菜单点击验证档位与适应窗口写回 UI store。
