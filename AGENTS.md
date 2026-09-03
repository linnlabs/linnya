# Linnya 工程地图

> 本文件只回答四个问题：Linnya 是什么，核心模块在哪里，数据如何流动，修改前该读什么。产品定义与长期愿景见[产品模型总览](./docs/product-model-overview.md)；具体实现以 owner 的公开合同、代码和相邻 README 为准。

## 1. Linnya 是什么

**Linnya 是一个以 Agent 为中心的文档数据库。** 用户的项目和文档进入统一逻辑数据库，由 VFS 投影成 Agent 可操作的路径；Agent 在真实的 Conversation 工作目录中运行，通过稳定的文件工具、Shell、插件 CLI 和 Skill 处理内容。

仓库中的产品由三部分组成：

- **Linnya Core**：Renderer、App Server、App Host、Workspace/VFS、Conversation、模型接入、基础工具和插件宿主。
- **Linnkit**：独立发布的通用 Agent framework；本仓只通过精确 npm 版本 `@linnlabs/linnkit` 使用，不包含或回连其源码。
- **插件**：在 Core 提供的合同上增加文档类型、界面、Agent、工具、CLI、Skill 和数据库表。公开仓包含已批准开放的官方插件，但插件业务语义不属于 Core。

产品概念、存储模型、基础工具面和插件接入原则统一从[产品模型总览](./docs/product-model-overview.md)开始阅读。

## 2. 运行边界

用户请求从 Renderer / Conversation 进入 App Server，App Host 使用 Linnkit 运行 Agent 并调用模型或工具；RuntimeEvent 被持久化并通过 SSE 投影回 Renderer。文件选择、窗口等桌面能力另走 Preload/IPC，由 Electron Main 提供；Main 不拥有业务数据库或 Agent loop。

继续阅读：[后端总图](./src/README.md)、[Conversation 全链路规范](./docs/conversation-platform/README.md)、[跨进程 DTO 与 Schema](./packages/schemas/README.md)。

## 3. 前端：Renderer 与 Conversation

[`apps/renderer`](./apps/renderer/domains/README.md) 是 Vue Renderer。`app/` 负责启动、布局和场景装配，`domains/` 拥有业务前端，`shared/` 只放稳定的跨域基础能力。

Agent 产品的主要前端是 [`domains/conversation`](./apps/renderer/domains/conversation/docs/README.md)，它负责：

- 输入、模型选择、运行控制和 Conversation 历史；
- HTTP/SSE 事件接纳、消息投影、工具卡、Subrun 与虚拟化时间线；
- 把 Backend 的正式 DTO 投影成 UI 状态，而不是重新解释 Runtime 或数据库事实。

修改身份、事件、持久化、实时/历史一致性时，先读根级 [Conversation Platform](./docs/conversation-platform/README.md)；只改 Renderer 实现时，再读 Conversation 域内导航。Vue 组件应保持薄，业务规则放 `functions/`，流程放 `orchestration/`，store 只持有状态并暴露 action/selector。

Workspace 树、编辑器、Knowledge 和模型配置等其他前端 owner 从 [Renderer domains 地图](./apps/renderer/domains/README.md)进入。

## 4. 后端：App Server、数据库与 Workspace

### 4.1 后端进程

[`src/app-hosts/linnya/app-server-runtime`](./src/app-hosts/linnya/app-server-runtime/README.md) 是业务 Backend 的生产组合根，拥有数据库、Agent、HTTP/SSE 和插件 Backend。[`src/app-hosts/linnya`](./src/app-hosts/linnya/README.md) 负责把 Linnkit 的 ports/protocol 装配成 Linnya 产品。

[`src/electron-main`](./src/electron-main/README.md) 是 Desktop Host：负责 Electron 生命周期、窗口、Preload/IPC、操作系统能力和 App Server 进程管理。不要因为部分后端实现仍位于 `src/electron-main/services` 或 `routes` 就把业务 owner 写回 Electron Main。

### 4.2 数据与存储边界

Linnya 是统一逻辑数据库，但不同数据有各自的物理落点和 owner：

- **Workspace SQLite**：保存项目树、Conversation 执行事实以及 Core/插件的结构化状态。[Workspace/VFS](./src/features/workspace/vfs/README.md) 拥有文档树和路径投影，[EventStore](./src/app-hosts/linnya/adapters/persistence/event-store/README.md) 拥有 Conversation 事实，各业务 domain/插件拥有自己的数据。
- **受管文件存储**：保存资产字节、Conversation 过程文件和超长工具输出；分别从 [Assets](./src/domains/assets/README.md)、[conversation-files](./src/domains/conversation-files/README.md) 和 [ToolOutputStore](./src/tools/tool_output/README.md) 进入。
- **Knowledge 存储**：由 [Knowledge Base](./src/features/knowledge-base/README.md) 统一编排 SQLite 元数据、Qdrant 向量和原文文件，不属于 Workspace VFS。
- **凭据**：API Key、OAuth 等只进入 AppData 的系统安全存储；不得进入 Workspace、Renderer、日志或数据库导出。

只记三条规则：Renderer 不直接访问数据库或物理路径；App Server 是业务存储的运行 owner；连接与迁移由 [`DatabaseService`](./src/electron-main/services/database.ts) 管理，具体读写必须回到对应 domain repository/用例，禁止跨 domain 直接写 SQL。Workspace 内容由 VFS 投影为 `workspace:/...`，Agent 只通过正式工具访问。

