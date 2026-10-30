# Slides 新增对象

`createInsertedObject` 生成当前页中央的完整作者值和新 editKey，颜色由 `resolveInsertionPalette` 从文稿主题和当前页背景得出；orchestration 完成文字交接后向 manualEditing 提交 insert_objects。新增对象进入 deck.js 的 slide additions，经正式编译、源定位、预览与导出。空白页无需已有对象即可使用。

图片通过 imageEditing 的窄 `importSlideImage` 能力接管为文稿资产，源码只存 ID。等待期间切换文稿/页面或改变修订时拒绝落到过时目标。页序命令未呈现时禁用插入。保存期间 manualEditing 暴露 `pendingInsertions`，editingPreview 在独立临时层画出基础形状和本次导入图片的真实内容，保留虚线标记待保存状态。文字、带字形状及无本地图片来源的粘贴仍使用占位，不能伪造字体测量事实。失败或切页立即撤下临时内容；正式画面接管后不重复叠加。提交呈现后只在用户选择未改变时通过 `revealRequest` 选中新对象；单个文字框同时以全选进入输入，此时焦点来自用户刚点的插入动作。文字高度由下述明确策略交给正式编译器计算。

新建文字使用 `heightMode: content`：插入盒高度仅用于居中定位和保存期间的占位，正式高度随内容、字号与宽度增减。复制文字使用 `minimum` 保留复制时的几何；旧 additions 未声明该字段时保持原最小高度语义，不根据 editKey 或高度数值猜测来源。

不生成前端专用的持久节点，不绕过 CAS 队列，不将图片字节塞入源码。值合同见[authoringEditing](../../../shared/authoringEditing/README.md)，交互边界见[编辑体验](../../docs/editing-experience.md)。
