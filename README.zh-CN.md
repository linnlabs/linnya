# Linnya（林芽）

[English](README.md)

Linnya 是一个以 Agent 为中心的文档数据库和可扩展桌面工作台。它把对话式 Agent runtime、项目文档、知识工具和插件系统统一在一个 Electron 应用中。

> Linnya 仍在快速开发。稳定版本之前，API、存储格式、插件合同和发布流程都可能发生不兼容变化。

## 这个仓库包含什么

- Linnya Desktop Host 与 Vue Renderer；
- 对已发布通用 Agent runtime `@linnlabs/linnkit` 的产品接入；
- 跨端 Schemas、插件 Host 合同和 Renderer UI 基础能力；
- 已批准开源的 Mindmap 与 Slides 官方插件；
- 公共源码构建、测试、Benchmark 和发布验证所需的工程工具。

并不是所有官方插件或托管服务都会进入公共仓。源码是否公开与生产插件如何独立发布是两条不同边界；公共源码必须在没有私有仓、私有凭据和相邻 checkout 的情况下独立构建。

公共文档只保存贡献者需要的稳定合同与维护规则。内部 Proposal、调研过程和发布证据保存在仓外，公共源码的构建、测试与理解都不得依赖它们。具体规则见[文档治理](docs/documentation-governance.md)。

## 架构

| 范围 | 目录 | 职责 |
| --- | --- | --- |
| Desktop Renderer | `apps/renderer/` | Vue 界面、交互和前端 domain |
| 产品 Host | `src/app-hosts/linnya/` | Agent、模型、持久化与插件的产品装配 |
| 核心业务 | `src/domains/`、`src/tools/` | 业务合同、规则、编排与 Agent 工具 |
| Agent runtime | [`@linnlabs/linnkit`](https://github.com/linnlabs/linnkit) | 从 npm 精确版本消费、独立发布的 runtime kernel、Graph、工具、事件和 ports |
| 插件平台 | `packages/plugin-host-contract/`、`packages/plugins/` | 稳定 Host 合同与开放插件 owner |
| 共享 UI | `packages/renderer-ui/` | Token、基础控件、图标与可复用交互 |

工程采用 domain-first vertical slice。跨 domain 协作只能走窄 public contract、port、registry、event 或 app-level orchestration，不能直接依赖其他 domain 的内部实现。

Linnya 对 `@linnlabs/linnkit` 使用精确 npm 版本。产品构建与测试从 `node_modules` 解析该包；框架源码、测试与发布流程只存在于[独立 Linnkit 仓](https://github.com/linnlabs/linnkit)。

## 开始开发

需要：

- Node.js 24，精确版本见 `.nvmrc`；
- Corepack 与 `package.json` 锁定的 pnpm；
- Rust 与 `wasm-pack`；
- 完整 Desktop 开发使用 macOS 或 Windows。

```bash
corepack enable
cargo install wasm-pack
pnpm install --frozen-lockfile
pnpm run dev:electron
```

源码开发环境刻意与 Linnya Cloud 解耦：不加载托管模型目录、不发送 Cloud 模型请求、不生成 Cloud 设备 ID，也不自动检查正式版更新。源码 checkout 只使用本地数据和开发者自己配置的模型 Provider，不需要 Linnya 账号或任何私有仓。

锁定的 runtime release 可用后，首次从源码启动开发环境或构建 Desktop 安装包时，会自动下载目标平台的 Qdrant 与 Poppler runtime，并校验声明的 archive、executable 和文件树 checksum。仓库首次公开前，维护者必须按开发指南把同一份已校验 archive 放入本地缓存。生成的 runtime 文件不进入源码版本控制；正式安装包已经携带这些 runtime，最终用户启动应用时不会再次下载。

架构、定向验证、原生模块和源码构建说明见[文档总图](docs/README.md)与[开发指南](docs/development/README.md)。

### 给编码 Agent 的一句话 Prompt

如果你使用 Claude Code、Codex、Cursor、Windsurf 或其他编码 Agent，可以直接粘贴下面这句话：

> 如果尚未 clone Linnya，请先 clone [https://github.com/linnlabs/linnya](https://github.com/linnlabs/linnya)；然后按照本 README 和 `docs/development/README.md` 准备本地桌面开发环境，使用 Corepack 和仓库锁定的 pnpm 版本，通过 `pnpm install --frozen-lockfile` 安装依赖并用 `pnpm run dev:electron` 启动 Linnya，将开发数据保留在默认隔离的 `_dev_data` 工作区，不依赖私有仓或相邻 checkout，也不要虚构或提交凭据，最后告诉我下一条要执行的命令，以及 Node.js、pnpm、Rust、`wasm-pack` 或平台前置条件中还缺少什么。

---

## 插件开发

插件拥有自己的 backend、renderer、shared 合同、工具、Agent、Skill、迁移和 artifact。Host 只提供稳定能力，不持有插件业务语义。

建议依次阅读：

- [插件架构](docs/plugins/README.md)
- [插件指南](docs/plugins/guides/00-decision.md)
- [插件 Host 合同](packages/plugin-host-contract/README.md)
- [Renderer UI 设计规范](packages/renderer-ui/README.md)

## 贡献与支持

提交修改前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。项目维护与决策方式也在贡献指南中说明。

可复现的公开源码或当前公开版本问题、边界清楚的功能方案、公开文档修正，以及不涉及私密信息的问题，请提交到 [GitHub Issues](https://github.com/linnlabs/linnya/issues)。提交前先搜索已有 Issue。Bug 报告应包含 Linnya 版本或 commit、操作系统、复现步骤、预期与实际行为，以及经过脱敏的相关日志或截图。

不要公开 API Key、数据库内容、私有文档、完整用户目录、私有 URL 或敏感基础设施信息。安全漏洞按 [SECURITY.md](SECURITY.md) 私下报告，不要提交公开 Issue。

## 许可证

除非具体路径另有声明，Linnya 自有源码与文档使用 [Apache License 2.0](LICENSE)。Copyright © 2024–present BCAutumn and Linnya contributors。

Linnkit、Linnkit AI SDK Provider Adapter 以及仓内维护的 Stream Markdown Parser 保留各自明确声明的 MIT 许可证。第三方组件和再分发资产可能还有 `THIRD_PARTY_NOTICES.txt` 中的附加声明；Linnya 名称和官方图标的使用边界见 [TRADEMARKS.md](TRADEMARKS.md)。
