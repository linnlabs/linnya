# Headless Node Runtime

本目录拥有 Linnya 内部无界面 Node distribution 的解析与完整性合同。它只解决“用哪一个固定、随包发布、
无 GUI identity 的 Node executable”，不拥有 App Server、Command Sandbox 或 Profiled Code Sandbox 的业务语义。

App Server、每条 Command execution 的一次性 runner、Profiled Code Sandbox evaluator 可以共享同一物理
distribution，但必须分别拥有 bundle entry、协议 codec、环境白名单、进程 owner 和发布 smoke。禁止使用
`process.execPath`、`ELECTRON_RUN_AS_NODE`、系统 PATH Node 或运行后隐藏普通 GUI App 的 fallback。

构建真源是 [`config/headless-node-runtime.json`](../../../../config/headless-node-runtime.json)。准备与开发阶段
通过 `verifyPreparedExecutableIntegrity` 同时复核 manifest 中 `prepared_executable` 的 size/hash，
不能只凭文件存在或大小相同就复用。打包调用方关闭这项准备阶段检查：重签会改变 executable 的大小和
hash，完整性改由 afterSign 和平台签名门禁负责；runtime resolver 仍严格检查 catalog、manifest、目标、
LICENSE、非空普通文件和执行权限。

`prepared_executable` 始终保留准备阶段事实，不承载签名后字节信息。macOS afterSign 只读验收，
不能为更新 size/hash 改写已被外层 App 签名封存的 manifest，否则会破坏签名。真实打包回归入口为
`test:shell-tool:formal-electron-sandbox`；正式签名与 Windows 仍须各自在目标发行环境验收。
