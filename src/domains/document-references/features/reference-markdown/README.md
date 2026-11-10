# 文档引用的 Markdown 读取与写入身份

`createDocumentReferenceMarkdownRuntime` 按数据库/插件实例创建，不使用模块全局缓存或永久墓碑。插件从 `@plugin/backend/documentReferences` 消费。调用方的可信读取身份包含 conversation/run；`sourceKey` 标识所读正文版本（例如卡片 ID 与元素修订），不能由模型自填 hash 替代。

- `registerRead` 将 canonical `documentReference` 投为当前同项目 `workspace:` 链接 JSON，并记录原 referenceId、targetDocumentId、路径和显示文字。调用方随后用自己的正式 Markdown serializer 输出正文。没有可访问路径的引用只显示不可访问说明，不泄漏标题或地址。
- `admit` 接收正式 parser 生成的 JSON。匹配已读链接时先检查路径仍指向原文档，再恢复原 referenceId；复制的第二处使用新 referenceId。新链接才按当前同项目路径解析。改名、移动、同路径换文档、删除或越界均明确拒绝旧链接，不重新绑定新目标。代码内文本不变成引用。
- 已有 tag 的正文替换缺少可信基线时返回 `reference_read_required`。包含失效/越界 atom 的有损全文替换返回 `reference_projection_lossy`，提示使用 canonical append 或在界面处理引用；不新增模型可见 UUID/占位协议。颜色等独立字段与未改正文不受此限制。
- `assertBindings` 是同步提交前置条件。parser/测高之后、同一 SQLite 提交事务内再次执行；只有准备时检查无法防止异步窗口内目标被改名或替换。bindings 的正式 DTO 在 `@app/schemas`，可以随调用方的待确认批次持久化，进程重启后仍能重验，不依赖读取缓存。

读取缓存最多保留 1024 个正文基线。重读同版本保留已见的旧路径身份，不能因一次新路径读取让旧链接偷偷改指向；不同 run 不共享基线。`clearReader` 释放已结束读取身份，重启或淘汰后重新读取即可。缓存缺失始终要求重读，不回退为“当成新链接解析”。普通 VFS 调用未携带可信 reader 身份时，消费方必须明确限制替换，不能承诺存在未登记的读取基线。

本 feature 只处理稳定引用与通用正文 JSON，不拥有 Canvas、Markdown rootBlock、版本/Pending、Conversation 生命周期或正文提交。具体文档 provider 必须在自己的保存/待确认/接受链上保存 canonical 节点与引用索引，并在提交事务里调用引用准入；仅启用编辑器 NodeView 不构成完整接入。
