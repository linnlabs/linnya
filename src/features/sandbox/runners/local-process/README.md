# Sandbox Local Process Runner

## 组成

该 runner 把 Sandbox request/result mailbox、Electron Utility 和公共 Local Process Runtime 组合起来，只服务 `SandboxService` 注入的一个 runner，不对 Agent 暴露通用命令接口。

```text
SandboxService
 → SandboxRunnerPort
 → mailbox request (atomic)
 → one-shot Utility
 → shared local-process owner (macOS PGID / Windows Job)
 → pinned headless Node + Sandbox Evaluator bundle
 → result_committed (atomic)
 → host strict read
 → process tree cleanup
```

## 生命周期合同

```text
prepared → ready → started → result_committed → terminal → close → tree_empty → release
```

每个 run 有独立目录、token、generation 和 Utility。`result_committed` 只证明结果文件完整提交；Utility/Evaluator 退出、stdout drain、tree empty 和 resource release 仍要分别结算。

Evaluator launch snapshot 只包含经过 composition root 验证的绝对 `executablePath`、绝对
`entryPath` 和固定环境。`buildSandboxEvaluatorInvocationArgv()` 只追加 Node heap flag、协议版本、
run token 和 heap 上限；source、globals 和 capability payload 只能经 mailbox 传递。这里不解析
PATH，不接受用户选择 executable，也不提供 `process.execPath`/GUI Main fallback。

## 失败语义

启动前取消、Evaluator 启动失败、mailbox token 错误、结果缺失/损坏、Utility 强杀、通信断开和清理失败都必须保留独立原因。业务计算失败不能被包装成 runtime failure，runtime failure 也不能伪装成 profile 的业务错误。

## 测试

覆盖原子写入/严格读取、迟到帧、重复 generation、结果未提交、输出 drain、取消、超时、Utility 崩溃、目录清理和 macOS/Windows packaged 组合。生产 runner 只能安装一次，缺失或重复安装测试必须 fail-closed。

打包态还必须验证 Node runtime catalog/manifest/LICENSE、目标架构与平台签名，macOS 额外验证
Evaluator 不注册 LaunchServices App 身份，Windows 额外验证 `CREATE_NO_WINDOW`、顶层窗口为空和
Evaluator 整树位于 Job 内。Windows 静态/controller 通过不能替代真实普通用户安装机验收。
