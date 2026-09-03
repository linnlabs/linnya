# Windows Local Process Runtime

## 1. 支持范围

- Windows 10 22H2 x64；
- Windows 11 x64；
- Windows 11 ARM64 上运行 x64 包的兼容层场景。

当前不提供独立 ARM64 发布包，也不把“ARM64 兼容层运行”描述成原生 ARM64 验收。

## 2. 为什么使用 Job Object

Windows 的 `child.exit` 不保证后代消失，`taskkill` 也不能提供稳定的 owner 和资源 accounting。Job Object 可以在普通用户下把 root/后代绑定到统一资源对象，cancel 和 App end 可以对整棵树操作。

Job 只解决进程归属和清理，不解决文件访问权限。Windows 的文件安全承诺仍然是普通用户 + 固定风险规则 + 审批 + 审计，规则漏判是明确接受的产品风险。

## 3. 启动和 native loader

正式启动顺序：

1. 读取固定 native runtime manifest；
2. 检查绝对路径、存在性、架构、版本、文件 hash 和 publisher；
3. 加载 native binding；
4. 创建 Job 和 process/thread/pipe handle；
5. 在用户 Shell 执行前完成归属；
6. 返回统一 pipe/PTY owner port。

任一步失败都拒绝执行。不能从 PATH、`app.asar` 内部路径或用户参数猜测另一个 DLL，也不能回退 Node `child_process` 裸跑。

## 4. PowerShell 和命令行

Windows Shell semantics 在 App 启动时冻结：优先探测 PowerShell 7，失败使用系统 PowerShell 5.1。launch snapshot 保存 semantic ID、版本、编码和 invocation profile，runner 不在每次命令中重新猜测。

Agent command 文本 12,000 code point 上限不等于 Windows 最终命令行一定可用。固定 wrapper、`-Command` 引号和内部参数会增加 UTF-16 长度，最终超限返回 `launch_payload_too_large`。

## 5. Job 生命周期

```text
CreateProcess
  → assign Job before user code
  → observers ready
  → release start gate
  → observe root exit + output
  → stop Job on cancel/timeout
  → wait Job tree empty
  → release handles/native binding
```

root exit、Job tree empty、pipe EOF 和 resource release 必须分开保存。KILL_ON_JOB_CLOSE 只能作为最后保护，不是“close 已成功”的证明。

## 6. PTY/ConPTY

PTY 使用现有 Rust native owner 的 Pseudoconsole + Job List 组合。Utility/native owner 必须位于被观察的命令 Job 外，才能在 cancel 后继续观察 tree-empty 和 release。

- `write` 原样写入；
- `submit` 写入并追加 CR；
- `eof` 使用 Windows 输入 EOF 语义，不能简单关闭 input handle；
- `resize` 受 columns/rows 和 cell budget 双重限制；
- 自然退出到 tree-empty 窗口内拒绝新的 resize/input。

## 7. 打包和发布风险

- app-local VC Runtime 必须部署到全部 native 运行位置；
- NSIS 使用 per-user 安装，不能假设管理员权限；
- release publisher 必须由构建入口显式声明，不能依赖 ambient env 猜测；
- unsigned development artifact 不能被正式 loader 接受；
- Sandbox evaluator 的随包 `node.exe` 必须通过固定 catalog/manifest 与 Authenticode 门禁，
  并继续由 native owner 以 `CREATE_NO_WINDOW` 创建、在用户代码前加入 Job；不得回退系统 Node
  或 Electron GUI executable；
- Win10 22H2 干净机的安装、覆盖升级、卸载和无 VC Runtime smoke 仍是发布门。

## 8. 已知限制

- 普通用户 Job 不是 OS 文件沙箱；
- 外部 CLI 自己的行为、凭据和数据库加密不属于 Linnya 职责；
- Docker/虚拟机只能验证部分协议，不能代替真实 Windows Job/native/NSIS 矩阵；
- x64 兼容层测试不能证明 ARM64 原生包。

## 9. 测试

必须有：普通用户三层进程树、root 早退、Job 后代、cancel/timeout、128 MiB 背压、native loader fault injection、ConPTY input/resize/EOF、packaged Electron 和安装包发布门；Sandbox 还要验证 evaluator 无控制台/顶层窗口、整树在 Job 内且 Utility crash 后归零。不能只检查进程返回码。
