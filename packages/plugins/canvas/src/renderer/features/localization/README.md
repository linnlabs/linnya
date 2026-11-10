# Canvas 界面文案

Canvas 的界面文字集中在 `definitions/catalogs/`，按区域分文件，每个文件用 `defineCanvasMessages(中文, 英文)` 定义：中文是源文案，英文必须给出同一组键，漏键类型检查不过；两边的 `{占位符}` 必须一致，由 `canvasLocalization.test.ts` 检查，英文里不能出现中文。

- **取文案**：`canvasText(key, params?)`。Vue 模板里 `import { canvasText as t }` 后写 `t('canvas.zoom.out')`；菜单、状态、失败等组件之外的代码直接调用。在 computed 或渲染里调用会随界面语言切换重算；没有激活 Pinia（单元测试）时回到中文。
- **菜单项**：不再用模块级常量，按调用时的语言现建，保证切换语言后下一次打开就是新语言。
- **后端失败**：Backend 不知道界面语言。用户可能遇到的失败只回传 `shared/failures` 里的稳定编号，`requestCanvasIpc` 统一用 `projectCanvasFailureText` 换成当前语言文案；不在名单里的失败（宿主原文、只给 Agent/CLI 看的提示）原样显示。新增一种用户可见的后端失败时，先在编号名单里加编号，再在 `failureMessages.ts` 补中英文。
- **内核文字**：内核不依赖本地化 store，经 `CanvasKernelOptions.text` 接收；省略时使用默认中文。渲染 worker 不知道界面语言，它生成的卡片位图里的兜底字（“文档”“图片”“文档当前不可访问”）保持中文。语言切换时已绘制的卡片标题要到下次重绘才换。
- **不翻译**：快捷键符号、用户自己写的内容、Agent/CLI 面向模型的提示、插件对外的实体描述。
