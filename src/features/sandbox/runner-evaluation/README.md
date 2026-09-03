# Sandbox Runner Evaluation

## 责任

该层是与 IPC、mailbox、PID 和平台 owner 无关的 Sandbox 业务计算。它接收经过 schema 和 profile 校验的请求，执行允许的 workload 并生成结果；不负责传输、审批、超时计时或目录清理。

## 输入输出

输入包含 profile id、受限 source、capability 上下文和大小预算；输出必须符合 profile result schema，并把业务错误、取消、超时和运行时故障分开。`cleanupStatus` 由 runner 层补充，不能在 evaluation 中假装已经清理。

## 重要限制

`node:vm`/CodeSandbox 只是 Helper 内部执行 primitive，不是长期安全边界。profile 必须显式声明 capability；未声明的文件、网络或宿主能力直接拒绝。source/globals 不进入 argv/env，防止被进程列表或审计意外暴露。

## 测试

覆盖源码大小、NUL、profile capability、结果 schema、业务异常、取消/超时原因和错误分类。测试不依赖 Electron，另由 local-process runner 测试传输和清理。
