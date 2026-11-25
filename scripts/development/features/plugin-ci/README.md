# 插件增量 CI

在任意开发分支运行 `pnpm run ci:quick`。默认从当前分支与 `origin/main` 的共同祖先比较到工作副本，包含尚未提交的文件。`--base <ref>` 可以指定其他集成目标，`--list` 只显示文件、受影响的 workspace 包和选中的任务。PR 使用目标分支的实际 SHA 与本次测试的合并检出。

| 变更范围 | 本地快速检查 | PR 额外验证 |
| --- | --- | --- |
| 仅一个已登记插件的 `src/`、`resources/`，且 pnpm 包图中没有其他消费者 | 插件边界、类型、业务及相关 Host 集成用例。Slides、Knowledge 验收隔离产物，Decision 运行开发构建 | 完整公共架构和供应链门禁 |
| 满足上述条件的 Canvas 改动 | Host 集成，以及现有 Canvas 回归的 macOS 步骤，包括实际 Worker、像素、绘制和隔离产物 | 公共架构门禁及完整 Linux、macOS、Windows Canvas 矩阵 |
| 公共 schemas、Host 合同、清单、配置、多个插件、未登记插件或无差异 | 全量本地 CI | 完整公共检查、平台构建及 Canvas 矩阵 |

本地 owner 命令在当前工作目录执行。全量回退和 Canvas 回归会使用独立临时检出，带入 Git 可见的工作副本，重新生成依赖与探针产物。合入和推送 `main` 使用 `pnpm run ci:local` 的干净提交回执。

新增插件时在[门禁声明](./definitions/pluginCiGates.ts)登记该插件的构建或产物入口、包外 Host 用例以及专属回归（如有）。公共包的影响范围来自 pnpm 的反向依赖图。直接读取插件资源、按约定加载插件的 Host 用例须由 owner 随变更维护。各分支吸收同一公共提交即可复用。[PR 工作流](../../../../.github/workflows/pull-request.yml)
