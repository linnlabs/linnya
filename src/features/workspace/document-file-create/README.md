# Workspace Document File Create

`document-file-create` 是 `write_file`
在目标路径不存在时使用的创建用例。它与侧边栏/Document
Surface 的通用生命周期创建不同：文件创建以精确路径和初始全文为输入，不能自动改成另一个同级名称。

由于节点尚未存在，本 feature 允许 Host 按已声明的文件名格式选择 provider；这是创建路由，不是文档身份推断。节点一旦创建，后续读写只按节点
`documentType` 分派。普通 `text/markdown`
预览内容不会参与创建路由，也不会获得 Markdown 文档身份。

Host resolver 的优先级为：

1. 已注册插件声明的扩展名；
2. 已知但当前不可用的插件格式，明确报告停用/未安装；
3. 无后缀、`.md`、`.markdown` 进入永久内建 Markdown provider；
4. 其他格式不支持，不做内容嗅探或 fallback。

`parentPath`
是当前项目根下的精确目录路径。创建时逐段读取当前节点树，复用已有普通文件夹，并自动创建缺失的中间文件夹；同名文件、隐藏节点、歧义路径和
`.linnya` 只读系统视图都拒绝。目录属于 Workspace
VFS，不创建 Shell 物理目录，不用 `.keep` 文件模拟目录。

Markdown provider 先在事务外完成异步文本编译与 Citation
admission，再在一个同步 SQLite 事务中重查/创建中间目录、提交文档节点、首个正文版本与结果回执。解析、引用、正文或回执失败都不留下本次新增目录；目录与文档 mutation 在事务结束后核对最终数据库事实才发布。

插件 provider 先用短同步事务创建中间目录，再调用原有异步 `createDocument`
hook；文档的原子性仍由插件拥有，不将 Promise 包进 SQLite 事务。hook 失败时保留已提交目录，避免删除被并发调用复用的路径。工具保持 error 终态，在失败 observation 列出
`created_folders`（locator/inode）和原始失败原因；未确认文档是否创建，调用方可用
`list_files` 检查。停用或不支持的格式在目录创建前拒绝。

成功结果的 `createdFolders` 只记录本次新建目录，按从外到内排序；工具映射为
`data.created_folders`
并写入模型 observation，完整卡片和紧凑轨迹显示新增目录数量。已有目录和更新文件回空数组，旧历史结果缺少字段仍可回放。

Markdown 的 `resultCommit`
将普通文件工具的完整结果与新文档同事务提交，支持中断后按原调用复取结果；回调只消费正式文档身份，不把上层任务生命周期写入 Workspace
owner。创建成功不代表正文内容已经核验。

业务验证：`src/tools/workspace/write_file/workspaceFileCreateFolders.integration.test.ts`
覆盖真实 SQLite、ToolNode、嵌套写读/列表、并发复用、冲突、Markdown 原子回滚、mutation 与回执、插件异步失败的真实边界。
