# Headless Node Runtime

本目录拥有 Linnya 内部无界面 Node distribution 的解析与完整性合同。它只解决“用哪一个固定、随包发布、
无 GUI identity 的 Node executable”，不拥有 App Server、Command Sandbox 或 Profiled Code Sandbox 的业务语义。

App Server、每条 Command execution 的一次性 runner、Profiled Code Sandbox evaluator 可以共享同一物理
distribution，但必须分别拥有 bundle entry、协议 codec、环境白名单、进程 owner 和发布 smoke。禁止使用
`process.execPath`、`ELECTRON_RUN_AS_NODE`、系统 PATH Node 或运行后隐藏普通 GUI App 的 fallback。

构建真源是 [`config/headless-node-runtime.json`](../../../../config/headless-node-runtime.json)。开发产物会复核
manifest 中的 size/hash；正式签名会改变 executable bytes，因此由 afterSign 和平台签名验证负责完整性，
runtime resolver 仍严格检查 catalog、manifest、目标、LICENSE、文件类型和执行权限。
