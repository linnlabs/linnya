# App Server Bootstrap

本目录拥有 Electron Desktop Host 向 headless App Server 传递的一次性启动帧。它使用独立只读 pipe，
不占用 lifecycle stdin/stdout，也不把路径、环境或未来 capability token 暴露在命令行参数中。

启动帧最多 1 MiB，必须恰好一个严格 JSONL frame 后 EOF。内容只有 Backend 配置、冻结的
`BackendBootstrapFacts`（包含 Main 已验真的 Desktop 发行身份）、Main 在任何内部环境写入前捕获的 `HostProcessEnvironment`、已经验证的固定 Node 路径、
data-only local-process 平台 owner 事实与文本测量开关；
Browser Pretext worker 的启动时 availability 也作为冻结事实进入 child，避免 Backend 为读取同步状态再反向调用 Main；
不能加入函数、Electron 对象、Desktop port、任意方法表或业务请求。App Server 不重新读取发行清单或用环境变量推导
官方身份；child 校验完成后才允许初始化 Backend owner，
因此缺帧、多帧、相对路径、未知字段或超限都会在监听 HTTP 前失败。