## 5. Agent 系统

Agent 相关改动先判断属于以下哪一层：

| 层 | 负责什么 | 第一入口 |
| --- | --- | --- |
| Linnkit core loop | Graph、Run、LLM/tool loop、RuntimeEvent、上下文、child run 和通用 ports | [独立 Linnkit 仓](https://github.com/linnlabs/linnkit) |
| Linnya App Host | 请求接纳、Flow、Runtime 装配、持久化、Realtime、ToolContext 和产品 capability 注入 | [`src/app-hosts/linnya/README.md`](./src/app-hosts/linnya/README.md) |
| Agent 定义 | 有哪些 Agent/Chat、prompt、task、工具白名单、模型与 step policy | [`agent-registry`](./src/app-hosts/linnya/agent-registry/README.md) |
| 模型目录 | 有哪些模型和端点、配置是否合法、凭据引用是什么 | [`model-catalog`](./src/domains/model-catalog/README.md) |
| Provider 推理 | route 合同、Provider SDK、request/stream/usage/continuation 映射 | [`model-inference`](./src/domains/model-inference/README.md) 与 [`inference adapter`](./src/app-hosts/linnya/adapters/inference/README.md) |
| Agent 工具 | Linnya 的 Workspace、Knowledge、Web、Agent control 等具体能力 | [`src/tools/README.md`](./src/tools/README.md) |

一句话区分：**Linnkit 决定 Agent 一般怎样运行；App Host 决定通用运行时怎样接入 Linnya；Agent Registry 决定运行哪个产品 Agent；Provider adapter 决定本次模型请求怎样落到厂商协议。** 产品特判不能进入 Linnkit，Provider SDK 也不能进入 Renderer、Model Catalog 或 Agent 定义。

### Command / Shell

`shell` 与 `process` 是 Agent 操作宿主命令和插件 CLI 的基础能力，也是权限、进程、输出、审批与 Conversation 工作目录交汇最密集的工具。修改前按以下顺序阅读：

1. [`Commands domain`](./src/domains/commands/README.md)：完整架构、owner、权限、执行与输出生命周期；
2. [`Shell tool`](./src/tools/commands/shell/README.md)：模型可见合同和启动语义；
3. [`Process tool`](./src/tools/commands/process/README.md)：长进程续读、输入、等待和终止；
4. [`Plugin CLI bridge`](./src/app-hosts/linnya/application/plugin-cli-shell-bridge/README.md)：Shell 如何调用当前 App 中已启用插件的 CLI。

Command 不是普通 `child_process` 包装。不要绕过 Commands domain 直接启动进程、自己实现审批、拼接输出路径或为某个插件增加专属 Shell 字段。

## 6. Linnya Core 与插件

Core 只提供 `platform` 能力和稳定扩展合同，不持有 Mindmap、Slides 等具体插件的 ID、表名、Prompt、Agent 或业务分支。插件可以同时贡献 backend、renderer、shared schema、文档类型、数据库 migration、Agent、工具、CLI、Skill 与 artifact，并独立版本化和发布。

开发入口：

- 插件是否成立、如何接入、运行和发布：[`docs/plugins/README.md`](./docs/plugins/README.md)
- Host 对插件开放的窄合同：[`packages/plugin-host-contract/README.md`](./packages/plugin-host-contract/README.md)
- 开放官方插件实现：[`packages/plugins`](./packages/plugins)
- 插件共用的 Renderer 基础 UI：[`packages/renderer-ui/README.md`](./packages/renderer-ui/README.md)

Host 不 deep import 插件内部实现；插件不 deep import Host 内部。新增文档类型优先贡献 VFS 投影、CLI 和 Skill，不为每个插件扩张 Agent 基础工具面。

## 7. 技术与开发入口

| 主题 | 当前实现 / 文档 |
| --- | --- |
| Renderer | Vue 3、Pinia、Vite；见 [Renderer domains](./apps/renderer/domains/README.md) |
| Backend | Node.js 22、TypeScript、Express、独立 App Server；见[后端导航](./src/README.md) |
| Desktop | Electron Main + Preload/IPC；业务流式接口使用 localhost HTTP/SSE |
| 数据 | `better-sqlite3`、Qdrant、受管文件存储；跨边界只传稳定 identity/DTO |
| 前后端合同 | [`packages/schemas`](./packages/schemas/README.md)；外部数据进入可信代码前必须执行 schema parse |
| 构建、测试、本机配置 | [`docs/development/README.md`](./docs/development/README.md) |
| 打包与测试选择 | [`docs/development/build-and-test.md`](./docs/development/build-and-test.md) |
| 文档位置与 README 规范 | [`docs/development/documentation.md`](./docs/development/documentation.md) |

修改前先定位唯一 owner，阅读相邻 README、公开 index、schema 和调用链。跨 domain 协作只走窄 public contract、port、registry、event 或 app-level orchestration；禁止 `any`、不安全断言、旧合同双读和无业务含义的 fallback。完成后运行目标 owner 的最小真实 gate并检查 `git diff --check`，架构、目录、合同或工作流变化同步更新 owner 文档。
