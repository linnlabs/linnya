# Workspace 唯一运行 owner

生产 App Server 在初始化数据库、Qdrant 和任何启动维护前取得 Workspace 排他锁，持有至
进程退出。不同 Workspace 可独立运行；数据库 Worker 只连接既有业务库，不取得运行 owner。

`.runtime-owner.lock` 只利用已安装 SQLite 的 OS 文件锁，不建表、不保存恢复数据，也不是
第二个恢复数据库。所有执行事实仍在 `workspace.sqlite`。进程崩溃后 OS 自动释放锁；不通过
PID、心跳过期或删除锁文件接管活进程。锁文件不可在运行中删除，否则 inode 分离会破坏互斥。
当前合同只支持本机文件系统，不支持网络共享盘上的多机运行。

该锁只拒绝第二个 Backend，不承担客户端发现、连接复用或后台自启动；这些属于独立 Runtime
生命周期。旧 activation 的迟到提交仍由执行事务中的 execution identity 校验拒绝。
