# 本地 CI（macOS）

`pnpm run ci:local` 在本机按 `.github/workflows` 跑 CI 步骤，推送前一次看全所有失败，不用靠 GitHub 一轮一轮试。

开发分支可用 `pnpm run ci:quick` 选择受影响的插件；自动回退全量时，`--working-copy` 将 Git 可见的未提交改动带入临时检出。快速入口的运行不会生成合入回执。见[插件增量 CI](../plugin-ci/README.md)。

## 做什么

- **命令来自工作流本身**：直接读取全量工作流的 `run` 步骤，忽略只负责选择任务的 PR 入口，不另维护命令清单。工作流改了，本地跟着变。
- **干净检出**：默认在系统临时目录为当前提交建一个 detached worktree，从装依赖开始跑，跑完删除。和 CI 一样没有本地 `_dev_data`、构建产物和未提交改动；有未提交改动时会提示。`--in-place` 直接用当前目录，快但会受本地残留影响（例如要求输出目录全新的画布探针）。
- **Runtime 下载包**：本工作区的 `_dev_data/ci-local/runtime-archives/` 保留 Headless Node 与 Qdrant 的上游归档。准备脚本按当前目录清单的 SHA-256 校验后才使用，缺失或不匹配时重新下载。每轮在自己的检出里重新解包并验证可执行文件。删除该缓存后下次恢复冷启动。
- **失败不停**：CI 里步骤默认 `success()`，前面一失败后面就跳过，后面的问题被遮住。本地继续执行，最后汇总全部失败。显式写了 `if:` 的步骤仍按真实结果求值。
- **相同步骤只跑一次**：命令、环境、目录都相同的步骤（例如每个任务开头的装依赖）复用第一次的结果；另一个任务正在跑同一步时等它结束再复用。
- **Schemas 编译一次**。干净全量运行中，公共包、Canvas、Backend 和官方插件共用首次成功编译的 schemas。每个消费者仍校验公开入口的类型声明并实际加载 CommonJS 和 ESM，公共包门禁仍从 tarball 解包验收。直接调用、定向 CI、`--working-copy` 和 `--in-place` 每次从头构建。
- 公共包任务和 Canvas 回归都通过 Canvas 包自己的 `test` 脚本跑业务用例。本机全量运行的两条记录指向同一次执行，失败也会复用。只选其中一个任务时会实际执行一次。Host 持久化用例另行加载本轮构建的 Worker，绘制、像素和隔离产物仍各有独立结果。
- **Canvas 制品只打包一次**：干净全量运行中，官方插件生命周期和 Canvas 专项隔离验收使用同一份 Canvas 制品。打包与产物门禁成功后记录本轮 SHA-512，两套验收各自创建隔离目录并检查实际 ZIP。单独运行 Canvas 工作流、直接调用专项 smoke 或使用 `--in-place`、`--working-copy` 时仍从头准备。
- **并行但不放松**：任务之间按声明的调度类别并行，任务内部仍按工作流顺序执行；测试分片合并为一次多 worker 运行。见下文“并行与串行”。
- **证据**：失败任务的 `upload-artifact` 路径会从干净检出复制到日志目录。

## 平台怎么取舍

- 矩阵里有 macOS 时只跑 macOS 组合；其余组合在汇总里列为“只能由 GitHub 验证”。
- 固定在 Linux 上的任务（架构门禁、公共包检查等）按可移植任务在 macOS 上跑；步骤条件里的 `runner.os` 一律按 `macOS` 判断。macOS 文件系统默认不区分大小写，导入路径大小写这类只在 Linux 暴露的问题仍要看 GitHub。
- 只在 Windows 上跑的任务跳过。
- `uses:` 的外部 action（checkout、setup-node、Rust 工具链等）不执行，由本机开发环境提供；Node 版本以 `.nvmrc` 为准。
- 条件或命令里出现本地拿不到的值（`needs.*`、`github.*`、`secrets.*` 等）时，步骤标为“本地无法判断”并在汇总列出，不猜测。

## 并行与串行

所有任务共用同一份检出（GitHub 上每个任务各有一台机器），所以每个 `run` 步骤都在 [`definitions/localCiSchedule.ts`](./definitions/localCiSchedule.ts) 里按「工作流 → 任务 → 步骤名」声明类别，运行时不猜：

| 类别 | 含义 | 调度 |
| --- | --- | --- |
| `static` | 只读受 Git 跟踪的源码：lint、typecheck、架构门禁、Canvas 结构门禁、脚本单元测试。在 GitHub 上它们都排在本任务任何构建之前，不可能依赖产物 | 随时填空位，可以和构建同时跑 |
| `build` | 写共享产物：装依赖、WASM/Backend/Main/Renderer/CLI 构建、Canvas Worker、官方插件打包、公共包检查（首次准备 schemas 和 provider 的 pack-smoke 都要重建各自的 dist，Canvas Backend 运行时从 dist 解析 `@app/schemas`） | 一次一个；运行时不跑任何 `test`；有构建在等时不启动新测试 |
| `test` | 运行时读产物：合并后的公共测试、Canvas 业务与 Host 持久化用例、CLI 对 bridge 验证 | 构建全部完成后并行；合并后的公共测试单独占用测试资源，不与其他测试重叠 |
| `loadSensitive` | 测量绘制计数、DOM/位图与像素、帧，或真实进程生命周期：Canvas 绘制计数探针及其计数校验、DOM/位图比对、身份牌像素、隔离产物冒烟，真实 Runtime 生命周期与审批 | 没有任何其他步骤运行、也没有其他步骤可启动时单独执行，所以排在最后 |

