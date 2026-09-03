# Linnya 插件体系权威指南

本目录是 Linnya 官方 runtime 插件体系的长期文档入口。开发、评审和发版以这里和代码事实为准。文档按模块分章：**开发什么，看对应章节**。

## 当前定位

Linnya 支持的是 **官方可信 runtime 插件**：

- 插件可以有独立 `plugin.json`、独立版本、独立 backend/renderer 构建产物、独立数据库迁移和 R2 artifact。
- 官方插件包是 monorepo workspace 成员，但运行时和构建时仍通过别名直读源码；发布和安装依赖独立 artifact，`node_modules/@plugin/**` 不进入 asar。
- 插件已经具备安装、启用、停用、卸载和远程更新生命周期；远程链路当前以 SHA512 做完整性校验，生产发布方真实性与 packaged 来源准入仍按下述信任策略实施。
- 主应用通过 manifest、registry、document type hook、IPC 白名单和生命周期执行器接入插件能力。
- 当前不支持第三方不受信代码。生产安装包短期只允许受保护 bundled composition 或验签 catalog 证明的官方插件；权限执行、第三方沙箱和市场化分发属于未来独立安全模型。

## Core 与发行组合面

Linnya Core 的静态运行面只有 `platform`。当前产品发行可以随包组合 Mindmap、Slides 等插件，但这些身份只存在于插件 owner 与发行清单；Core 不持有具体插件的 ID、业务名称、Agent、Prompt、文档类型、数据库表或环境开关。

默认运行面和默认发布面是两个相邻但不同的入口：

- `src/app-hosts/linnya/plugin-registry/builtin/index.ts` 只静态装配平台 contribution；其他 backend contribution 由通用 direct/active/bundled artifact loader 发现。高信任 Plugin CLI 资格跟显式装配来源走，不跟某个 ID 白名单走。
- renderer 开发态源码发现走 `plugins:renderer-entries`，只处理已注册、已启用且能从官方源码目录或显式 direct/active artifact 目录解析到的插件，不会因为 workspace 中存在某个目录就自动加载。
- App Server inline/source 开发态不再隐式扫描仓库 `extraResources/plugins`。该目录是可残留的构建输出，只有正式打包运行态或显式 `LINNYA_BUNDLED_PLUGIN_ROOT` 的隔离 artifact smoke 才能把它作为来源。
- 发布面由 `scripts/release/plugin-release-targets.mjs` 的 `officialPluginReleaseTargets` 决定；`package:plugins:official`、`smoke:plugins:official:artifact`、默认 `prepare:extra-resources`、R2 smoke 和 catalog 都从这份清单派生。正式随包准备完成后会校验物理目录与该清单完全一致。
- 单插件 artifact smoke 每次创建独立临时 bundled root，只放本次生成的目标插件，并把该显式 root 同时交给 artifact verifier 和磁盘 backend loader；运行结束整体清理，不读写仓库共享 `extraResources/plugins`。
- 下游插件可以在自己的仓库或集成分支保留独立 package、smoke 和 test 入口。这类入口不代表插件进入默认产品面。

新增官方随包插件时，只更新插件 owner 与 `officialPluginReleaseTargets`，让构建生成 artifact 后走同一套通用 loader；不要在 Core runtime state、seed、IPC handler、renderer loader、schema 或公共测试中补插件 ID 专门分支。

## 架构参考

| 文档 | 说明 |
| --- | --- |
| [插件系统架构参考](./architecture.md) | 系统结构、模块职责、数据流、启动时序、状态管理、环境差异、边界约束 |
| [生产插件分发与信任策略](./production-distribution-and-trust.md) | packaged 官方插件来源、签名 catalog、启动准入、开发直载边界，以及与开源产品装配的门禁关系 |
| [Conversation 输入贡献框架规范](../../apps/renderer/domains/conversation/docs/input-contribution.md) | conversation 域以通用动词、挂载点和 opaque 数据接入文档类型交互的稳定契约 |
| [Conversation 输入贡献框架规范](../../apps/renderer/domains/conversation/docs/input-contribution.md) | 输入框引用 / 输入扩展 / 触发途径三原语的注册化框架；table 模式解耦、@ 引用、页面元素交互的统一接入规范 |

## 章节导航（开发啥看啥）

