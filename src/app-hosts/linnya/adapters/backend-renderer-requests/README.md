# Backend Renderer Requests

这里承接既有 Renderer `ipcRenderer.invoke(channel, ...args)` 的 Backend 业务入口。业务 handler 在
App Server 进程注册，Electron Main 只向已登记 channel 转发 data-only 参数；不传 `IpcMainInvokeEvent`、
`WebContents`、数据库对象或 Backend runtime owner。

注册表拒绝重复和未知 channel。跨进程 value codec 显式支持 JSON 基础值、`undefined`、`bigint` 与
`Uint8Array`/`ArrayBuffer`，拒绝函数、类实例和循环引用。它只是保持现有 Renderer API 的宿主 adapter，
不是新的插件接口，也不能用于调用任意 App Server method。

内部传输协议为 v2，Desktop 与 App Server 必须来自同一构建。纯 JSON 值经完整的有限数、普通对象、循环、深度和节点预算校验后，使用单个 `kind: json` envelope，不逐节点包装；含 undefined、bigint 或二进制的值继续使用 tagged 合同，不能静默转换。用户对象自身的 kind 字段位于 envelope 内。

小请求和结果直接走有界 JSON RPC。超过内联上限，或含有 64 KiB 以上字符串/二进制 leaf 时，改走
AppData 私有 mailbox；大 leaf 独立写入权限收紧的文件，RPC 只携带 operation id、随机 token 和提交事实，
避免在 Electron Main 对 50 MiB Slides 模板做同步 base64。纯 JSON 大值可整体写入一个受预算约束的 JSON 文件，避免 metadata 随字段数量膨胀；读取后仍执行准入。Desktop 调用结束后只清理本轮随机目录。

`registerCoreBackendRendererRequestHandlers` 已把 Workspace、Agent 配置、Todo、知识库关联、Markdown、
AudioBlock、BlockHistory、Web Search/Web Read 配置、插件安装/启停/诊断和已启用插件的 `plugin:invoke`
注册到同一 App Server
registry。Web 凭据在 App Server ready 前通过 Desktop credential port 解密进内存；读取热路径不跨进程，
保存时才异步调用系统安全存储。部分纯 Node handler 和初始化器仍位于 `electron-main` 历史目录，这是待按
domain/feature 逐步归位的物理目录债务，不代表它们运行在 Main，也不允许新的 Backend 代码继续放入该目录。

会话文件 `resolve/reveal` 也由 App Server 执行路径准入；`reveal` 在 conversation 删除屏障内通过窄
Desktop file-reveal RPC 调用系统文件管理器，绝对路径不会返回 Renderer。
