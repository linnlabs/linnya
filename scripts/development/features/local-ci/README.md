# 本地 CI（macOS）

`pnpm run ci:local` 在本机按 `.github/workflows` 跑 CI 步骤，推送前一次看全所有失败，不用靠 GitHub 一轮一轮试。

## 做什么

- **命令来自工作流本身**：直接读取 `.github/workflows/*.yml` 的 `run` 步骤，不另维护命令清单。工作流改了，本地跟着变。
- **干净检出**：默认在系统临时目录为当前提交建一个 detached worktree，从装依赖开始跑，跑完删除。和 CI 一样没有本地 `_dev_data`、构建产物和未提交改动；有未提交改动时会提示。`--in-place` 直接用当前目录，快但会受本地残留影响（例如要求输出目录全新的画布探针）。
- **失败不停**：CI 里步骤默认 `success()`，前面一失败后面就跳过，后面的问题被遮住。本地继续执行，最后汇总全部失败。显式写了 `if:` 的步骤仍按真实结果求值。
- **相同步骤只跑一次**：命令、环境、目录都相同的步骤（例如每个任务开头的装依赖）复用第一次的结果。
- **证据**：失败任务的 `upload-artifact` 路径会从干净检出复制到日志目录。

## 平台怎么取舍

- 矩阵里有 macOS 时只跑 macOS 组合；其余组合在汇总里列为“只能由 GitHub 验证”。
- 固定在 Linux 上的任务（架构门禁、公共包检查等）按可移植任务在 macOS 上跑；步骤条件里的 `runner.os` 一律按 `macOS` 判断。macOS 文件系统默认不区分大小写，导入路径大小写这类只在 Linux 暴露的问题仍要看 GitHub。
- 只在 Windows 上跑的任务跳过。
- `uses:` 的外部 action（checkout、setup-node、Rust 工具链等）不执行，由本机开发环境提供；Node 版本以 `.nvmrc` 为准。
- 条件或命令里出现本地拿不到的值（`needs.*`、`github.*`、`secrets.*` 等）时，步骤标为“本地无法判断”并在汇总列出，不猜测。

## 用法

```bash
pnpm run ci:local --list                 # 只看计划
pnpm run ci:local                        # 全部 macOS 步骤
pnpm run ci:local --workflow ci          # 只跑 ci.yml
pnpm run ci:local --job architecture     # 只跑一个任务
pnpm run ci:local --in-place --job architecture
```

日志在 `_dev_data/ci-local/<时间>/`：每个执行步骤一个日志文件，`summary.json` 记录全部结果；失败时终端打印日志末尾。有失败或中断时退出码为 1。`Ctrl+C` 会停掉当前步骤并回收临时检出。

## 结构

- `functions/evaluateWorkflowCondition.ts`：仓库工作流用到的 GitHub 表达式子集（`runner.os`、`matrix.*`、`steps.<id>.outcome`、`always()` 等）；其他写法抛出“本地无法判断”。
- `functions/buildLocalCiPlan.ts`：工作流 → macOS 本地计划。
- `orchestration/prepareLocalCiCheckout.ts`：临时干净检出。
- `orchestration/runLocalCiPlan.ts`：逐步执行、日志、去重、证据复制。
- `bin/local-ci.ts`：命令入口与汇总输出。