| 你要做的事 | 看 |
| --- | --- |
| 判断功能要不要做成插件、新插件接入总路线 | [00 决策与接入路线](./guides/00-decision.md) |
| 建包、目录结构、公开入口、依赖归属 | [01 包结构与文件体系](./guides/01-package-structure.md) |
| 写 `plugin.json`、派生 PluginMeta、版本号 | [02 Manifest](./guides/02-manifest.md) |
| 后端 contribution 总览与生命周期 | [03 后端 Contribution](./guides/03-backend-contribution.md) |
| 前端入口、页面/surface、工具卡、图标、加载 | [04 前端 Contribution 与页面](./guides/04-renderer-contribution.md) |
| 自有文件格式（创建/写入/读取/搜索） | [05 文档类型插件](./guides/05-document-types.md) |
| 数据表、迁移、升级备份回滚 | [06 数据库与迁移](./guides/06-database.md) |
| 给模型贡献工具、ToolContext 装饰器 | [07 工具与 ToolContext](./guides/07-tools.md) |
| 插件 agent / subagent / prompt | [08 Agent 与 Subagent](./guides/08-agents.md) |
| 插件 skill / cookbook / 资源 | [09 Skill 与资源](./guides/09-skills.md) |
| 前后端通信、二进制、推送事件 | [10 IPC 与事件](./guides/10-ipc.md) |
| 需要宿主新能力、新增 SDK 门面 | [11 宿主平台门面](./guides/11-host-facades.md) |
| 插件触发普通 AI / 单个或批量 subrun、AI 上下文、工具刷新 UI | [12 AI 交互](./guides/12-ai-interaction.md) |
| 构建配置、磁盘 artifact、双进程状态边界 | [13 构建边界与双进程 Bundle](./guides/13-build-and-bundles.md) |
| 安装 / 启停 / 卸载 / 升级 / 商店 | [14 生命周期](./guides/14-lifecycle.md) |
| artifact、R2 发布、发版检查、环境变量 | [15 发布与分发](./guides/15-release.md) |
| 验收、守卫、防回潮 | [16 测试、验收与守卫](./guides/16-testing-and-guards.md) |
| 重型插件（重引擎/沙箱/隐藏窗口/物理外置） | [17 重型插件开发进阶](./guides/17-heavy-plugins.md) |
| Agent Shell、Plugin CLI bridge、standalone `entry.command` | [21 插件 CLI 与 Agent Shell 接入](./guides/21-plugin-cli.md)；补充阅读 [02 Manifest](./guides/02-manifest.md) / [15 发布与分发](./guides/15-release.md) / [17 重型插件开发进阶](./guides/17-heavy-plugins.md) |
| 插件商店列表/详情页展示、介绍、skills、agents、版本、大小 | [18 插件商店展示契约](./guides/18-store-presentation.md) |
| 对话输入引用、@ 候选、外部加引用、Accessory、Input Extension 边界 | [19 对话输入贡献](./guides/19-conversation-input.md) |
| 工具卡、SubrunCard、subrun 实时/历史展示（只展示，不负责发起） | [20 Subrun 过程展示](./guides/20-subrun-process-ui.md) |

参考实现（仅供对照，规则本身与具体插件无关）：

- **轻型插件样例**（引擎在 Renderer、结构化数据持久化、无宿主重型设施）：`packages/plugins/mindmap`。
- **重型插件样例**（App Server backend 重引擎 + Profiled Code Sandbox + Desktop 隐藏预览）：`packages/plugins/slides`。
- 重型功能「事后插件化」的现行参考见 [Slides 插件说明](../../packages/plugins/slides/README.md)；旧的 `docs/archive/slides-pluginization/` 归档不在仓库内。

## 核心概念速查

| 概念 | 一句话 | 真源 |
| --- | --- | --- |
| **PluginManifest** | 插件身份证 | `plugin.json`，schema 在 `packages/schemas/src/plugins/manifest.ts` |
| **PluginMeta** | 宿主可读的插件摘要 | 包内 `src/shared/pluginMeta.ts` 从 `plugin.json` 派生；已加载 contribution 注册到 BackendPluginRegistry；未随包装配插件未来由验签 catalog 提供 |
| **Backend Contribution** | 插件后端能力集合，按 Tool/Agent/Skill/Document/IPC/Runtime/Database capability 分组 | `src/plugin-sdk/backend/pluginContribution.ts`，host registry 只做兼容加强 |
| **Renderer Contribution** | 插件前端能力集合 | `src/plugin-sdk/renderer/pluginContribution.ts`，renderer host registry 只做兼容加强 |
| **DocumentTypeBackendHook** | 文档格式后端窄接口 | `src/plugin-sdk/backend/documentTypeBackendHook.ts` |
| **Plugin State** | enabled / disabled / missing 三态；missing.reason 区分从未安装与用户主动卸载 | SQLite：`installed_plugins`、`enabled_plugins`、`plugin_migrations` |
| **Active Artifact State** | 当前实际运行的插件 artifact 指针事实，独立于数据迁移版本 | SQLite：`plugin_active_versions` + 磁盘 `active.json` |

