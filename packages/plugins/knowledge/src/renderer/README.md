# Knowledge Base Renderer

`index.ts` 导出插件贡献 `knowledgeRendererPlugin`。Host 只按受准入来源授予固定应用槽，通过正式 runtime loader 加载；停用时页面、项目关联、文档菜单和全局弹窗随贡献撤销。Host 首包不静态导入此目录。普通插件不能凭 `meta.builtin` 或同名 ID 获得应用槽。

## 运行与通信

- `runtime.js` 的 `useKnowledgeBase()` 暴露只读事实与业务命令，按 Pinia 实例缓存运行 owner。首个消费组件卸载不停止应用任务，插件停用则清理订阅、轮询、动画和 watcher。
- `stores/knowledgeBase/index.js` 只保存事实并同步更新。目录、上传队列和图谱分别由 `features/` 中的编排持有流程；状态不反向调用编排。
- `services/knowledgeBaseService.ts` 仅使用已声明的插件 IPC，响应以 `../shared` 唯一业务 schema 解码。上传使用 Host 登记的 `knowledge/documents/upload` multipart 口，保留进度与 AbortSignal；不接触 session token、API 基址或通用 HTTP。
- `services/knowledgeRequestSession.ts` 将每次启用作为请求生命周期。停用/页面取消结束本地等待，旧响应不能写回下一次启用；已被后端接纳的任务仍由后端任务 owner 收口，不冒称远端 OCR 已撤单。
- 模型用途、展示名称与设置入口通过公开 Renderer model configuration facade 读取；索引影响查询向 Host 注册窄口，停用时撤销，不删除配置或模型绑定。
- 历史引用快照属于 Host。此插件只负责当前原件定位，历史回看不依赖插件启用。

## 页面与冻结范围

`applicationSurface.ts` 提供页面准备、引用原件定位与 Markdown 接纳用例。

- `prepareKnowledgePage` 先回列表再加载目录；页面 mounted 不迟到覆盖显式原件选择。
- 原件导航必须核对冻结项目关联，即使已经知道知识库 ID。只有成功读取且为空的项目绑定才使用默认库；无项目、读取失败、停用或范围不符都拒绝，不扫描全库。
- 文档菜单只接收 Host 冻结目标的 Markdown 快照，不读取另一个当前编辑器。一次选择固定项目、文档、名称及正文；切项目或停用取消未完成选择。
- 创建知识库一旦得到 ID，后续设置/关联失败只重试同一个实体；新的名称描述会应用到该实体，关闭后已创建库仍保留，下一次打开才开始新的创建会话。
- 项目关联读取失败不当成空绑定，无法确认时禁止保存；切项目或库后的迟到响应不写回当前表单。

## 失败资料与恢复

文件管理展示完成与失败文档，失败行呈现持久错误并保留删除。`hasSource` 是后端查询投影，不是新持久字段。有可读原文时，“查看已保存内容”使用现有公开 embedded Markdown 只读表面，关闭或换文档取消读取并销毁表面，不提供任意路径解析。

有原文的失败文档可通过“重建检索索引”恢复检索。同文件重传由后端引导重建；重新解析需先明确删除。仅残留 PDF、没有原文的失败资料不能承诺通过重建恢复。完成且 partial 的 PDF 才显示继续失败页解析；成功页不被重复摄入。

上传回执仅表示接纳任务。早到推送按任务 ID 缓存，绑定回执后回放；终态释放调度槽位，过期处理中进度不能倒退已完成状态。轮询与推送共用正式任务投影，停用不会保留校准定时器。
