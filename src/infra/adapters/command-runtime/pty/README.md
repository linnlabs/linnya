# PTY Runtime

## 功能边界

PTY 只在 Shell 明确请求 `interactive = true` 时启用。该层处理终端输入、submit、EOF、resize、终端流和屏幕 projection；它不判断权限、不创建审批、不知道 conversation 业务。

## 数据流

```text
native PTY stream
 → byte decoder
 → ANSI/CR logical-line parser
 → raw terminal artifact
 → headless screen state
 → bounded screen projection
 → Renderer card
```

raw terminal bytes 与屏幕 projection 分开，后者是可重放的结构化行/样式/尺寸，而不是将 ANSI 文本直接塞进 DOM。

## 控制合同

- `write`/`submit`/`eof` 仅绑定当前 execution 和 control ticket。
- `resize` 校验行列范围和 cell 预算；被拒绝的 resize 不得污染共享 promise chain。
- 进程进入 tree-empty 或 owner stopping 后拒绝 native input。
- PTY 不提供跨 Shell 调用的持久 cwd；每次新 execution 都有新的 PTY。

## 风险

PTY 输入可能包含密码、token 或提示注入内容，因此 Agent 默认没有 protected input 能力；用户直送输入走独立通道。ANSI parser 必须保持常量内存，不能缓存未结束的 OSC/DCS payload。

## 测试门禁

覆盖跨 chunk UTF-8/CRLF/ANSI、屏幕回滚、样式 allowlist、最大尺寸、resize 后继续 write、自然退出、取消、输入失败、tree-empty 和双平台 native PTY 组合。
