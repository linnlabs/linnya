# Workspace Document File Write

`document-file-write`
负责把已经解析出的 Workspace 文档节点分派给对应的全文写入 provider。它只拥有文档身份、provider
admission 和调用顺序，不拥有任何文档类型的内部格式。

分派依据必须是正式节点的
`documentType`，不能根据文件后缀、MIME 或返回内容猜测。普通 `text/markdown`
只是可复用的文本展示格式；只有 `type='document'`
的 Workspace 文档节点才能进入内建 Markdown 的 normalization、Citation
hydration 和 pending revision 写入链。

Host resolver 组合两类实现：

- 永久启用的内建 Markdown provider；
- 贡献了 `writeDocument` 的插件 provider，并保留插件启停检查。

`write_file` 负责提供目标全文；`edit_file` 重读通用 VFS 后，可经 provider 的内部 `prepareEdit`
取得与正式读取一致的可编辑文本，再完成一次 exact replacement，并把目标全文交给同一个 provider。
provider 不重复实现字符串替换，也不反向依赖 Agent Tool 类。未声明 `prepareEdit` 的插件继续使用原 VFS 文本。

`edit_file` 的模型可见参数保持
`locator|inode + old_string + new_string + replace_all`，不增加私有 batch 方言。执行时始终重读 current
content，仅做 exact/unique 替换；成功返回变更行号和紧凑 unified
diff，未命中或不唯一时给出候选行和重读提示。

文档类型如果在 VFS metadata 暴露稳定 `sourceKey`，`edit_file` 会把该 read
receipt 作为内部 CAS 身份交给 provider。它不进入工具参数；provider 必须在正式写入前拒绝 stale
source，不能把精确匹配后发生的并发变化覆盖。

内建 Markdown 的 `prepareEdit` 将文档引用映射为当前 Conversation 别名供精确匹配；原始 VFS 文本
仍通过 `expectedCurrentText` 传递，完整文档结构、版本和 Pending metadata 的摘要通过内部
`expectedSourceKey` 传递。别名不进入并发基线。Markdown owner 在异步解析之后、同步提交之前
同时核对文本与来源快照，冲突抛出 `MARKDOWN_FILE_WRITE_CONFLICT`。主动全文覆盖也会校验本次
异步准备开始后的来源版本变化，不把开始之后的并发修改覆盖掉。
provider 不存在或禁用时由本 feature 返回 `WORKSPACE_DOCUMENT_WRITE_PROVIDER_UNAVAILABLE`；
正文、引用、并发冲突等错误由对应 owner 分类，分派层不吞并或重新包装未知异常。

文档 provider 可以通过 `resolveEquivalentEditText` 提供唯一且语义相同的旧文本拼写。
它只在通用工具 exact miss 后调用；返回当前原文片段，实际替换和 current snapshot 校验
仍走原有流程。Markdown 的转义/解析规则属于 Markdown owner，Workspace 不解析 Markdown。

provider 可在成功结果提供 `textMetrics`，只表达实际保存后的完整 current 文本字符数和汉字数；
Markdown 在提交事务内复用 current 块投影计算，包含 pending 与批注。通用工具将它投影为
`data.text_metrics` 及模型可见回执。没有实际全文事实的插件不填，不能数写入请求来冒充保存结果；
这不改变插件写入合同，也不新增隐式读取。计量单位与读取窗口边界见 [Workspace 工具](../../../tools/workspace/README.md)。