## 十三条铁律

1. contribution 只声明能力，enabled 过滤由平台统一处理（[03](./guides/03-backend-contribution.md)）。
2. 插件启停运行态以 SQLite 为唯一真相；active artifact 指针由 `plugin_active_versions` 与 `active.json` reconcile，禁止模块单例（[14](./guides/14-lifecycle.md)）。
3. 通用 host 代码不 import 具体插件，也不保存其 ID/Agent/Prompt/文档类型语义；插件不 deep import host 内部；跨插件验收只放插件组合测试层（[11](./guides/11-host-facades.md)）。
4. 通用门面不挂插件专属函数；新能力先补窄门面五件套（[11](./guides/11-host-facades.md)）。
5. 创建/写入插件格式必须走 enabled hook；读取既有事实可走快照降级（[05](./guides/05-document-types.md)）。
6. host 工具派生 `ToolContext` 必须走 `derivePluginAwareToolContext`，禁止裸 spread（[07](./guides/07-tools.md)）。
7. 全局副作用走 `runtimeEffects` 幂等挂卸，不塞 IPC registrar（[03](./guides/03-backend-contribution.md)/[10](./guides/10-ipc.md)）。
8. 同一定义只有一个真源：常量、类型、工具名单、版本号不许多处手抄（[01](./guides/01-package-structure.md)/[02](./guides/02-manifest.md)/[07](./guides/07-tools.md)）。
9. 卸载不删数据表；禁用仍迁移；数据迁移版本不等于当前运行 artifact（[06](./guides/06-database.md)/[14](./guides/14-lifecycle.md)）。
10. 每删一个过渡入口，守卫同步升级为禁止复活；每插件有自己的守卫与 smoke（[16](./guides/16-testing-and-guards.md)）。
11. Renderer 展示层也必须插件化：插件 CSS、引用标签、外壳样式、workspace read 展示方式都由 renderer/document type contribution 声明，host 不按 pluginId 或 document type 名写分支（[04](./guides/04-renderer-contribution.md)/[12](./guides/12-ai-interaction.md)/[19](./guides/19-conversation-input.md)/[20](./guides/20-subrun-process-ui.md)）。
12. Agent 通过既有 `shell` 调用 `linnya-<plugin>` 薄 client，再由父 execution 的 bridge 回到当前 App； `entry.command` 只供人、开发脚本与 CI。两种 adapter 复用插件领域命令，但通用 command/tool 协议不得硬编码插件字段，bridge 不得拥有第二套 execution owner（[21](./guides/21-plugin-cli.md)/[02](./guides/02-manifest.md)/[17](./guides/17-heavy-plugins.md)）。
13. 插件版本目录不可变：同一 `pluginId@version` 的 `SHA512SUMS` 不一致必须失败并要求提升版本，不能用同版本覆盖或沿用旧内容（[14](./guides/14-lifecycle.md)/[15](./guides/15-release.md)）。

## 已知限制与 Backlog

2026-06-30 插件体系规范化审计已完成并销账删除；剩余事项转入本节长期维护。新增项应写清真实边界、优先级和真源，不再依赖一次性审计报告追踪。

| 项目 | 现状 / 真源 | 类型 |
| --- | --- | --- |
| 插件 gateway 透传 diagnostic | 当前插件 diagnostic 风格未完全对齐；后续按统一 `OperationResult.diagnostic` 语义收口 | 一致性 P3 |
| conversation metadata `[key: string]: any` | conversation 域类型未收口，插件规范化主线暂不扩大到该域 | 类型债 P2 |
| slides 子入口评估 | 子入口当前承担文档化职责，不为合并而合并 | 整洁度 P3 |
