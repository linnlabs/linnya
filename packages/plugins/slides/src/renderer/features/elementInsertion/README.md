# Slides 新增对象

`createInsertedObject` 生成当前页中央的完整作者值和新 editKey；orchestration 完成文字交接后向 manualEditing 提交 insert_objects。新增对象进入 deck.js 的 slide additions，经正式编译、源定位、预览与导出。空白页无需已有对象即可使用。

图片通过 imageEditing 的窄 `importSlideImage` 能力接管为文稿资产，源码只存 ID。等待期间切换文稿/页面或改变修订时拒绝落到过时目标。页序命令未呈现时禁用插入。提交呈现后只在用户选择未改变时选中新对象，异步结果不夺取焦点。

不生成前端专用的持久节点，不绕过 CAS 队列，不将图片字节塞入源码。值合同见[authoringEditing](../../../shared/authoringEditing/README.md)，交互边界见[编辑体验](../../docs/editing-experience.md)。
