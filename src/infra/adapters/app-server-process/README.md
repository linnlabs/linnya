# App Server Process Adapter

本 adapter 把 App Host 的最小控制协议绑定到一个不 detach 的 Node 子进程。生产 composition 必须先通过
`headless-node-runtime` resolver 得到固定随包 Node，再把绝对 executable、entry、cwd 和白名单环境注入这里；
adapter 不读取 PATH、不使用 `process.execPath` fallback，也不认识 Electron Utility。

启动它的 Desktop Main 或 CLI Runtime 是唯一 process owner。正常退出先发 `shutdown` 并等待确认；parent 消失时 child 通过 pipe 和 bootstrap parent identity 进入同一收口。stdout 只解析有界控制帧，普通日志从 stderr 上报；Command stdout/PTY 不经过此 adapter。

`waitForExit()` 只在 `start()` 后可用，并返回真实 code、signal 与是否由宿主 shutdown 发起。CLI Runtime
用它把运行期 child 崩溃投影为失败；正常 shutdown 仍以业务 owner 的收口屏障为准，不能只看进程消失。

fd 3 是一次性 bootstrap pipe：Host 写入已经由 App Host codec 校验的单帧后立即 EOF，child 在启动任何 Backend
owner 前读取并复核。fd 4 只允许 child 向 Host 写 RPC，fd 5 只允许 Host 向 child 写 RPC；数据面不复用控制
stdout，也不经过 Renderer IPC。RPC 只暴露 composition 注入的 handler registry，业务层必须再用严格 DTO adapter
包装 raw method，不能持有 supervisor 或 transport peer。
