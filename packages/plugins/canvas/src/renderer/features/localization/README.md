# Canvas 界面文案

Canvas 的界面文字集中在 `definitions/catalogs/`，按区域分文件，每个文件用 `defineCanvasMessages(中文, 英文)` 定义：中文是源文案，英文必须给出同一组键，漏键类型检查不过；两边的 `{占位符}` 必须一致，由 `canvasLocalization.test.ts` 检查，英文里不能出现中文。

- **取文案**：`canvasText(key, params?)`。Vue 模板里 `import { canvasText as t }` 后写 `t('canvas.zoom.out')`；菜单、状态、失败等组件之外的代码直接调用。在 computed 或渲染里调用会随界面语言切换重算；没有激活 Pinia（单元测试）时回到中文。
- **菜单项**：不再用模块级常量，按调用时的语言现建，保证切换语言后下一次打开就是新语言。
- **后端失败**：Backend 不知道界面语言。用户可能遇到的失败只回传 `shared/failures` 里的稳定编号，`requestCanvasIpc` 把编号换成当前语言文案；新增一种用户可见的后端失败时，先在编号名单里加编号，再在 `failureMessages.ts` 补中英文。
- **界面显示失败**：凡是要显示给用户的失败，一律经 `canvasUserMessage(error)` 取那句话。能原样显示的只有三种：画布自己按当前语言写的提示（抛 `CanvasUserError`，不要抛带翻译文字的普通 `Error`）、后端失败编号、Host 声明可展示的文档预览失败。其余原文（IPC、数据库、渲染环境、第三方库）只写 renderer 日志，界面显示与后端相同的通用失败句（请用户重试，多次失败再重启；界面没有日志入口，提示里不要让用户去看日志）；能说清原因的环境编号（如 `canvas_2d_unavailable`、`canvas_webgl_required`、`html_canvas_unavailable`、`canvas_graphics_context_lost`）在 `KNOWN_INTERNAL_FAILURES` 里换成具体说明。插件调用送达未知时抛 `CanvasDeliveryUnknownError`，提示用户先看画布再决定是否重试。
- **内核文字**：内核不依赖本地化 store，经 `CanvasKernelOptions.text` 接收；省略时使用默认中文。渲染 worker 不知道界面语言，它生成的卡片位图里的兜底字（“文档”“图片”“文档当前不可访问”）保持中文。语言切换时已绘制的卡片标题要到下次重绘才换。
- **不翻译**：快捷键符号、用户自己写的内容、Agent/CLI 面向模型的提示、插件对外的实体描述。
