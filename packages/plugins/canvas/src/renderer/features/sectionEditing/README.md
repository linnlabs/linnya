# 分区标题编辑与归类

`createCanvasSectionEditing` 拥有分区标题的行内编辑：`begin(id)` 打开标题输入框，`save(value)` 用正式用户提交改 `title`，`cancel()` 放弃。`group(ids)` 把选中的卡放进新分区（菜单“放进新分区”与 ⌘G）：一次提交 `addSection` 并带 members，随后选中新分区并开始命名。已在分区内的卡会换到新分区；选区里的分区与锁定卡不放进去。

`CanvasSectionTitleEditor.vue` 按相机把输入框叠在分区标题条上，颜色取分区染纸色板。双击标题条、选中后按 Enter 或菜单“编辑”都进入改名。

拖动卡片进出分区不在这里处理：统一用户提交入口（`createCanvasDocumentMutations`）调用 shared 的 `assignCanvasSections`，按卡片中心落点决定归属；随分区一起移动的成员不换区，显式给出的 `parentId` 不改。
