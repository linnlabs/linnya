# Slides 只读详情预览

本 feature 拥有不连接文稿编辑 store 的只读分页能力。`PresentationReadonlyPreview`
接收一个正式 RenderModel 读取函数和本地化文案，每次仅生成当前页 bitmap；按钮与区域内左右方向键切页，首尾不循环。切页取消旧栅格请求，迟到 bitmap 立即关闭，卸载关闭当前 bitmap 与 canvas
backing store，不生成缩略图或写入会话。

`SlidesDocumentPreview` 是文档类型 `readonlyPreviewComponent`
的懒贡献，接收 documentId/projectId 和 Host 已显示的封面图（cover）。它接在封面原来的位置：读取期间沿用封面图，自己的第一页画好后原地替换，不空白、不跳位、不改变面板高度；不设最小高度、不上下居中，翻页条叠在幻灯片底部并粘在可见范围内（画布卡比幻灯片矮时也够得着）。历史面板等大容器不带这些规则，仍是居中的舞台。读取当前 RenderModel 前后都使用通用引用解析核对项目和可用状态；正式 Workspace 正文、转移、删除事件令旧详情失效。悬停预览里挂载时不自动抢焦点，不提供编辑、保存、定位或递归引用预览。

历史版本通过同一个公开分页组件渲染；历史 feature 只负责按 versionId 读取自包含 RenderModel 和提供历史反馈，仍保持打开历史时的键盘焦点行为。两个入口不复用当前文稿的可写 file
session。
