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

`write_file` 负责提供目标全文；`edit_file` 先在通用 VFS 文本投影上完成一次 exact
replacement，再把替换后的全文交给同一个 provider。provider 不重复实现字符串替换，也不反向依赖 Agent
Tool 类。

`edit_file` 的模型可见参数保持
`locator|inode + old_string + new_string + replace_all`，不增加私有 batch 方言。执行时始终重读 current
content，仅做 exact/unique 替换；成功返回变更行号和紧凑 unified
diff，未命中或不唯一时给出候选行和重读提示。

文档类型如果在 VFS metadata 暴露稳定 `sourceKey`，`edit_file` 会把该 read
receipt 作为内部 CAS 身份交给 provider。它不进入工具参数；provider 必须在正式写入前拒绝 stale
source，不能把精确匹配后发生的并发变化覆盖。
