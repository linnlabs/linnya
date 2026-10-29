# Slides 新增对象

`createInsertedObject` 生成当前页中央的完整作者值和新 editKey，颜色由 `resolveInsertionPalette` 从文稿主题和当前页背景得出；orchestration 完成文字交接后向 manualEditing 提交 insert_objects。新增对象进入 deck.js 的 slide additions，经正式编译、源定位、预览与导出。空白页无需已有对象即可使用。

图片通过 imageEditing 的窄 `importSlideImage` 能力接管为文稿资产，源码只存 ID。等待期间切换文稿/页面或改变修订时拒绝落到过时目标。页序命令未呈现时禁用插入。保存期间 manualEditing 暴露 `pendingInsertions`，画布在落点画虚线占位。提交呈现后只在用户选择未改变时通过 `revealRequest` 选中新对象；单个文字框同时以全选进入输入，此时焦点来自用户刚点的插入动作。编译器把插入文字的高度作为最小高度，内容变长时文字框向下增长。

不生成前端专用的持久节点，不绕过 CAS 队列，不将图片字节塞入源码。值合同见[authoringEditing](../../../shared/authoringEditing/README.md)，交互边界见[编辑体验](../../docs/editing-experience.md)。
