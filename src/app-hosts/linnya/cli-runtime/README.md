# Linnya CLI Runtime Host

本目录是源码版 `linnya runtime start` 的 Node composition root。它与 Electron Main 二选一拥有同一个
App Server Backend 子进程；不会在 CLI 内复制 Backend、数据库、Flow 或插件 registry，也不会 detach
成后台 daemon。终端 `SIGINT/SIGTERM`、启动中断和子进程意外退出都经过 supervisor 的真实收口或失败合同。

CLI Runtime 使用 `_dev_data` AppData，并可显式覆盖 Workspace。Workspace 排他锁仍由 App Server 在任何
数据库恢复前取得，因此 Desktop 与 CLI 指向同一 Workspace 时后启动者会明确失败。会话 HTTP/SSE、历史、
模型目录、Flow、并行运行、命令进程树和崩溃恢复继续由同一 Backend owner 提供。

宿主能力按真实可用性组合：系统 keyring 凭据、插件文件凭据和纯 Node 能力可用；Renderer 瞬时通知由空展示
sink 消费，因为权威业务事实已经持久化；隐藏 Chromium worker、Browser Pretext、Chromium PDF、OAuth
浏览器、系统文件管理器显示、Web Chromium renderer 与 Desktop 导出目标会返回明确不可用错误。普通 HTTP
Web Read 仍可工作，其动态页面升级路径不会伪装为成功。

当前入口是独立 `linnya-cli-runtime.cjs` bundle，由 CLI 通过窄 launcher 动态加载。普通 CLI 命令仍只包含
参数、控制面连接和输出，不把完整 Backend 打进控制客户端。
