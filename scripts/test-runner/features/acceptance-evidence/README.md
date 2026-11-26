# 验收证据

这里收集现有测试和 Desktop 场景的执行事实，不负责测试选择、源码切换或发布。
Vitest 使用 `vitestReporter.mjs`；普通场景使用 `createEvidence.mjs`。不依赖任何外部任务管理工具。

调用者通过 `ACCEPTANCE_EVIDENCE_DIR` 提供本次独占的输出目录；未设置时创建系统临时目录。
结束生成 `evidence.json`（version 1）：`scenario`、`testFiles`、`checks`、`errors`、`artifacts`。
checks 记录名字、passed/failed/skipped、失败类型 assertion/error 和原因；errors 保存收集、启动、清理等流程错误。
只有断言错误可以证明旧实现复现失败，编译、超时、找不到元素或进程退出不能冒充业务断言。

testFiles 是相对仓库的测试及夹具文件；回归前后这些文件应保持一致。通用运行器不自动枚举业务夹具，
场景 owner 须把改变预期的外部夹具列入。artifacts 是输出目录内的相对路径；截图和采样在实例清理前复制。
调用者负责记录源码指纹、命令、退出码并计算附件哈希。本清单不自称证明源码新鲜度或安装包已验收。

Vitest 定向运行加 `--reporter=default --reporter=./scripts/test-runner/features/acceptance-evidence/vitestReporter.mjs`。
完整测试名为相对文件路径加 ` > ` 加 Vitest fullName；并发重试不是首次通过，失败重试记录也会保留。
重要 bug 应先用同一测试在旧实现上得到目标断言失败，再恢复修复验证通过。源码切换由当前工作区 owner
明确操作，不由证据工具自动覆盖工作区。前后必须使用同一命令、场景和测试文件，不能通过修改断言变绿。
