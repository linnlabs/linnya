# App Server Process Adapter

本 adapter 把 App Host 的最小控制协议绑定到一个不 detach 的 Node 子进程。生产 composition 必须先通过
`headless-node-runtime` resolver 得到固定随包 Node，再把绝对 executable、entry、cwd 和白名单环境注入这里；
adapter 不读取 PATH、不使用 `process.execPath` fallback，也不认识 Electron Utility。

Main 是唯一 process owner。正常退出先发 `shutdown` 并等待确认，pipe 随 Main 消失时 child 也会沿 stdin EOF
收口。stdout 只解析有界控制帧，普通日志从 stderr 上报；Command stdout/PTY 不经过此 adapter。

fd 3 是一次性 bootstrap pipe：Main 写入已经由 App Host codec 校验的单帧后立即 EOF，child 在启动任何 Backend
owner 前读取并复核。fd 4 只允许 child 向 Main 写 RPC，fd 5 只允许 Main 向 child 写 RPC；数据面不复用控制
stdout，也不经过 Renderer IPC。RPC 只暴露 composition 注入的 handler registry，业务层必须再用严格 DTO adapter
包装 raw method，不能持有 supervisor 或 transport peer。
