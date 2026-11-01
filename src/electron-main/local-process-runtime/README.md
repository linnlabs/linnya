# Electron Local Process Runtime Composition

这里是桌面 Host 对公共 `local-process-runtime` 的启动事实组合层，不包含 Commands、Sandbox
或 Qdrant 的业务策略。

- `../../infra/adapters/local-process-runtime/production-runtime/functions/resolveLocalProcessPlatformRuntime.ts` 在 App owner
  启动时一次性解析平台 DTO；
- macOS 只需要 PGID owner 版本事实；
- Windows 固定 native manifest、运行时版本、App 版本与签名发布者；
- 正式包的发布者从已签名 App 本身读取，不能由环境变量或同目录 manifest 声明；
- 生成结果是 data-only DTO，后续可以原样传给 headless App Server。

签名检查异步执行，并为 Windows 冷启动 PowerShell/系统安全模块保留 30 秒上限。超时、进程失败或非法签名状态均阻止启动，不得降级为未签名发行；进程失败保留原始错误。Desktop 初始化和 child bootstrap 复用同一次检查所得的 DTO，不能重复探测。

Shell 探测只决定命令语义和环境，不再重复决定平台进程 owner。公共 launcher 位于
`src/infra/adapters/local-process-runtime/production-runtime/`，不同业务仅提供各自的
`executable/argv/cwd/environment`。
