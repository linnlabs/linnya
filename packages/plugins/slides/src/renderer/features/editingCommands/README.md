# Slides 编辑命令

本 feature 拥有舞台顶部的浮动命令条（撤销/重做、插入、粘贴、保存状态）以及对齐/分布、绘制层序的动作；对象相关入口由 elementProperties 浮条承载，`SlideStage` 把浮条事件交给这里的 `arrange`、`setLayer`。`resolveLayerAvailability` 与后端同一规则（同页、同一作者祖先链、文稿顺序）判断还能往哪个方向移动图层。`useDelayedSaveStatus` 把编辑、保存、刷新合成一个 0.5 秒后才出现的“保存中”。规则在 functions，交接与队列编排在 orchestration，Vue 只连接控件。它不持久化文稿、不维护第二份撤销栈。

`arrangeSelection` 根据当前呈现的作者几何计算同一动作的多个 delta；单选以页面为基准，多选以并集为基准，分布固定外侧边界并按真实宽度留等距间隙。无变化不入队。图片/文字插入和剪贴板通过各 feature 公开 UI 组合，不在命令栏重写其业务。

文稿历史命令先完成文字交接、等待队列保存，再提交 undo/redo。Ctrl/Cmd 快捷键在画布或普通命令按钮拥有焦点时生效，输入框、菜单和文字编辑器保留自身历史；普通按钮按下时不夺走画布焦点。撤销/重做呈现后按后台返回的 focus 跳页，再请求画布重新选中对象。已保存与正在刷新分别展示。交互、复制边界及测试入口见[编辑体验](../../docs/editing-experience.md)。
