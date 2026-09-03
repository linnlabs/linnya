# Command Permission Settings Authority

此模块是 Linnya App 生命周期内唯一的命令权限文档 authority。它接收 App owner 已解析的显式路径，组合 JSON 原子持久化、首次初始化标记与内存快照；不依赖 Electron、Renderer 或旧路径单例。

运行中的 Agent run 只读取当前 authority 快照。外部直接改写磁盘不会改变本次 App 的权限；设置页更新只有在原子持久化成功后才替换内存 revision。初始化标记存在而配置缺失或损坏时必须 fail closed，不能悄悄恢复 `standard`。

生产由 headless App Server composition 传入 Desktop bootstrap 中的 AppData 路径并创建唯一 authority；Renderer 设置 IPC 通过 typed RPC 访问该实例。