负载下偶发失败比慢更糟：某一步在并行下不稳定时把它改成 `loadSensitive` 或 `build`，不要加长超时。工作流新增的 `run` 步骤没有声明时按 `loadSensitive` 单独执行并在开头提示；`__tests__/localCiSchedule.test.ts` 对照真实工作流检查声明没有遗漏或过期。

**测试分片合并**：同一任务的矩阵组合除 `vitest run ... --shard=K/N` 外完全一致、且分片正好覆盖 1..N 时，本地合并为一条执行线：相同的构建步骤只跑一次，分片步骤合并为去掉 `--shard`、`--maxWorkers` 换成本地 worker 数的一次运行（vitest 分片按文件划分，全部分片的并集就是不带 `--shard` 的同一条命令）。缺分片或其他步骤有差异时不合并，各组合照常执行。

**回执**：`summary.json` 的 `results` 仍为计划里的每一步（含每个分片）各记一条：合并分片的每一条都带 `mergedRun`，非主分片带 `reusedFrom`；`mergedTestRuns` 记录覆盖的分片、各分片原命令、实际命令、worker 数和 vitest 汇总行。失败按真正执行的那一步只算一次。`schedule` 记录核数、并行上限和 worker 数。

**进程回收**：每一步在自己的进程组里运行；命令退出后回收组里残留的子进程，中断时整组 SIGTERM，宽限期后 SIGKILL，等所有组退出再回收检出。

## 用法

```bash
pnpm run ci:local --list                 # 只看计划
pnpm run ci:local                        # 全部 macOS 步骤
pnpm run ci:local --workflow ci          # 只跑 ci.yml
pnpm run ci:local --job architecture     # 只跑一个任务
pnpm run ci:local --in-place --job architecture
pnpm run ci:local --concurrency 1        # 一次只跑一步（排查并行问题）
pnpm run ci:local --test-workers 8       # 合并测试的 vitest worker 数
```

默认并行上限 4，合并测试的 worker 数为“核数 - 6”（至少 2），给并行的源码检查和系统留出余量；也可用环境变量 `LINNYA_CI_LOCAL_CONCURRENCY`、`LINNYA_CI_LOCAL_TEST_WORKERS` 设置，命令行参数优先。

日志在 `_dev_data/ci-local/<时间>/`：每个执行步骤一个日志文件，`summary.json` 记录全部结果；失败时终端打印日志末尾。有失败或中断时退出码为 1。`summary.json` 的 `tree` 按代码内容标识被测提交，`fullRun` 表示没有用 `--workflow` / `--job` 缩小范围且计划里每一步都有结果，`passed` 表示没有失败也没有中断；`clean`、`fullRun`、`passed` 同时为真，才说明全部本地 CI 在这份代码上通过。`Ctrl+C` 会停掉所有正在运行的步骤并回收临时检出。运行被强制结束（`SIGKILL`、agent 停掉后台任务）时来不及回收；下一次启动会先回收进程已退出、又没用 `--keep` 保留的检出（每份约 1.6 GB）。

## 结果保留

每次运行（`--list` 除外）开始时，对本工作区 `_dev_data/ci-local/` 做一次清理，目录不会无限增长。满足任一条的运行目录保留，其余删除：

1. 最近 20 个运行目录（含本次，不论结果），便于对比失败；
2. 每个“受保护代码”最新的一份通过的完整回执（`clean`、`fullRun`、`passed` 同时为真）：受保护代码是本次运行的 `tree`，加上本仓库所有 worktree 当前 HEAD 的 `tree`；
3. 最近 7 天内开始的所有通过的完整回执。

合入与推送 `linnya` 主分支的本机门禁（工作台 `main-gate`）按代码内容 `tree` 在各 worktree 的 `_dev_data/ci-local/*/summary.json` 里查找通过的完整回执。规则 2、3 保证门禁还可能查到的回执不会被清理：待合入分支顶端、本地 main 顶端的回执属于某个 worktree 的 HEAD；分支继续前进后，旧回执仍在 7 天窗口里。失败、中断、只跑了部分任务或读不出回执的旧运行只受规则 1 保护，超出就删除。名字不是运行时间戳（如 `2026-11-19T10-30-55`）的条目不动。清理失败只提示，不影响本次运行。判定是 `functions/selectLocalCiRunsToPrune.ts` 的纯函数，通过回执的条件与工作台门禁保持一致，修改一边要同步另一边。

## 结构

- `functions/evaluateWorkflowCondition.ts`：仓库工作流用到的 GitHub 表达式子集（`runner.os`、`matrix.*`、`steps.<id>.outcome`、`always()` 等）；其他写法抛出“本地无法判断”。
- `functions/buildLocalCiPlan.ts`：工作流 → macOS 本地计划。
- `definitions/localCiSchedule.ts`：每个步骤的调度类别与默认并行参数。
- `functions/buildLocalCiLanes.ts`：计划 → 执行线；分类、去重指纹、测试分片合并与覆盖检查。
- `functions/pickLocalCiStarts.ts`：按类别决定下一批启动哪些步骤；worker 数与并行上限的取值。
- `orchestration/prepareLocalCiCheckout.ts`：临时干净检出。
- `definitions/localCiRetention.ts`、`functions/selectLocalCiRunsToPrune.ts`、`orchestration/pruneLocalCiRuns.ts`：运行结果保留规则、纯函数判定与实际清理。
- `orchestration/runLocalCiPlan.ts`：并行执行、日志、去重、进程回收、证据复制。
- `bin/local-ci.ts`：命令入口与汇总输出。
