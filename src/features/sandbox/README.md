# Sandbox

## 1. 产品定位

Sandbox 是 Linnya 内部注册 workload 的代码执行平台，例如 `ppt_compose`。它不是通用 Shell，也不替代命令工具的三档权限；Agent 想运行任意 CLI 仍然使用 `shell`。

Sandbox 的安全目标是请求/结果隔离、能力白名单、生命周期收口和可观察失败，不承诺把任意 JavaScript 或外部 CLI 变成操作系统级安全沙箱。

## 2. 代码树

```text
src/features/sandbox/
├── SandboxService.ts                 # 唯一业务入口
├── SandboxProfileRegistry.ts         # 注册 workload profile
├── definitions/                      # 请求、结果、取消、终态
├── ports/SandboxRunnerPort.ts        # 业务与 runner 的边界
├── profiles/                         # capability 和结果校验
├── runner-evaluation/                # 不依赖传输的业务计算
└── runners/local-process/
    ├── mailbox/                      # request/result 原子文件
    ├── utility/                      # Utility 通信协议
    └── lifecycle/                    # ready/started/terminal/cleanup

src/app-hosts/linnya/adapters/sandbox/production-runtime/
├── orchestration/                    # 唯一生产 composition 与 App owner 收口
├── functions/                        # transport、结果投影、runtime 解析
└── definitions/                      # 宿主无关的窄 fork/transport 合同
```

## 3. 生产调用链

```text
SandboxService
 → SandboxRunnerPort
 → App Host Sandbox production scope
 → 宿主注入的一次性 Utility fork adapter
 → 一次性 Utility process
 → shared local-process runtime
 → 随包无界面 Node evaluator
 → 原子提交 result file
 → drain stdout/stderr
 → 等待整棵进程树清理
 → 返回 Sandbox result
```

composition root 必须只安装一个正式 runner；缺失或重复安装都 fail-closed。当前 Electron
Main 不再创建 Sandbox owner；App Server 在最外层选择固定 headless Node child adapter，核心
mailbox/ACK/terminal/cleanup 编排不依赖 Electron。旧的
`fork + ELECTRON_RUN_AS_NODE` 和 GUI Main internal mode 都不再进入生产入口。

Evaluator 使用 [`config/headless-node-runtime.json`](../../../config/headless-node-runtime.json)
固定的官方 Node distribution 与独立 CJS bundle。开发态从仓库内已校验资产解析，正式包从
`process.resourcesPath/headless-node-runtime/` 解析；版本、平台、架构、manifest、hash/平台签名、
LICENSE 或 bundle 任一不合法时，runner 安装直接失败。禁止回退系统 `node`、`PATH`、
`process.execPath` 或普通 Linnya/Electron GUI 可执行文件。

## 4. 请求和结果

请求包含 workload profile、source、身份 token、大小预算和 capability。source、globals 等敏感内容不能通过 argv/env 传给 evaluator，而应写入受限 mailbox。argv 只包含 heap flag、固定入口、协议版本、随机 run token 和 heap 上限；请求文件采用临时文件 + 原子 rename，读取端校验 token、schema、source 大小和文件完整提交标记。

结果至少区分：业务结果、业务错误、取消、超时、owner end、runtime failure 和 cleanup status。结果文件合法不代表进程已经清理；只有 output drain、tree empty 和 resource release 均结算后，Service 才返回最终结果。

## 5. 与命令 runtime 的复用边界

Sandbox 复用公共进程 owner、启动屏障、整树终止、native loader 和发布检查；不复用 Commands 的权限规则、审批 UI、ToolOutputStore 或 Agent tool schema。共享“如何可靠拥有进程”，不共享“用户在产品上允许什么”。

## 6. 已知限制和风险

- CodeSandbox/JavaScript evaluator 只是业务计算 primitive，不是完整安全边界。
- Evaluator 启动、mailbox 损坏、结果缺失、Utility 通信断开都必须给出明确 runtime failure。
- `node:vm` 是受限计算 primitive，不是容器或 OS 级恶意代码隔离机制。
- runner 安装失败不能回退到旧裸进程实现。
- Windows 和 macOS 的平台差异由 local-process runtime 承担，profile 不写平台 kill 逻辑。

## 7. 测试门禁

新增 profile 必须覆盖 capability 拒绝、source/结果大小限制、token 错误、原子写入、ready/started/terminal 顺序、取消、超时、Utility 崩溃、结果缺失、输出 drain 和整树清理。至少有一条穿过 App Server headless Node adapter 的真实 production scope 集成测试；不能只 mock runner port。

详细实现见：[runner evaluation](./runner-evaluation/README.md)、[local-process runner](./runners/local-process/README.md)、[local process runtime](../../infra/adapters/local-process-runtime/README.md)。
