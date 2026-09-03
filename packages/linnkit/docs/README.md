# linnkit Docs

`linnkit` 是一个通用 Agent 框架。它提供 runtime、context engineering、ports、testkit 和 quickstart；具体 LLM provider、工具集、存储、实时通道、权限、业务上下文都由 host 自己装配。

这份目录只保留公开接入者需要长期阅读的内容。内部路线图、研究笔记和历史 runbook 不属于公开文档面。

## 推荐阅读顺序

1. [包根 README](../README.md)
   先看 linnkit 的定位、能力边界和 quickstart。
2. [Integration Guide](./integration/README.md)
   按主题接入 LLM、工具、上下文、持久化、RunSupervisor、AuditPort、Telemetry 和测试。
3. [Changelog](../CHANGELOG.md)
   查看公开版本变化和兼容性说明。

## 公开 API

`package.json#exports` 锁定当前公开入口。任何没有出现在 exports 里的 deep import 都不稳定。

| 子入口 | 用途 | 环境 |
|---|---|---|
| `@linnlabs/linnkit` | 根入口，常用 namespace 与 helper | Node-only |
| `@linnlabs/linnkit/ports` | host 需要实现的接口 | Node-only |
| `@linnlabs/linnkit/contracts` | 消息、事件、SSE 等稳定 Zod 合同；前后端共享 wire 定义 | Browser-safe |
| `@linnlabs/linnkit/runtime-kernel` | graph、tool、run、llm 等 runtime 能力 | Node-only |
| `@linnlabs/linnkit/runtime-kernel/events` | 浏览器安全的事件治理函数 | Browser-safe |
| `@linnlabs/linnkit/context-manager` | context pipeline、fence、profile 能力 | Node-only |
| `@linnlabs/linnkit/testkit` | 测试夹具与协议不变量 | Test-only |
| `@linnlabs/linnkit/quickstart` | `defineAgent` / `runAgent` / `defineConfig` demo helper | Node-only |

## 分层边界

| 层 | linnkit 负责 | host 负责 |
|---|---|---|
| runtime-kernel | graph loop、tool runtime、run lifecycle、事件治理 | 默认工具、SSE/WebSocket/IPC、业务执行策略 |
| context-manager | 上下文窗口构建、预算裁剪、fence、自动压缩计划与重建、trace | 业务上下文注入、must-keep 策略、provider registry 配置 |
| ports | 稳定接入接口 | 具体 LLM、存储、tokenizer、telemetry、audit 实现 |
| testkit | 通用 fixture、harness、不变量校验 | host-bound harness 与生产装配回归 |

## 关键约束

1. 生产代码不要 import `@linnlabs/linnkit/testkit`。
2. 浏览器代码不要 import `@linnlabs/linnkit/runtime-kernel`，只用 `@linnlabs/linnkit/runtime-kernel/events` 或按需使用 contracts。
3. 不要 deep import。公开入口以 `package.json#exports` 为准。
4. 不要把 provider/tool/adapter 写回 linnkit。它们应该留在 host 仓库，通过 ports 和 registry 接入。
5. 业务上下文走 fence 机制注册，linnkit 不硬编码任何产品词汇。

## 文档地图

### 起步

- [installation](./integration/01-installation.md)
- [quickstart](./integration/02-quickstart.md)
- [constraints and pitfalls](./integration/constraints-and-pitfalls.md)
- [glossary](./integration/glossary.md)

### 接入主题

- [LLM provider](./integration/llm-provider.md)
- [tools](./integration/tools.md)
- [tool development guide](./integration/tool-development-guide.md)
- [host-originated tools](./integration/host-originated-tools.md)
- [agent registration](./integration/agent-registration-guide.md)
- [context engineering](./integration/context-engineering.md)
- [context fences](./integration/context-fences.md)
- [tool history](./integration/tool-history.md)
- [persistence](./integration/persistence.md)
- [run supervisor](./integration/run-supervisor.md)
- [child runs](./integration/child-runs.md)
- [audit](./integration/audit.md)
- [telemetry](./integration/telemetry.md)
- [realtime](./integration/realtime.md)
- [testing](./integration/testing.md)

## 维护说明

公开接入文档只写长期稳定的接入事实。一次性升级计划、内部取舍和调研笔记不放进 npm tarball；公开版本变化统一写到仓根 `CHANGELOG.md`。发布 runbook 只维护在 `docs/release/RELEASE.md`，不在接入文档里重复。
