# Command Launch Environment

## 1. 作用

该层把已解析的 shell、平台、工作目录、编码和受控环境变量冻结成 launch snapshot，供一次性 runner 使用。它不读取权限设置、不安装 CLI、不继承 renderer 的任意环境对象。

## 2. 快照字段

launch snapshot 至少区分：

```text
platform = macos | windows
shell_semantics_id
executable/profile id
cwd (validated conversation directory)
encoding / locale policy
environment entries (allowlisted and redacted)
mode = pipe | pty
initial wait / hard timeout
```

snapshot 创建后不可变；Runner、Audit、Renderer 都消费同一个事实，不在各层再次解析当前平台或重新拼接 PATH。

## 3. 平台语义

macOS 默认 zsh；Windows 优先 PowerShell 7，缺失时使用 PowerShell 5.1 fallback，并在 `shell_semantics_id` 中体现。Shell 可访问网络和宿主 CLI，但 Linnya 不负责管理 npm/pip/brew/Python 环境。

## 4. 安全和兼容

cwd 必须来自 conversation-files admission，不能是任意绝对路径。环境变量按 allowlist 生成，保护输入、source、token 和完整用户环境不得进入 argv/env。路径和 executable 解析失败要在 spawn 前报告。

## 5. 测试

覆盖 macOS zsh、Windows PowerShell 7/5.1、缺失 shell、cwd 越界、编码/Unicode、env allowlist、PTY/pipe 互斥、超时快照和 packaged 发布路径。
