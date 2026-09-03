# README_FOR_AI：Linnya 公开工程地图

> 本文件是给 AI 与新贡献者的公共工程导航，回答 Linnya 的代码如何分层、改动应该归谁，以及应继续阅读哪份正式文档。产品定义见[产品模型总览](./product-model-overview.md)，本地操作见[开发指南](./development/README.md)。实现事实以 owner 代码、schema 与相邻 README 为准。

## 1. 产品与架构

Linnya 是一个以 Agent 为中心的文档数据库，也是基于 Electron 的可扩展桌面工作台。Workspace、对话式 Agent、富文档编辑、知识库、模型管理和文档插件通过明确的 domain 与 Host 合同协作。

| 层 | 主要目录 | Owner |
| --- | --- | --- |
| Renderer App | `apps/renderer/` | Vue 界面、交互、前端 domain 与应用装配 |
| Linnya App Host | `src/app-hosts/linnya/` | 把 Agent、工具、持久化、模型与插件装配成产品 |
| 产品业务 | `src/domains/`、`src/tools/` | 业务定义、规则、流程与能力 |
| Electron / Infra | `src/electron-main/`、`src/infra/` | 桌面生命周期、IPC、进程与技术适配器 |
| Linnkit | `@linnlabs/linnkit`（npm；源码见 `linnlabs/linnkit`） | 独立版本的通用 Agent runtime、Graph、工具执行、事件与 ports |
| 产品合同 | `packages/schemas/` | 跨进程、跨端和跨插件 DTO 与 schema |
| 插件平台 | `packages/plugin-host-contract/`、`packages/plugins/` | Host 门面、开放插件及其 artifact |
| 共享 Renderer UI | `packages/renderer-ui/` | 稳定 token、基础控件、图标和交互原语 |

## 2. 核心边界

1. Linnkit 只拥有通用 Agent runtime；Linnya 产品选择、数据库、具体 Provider 和 UI 不进入 Linnkit。
   Linnya 通过精确 npm 版本消费它，禁止用 tsconfig、Vite 或测试 alias 回连任何 Linnkit 源码目录。
2. 跨进程或跨端产品 DTO 归 `packages/schemas/`；producer 与 consumer 不各写一份 interface。
3. Provider SDK 只存在于 Host capability；Renderer、model catalog 和 Linnkit 不识别 SDK 实例。
4. 新业务采用 domain-first vertical slice；跨 domain 只走窄 public contract、port、registry、event 或 app-level orchestration。
5. Vue 层保持薄；规则和计算放在 `functions/`，多步骤副作用放在 `orchestration/`，store 只持有状态并提供 action/selector。
6. 全局 `shared/` 只放真正跨业务、稳定、通用的能力，不能成为杂物间。

## 3. 插件边界

公开 monorepo 当前包含 Mindmap 与 Slides 等已批准开放的官方插件。插件拥有自己的 backend、renderer、shared 合同、工具、Agent、Skill、迁移和构建产物；Host 不持有插件业务语义，也不 deep import 插件内部实现。

开发插件先读：

- [`packages/plugin-host-contract/README.md`](../packages/plugin-host-contract/README.md)
- [`packages/plugins/mindmap/README.md`](../packages/plugins/mindmap/README.md)
- [`packages/plugins/slides/README.md`](../packages/plugins/slides/README.md)
- [`packages/renderer-ui/README.md`](../packages/renderer-ui/README.md)

## 4. 按任务找 owner

| 任务 | 第一入口 |
| --- | --- |
| Agent loop、Run、child run、RuntimeEvent | [`linnlabs/linnkit`](https://github.com/linnlabs/linnkit) 的 Runtime 与 integration 文档 |
| Linnya Agent 与产品装配 | [`src/app-hosts/linnya/README.md`](../src/app-hosts/linnya/README.md) |
| 跨端 schema | [`packages/schemas/README.md`](../packages/schemas/README.md) |
| Renderer UI 通用能力 | [`packages/renderer-ui/README.md`](../packages/renderer-ui/README.md) |
| Slides | [`packages/plugins/slides/README.md`](../packages/plugins/slides/README.md) |
| Conversation CLI | [`apps/linnya-cli/README.md`](../apps/linnya-cli/README.md) |
| 产品定义与公开历史 | [`product-model-overview.md`](./product-model-overview.md) |
| 开发、构建、测试与本机配置 | [`development/README.md`](./development/README.md) |
| Conversation 身份、事件与 UI 投影 | [`conversation-platform/README.md`](./conversation-platform/README.md) |
| 插件架构与开发 | [`plugins/README.md`](./plugins/README.md) |

修改前继续阅读目标目录内的 definitions、functions、orchestration、公开 index 与相邻 README，确认调用链和唯一 owner 后再动代码。

## 5. 开发规则

- 禁止 `any`、不安全断言和为了暂时通过编译而扩大的类型。
- 禁止无业务含义的 fallback、重复判断、宽 `try/catch` 和旧合同双读。
- 跨 domain store 不互相读写；由 app-level orchestration 或正式协作边界连接。
- 优先复用现有标准、合同和 package；新增抽象必须有明确 owner 与稳定复用证据。
- 测试真实业务行为、合同和错误语义，不锁 README、样式数值或无意义实现细节。
- 架构、目录、合同与工作流变化必须同步更新 owner 文档。

## 6. 开发与验证

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run dev:electron
```

提交前运行目标 owner 的最小真实 gate，并确认 `git diff --check`。完整入口见[构建与测试指南](./development/build-and-test.md)。

## 7. 事实优先级

发生冲突时，依次核对：可执行 schema/public contract 与 owner 实现、相邻稳定 README、本工程地图。历史 proposal、audit、迁移记录和旧 release note 不能覆盖当前合同。

公共仓不保存内部过程 Proposal、研究日志或发布证据，也不得链接或依赖相邻私有文档仓。稳定结论必须回写对应 owner README 或正式规范；完整边界见[文档治理](./documentation-governance.md)。
