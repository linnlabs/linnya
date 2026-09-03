# Workspace Document File Create

`document-file-create` 是 `write_file` 在目标路径不存在时使用的创建用例。它与侧边栏/Document Surface 的通用生命周期创建不同：文件创建以精确路径和初始全文为输入，不能自动改成另一个同级名称。

由于节点尚未存在，本 feature 允许 Host 按已声明的文件名格式选择 provider；这是创建路由，不是文档身份推断。节点一旦创建，后续读写只按节点 `documentType` 分派。普通 `text/markdown` 预览内容不会参与创建路由，也不会获得 Markdown 文档身份。

Host resolver 的优先级为：

1. 已注册插件声明的扩展名；
2. 已知但当前不可用的插件格式，明确报告停用/未安装；
3. 无后缀、`.md`、`.markdown` 进入永久内建 Markdown provider；
4. 其他格式不支持，不做内容嗅探或 fallback。

Markdown provider 先在事务外完成异步文本编译与 Citation admission，再在一个同步 SQLite 事务中提交节点和首个正文版本。插件 provider 继续由自身 `createDocument` hook 负责原子性。
