# 文件凭据存储

App Server 与可信后台 Worker 共享 API Key、Provider OAuth、插件及 Web 服务凭据。位置固定为应用
profile 的 `AIService/config/credentials.json`，不随 Workspace 切换或项目导出移动。
Desktop 生产 profile 来自 `userData`，开发 Desktop/CLI 使用 checkout 的 `_dev_electron`。
不读取旧凭据文件，不迁移系统钥匙串；开发签名和公证凭据不属于此合同。

这是受文件权限保护的明文 JSON，不提供自建加密或系统钥匙串选项。POSIX 文件为 600；
Windows 在写入任何凭据前，以内置 icacls 移除继承授权，只授权当前用户与 SYSTEM。
Agent 低权限访问还受内部存储隔离与审批控制，完全访问使用原用户权限。

文件适配器只处理 namespace、JSON 值和原子提交。业务 owner 负责凭据结构校验与
只返回配置状态的 DTO；共享合同不能成为任意业务注册中心。读失败、JSON/版本/结构损坏
均抛出不含文件内容的错误，不视为空。只有从未存在的文件允许初始化为空。

不同 Workspace 的 App Server 可以共享 profile，因此每次写入先获取短暂的 SQLite
OS 文件锁，再读取当前文件并合并目标记录。复用已安装的 better-sqlite3，仅用于互斥，
锁库不保存凭据，不删除锁文件，不以超时抢占活 owner。锁内不 await；Shell 不受此锁影响。
凭据写入同目录私有临时文件，fsync 后 rename，失败不发布新状态；崩溃遗留的私有临时
文件不会成为读取源。文件与临时文件都不属于日志、诊断、审计或导出输入。

环境变量仍由模型和 Web owner 解析，不写入凭据文件。
