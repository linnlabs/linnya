# Constraints & Pitfalls · 硬约束 + 不建议做的事 + FAQ

> **What** · linnkit 接入侧的硬约束 + 不建议做的事 + 常见踩坑 FAQ（含 AST 级 guard 规则、deep import 风险、浏览器 bundle 边界）。
> **When to read** · 上线前 review；遇到诡异 import 错误；review 别人的接入实现；接入 PR 自检。
> **Prerequisites** · 起码读完你用到的 §7.2 单点接入篇。
> **Key exports** · 无（本文是约束清单）。
> **Related** · [`glossary.md`](./glossary.md) · [`README §5`](./README.md)（browser rules） · [`realtime.md`](./realtime.md)

## 1. 硬约束（接入方必读）

linnkit 仓库内部的 package-boundary 由 **AST 级 guard**（基于 TypeScript Compiler API）强制 10 条规则。其中**直接影响外部消费者**的：

1. **只能从公开子入口 import**。`exports` 字段没声明的路径会被 Node 16+ ESM 解析直接拒绝。
2. **不要 deep import**。`@linnlabs/linnkit/runtime-kernel/some-internal-folder/foo` 不算公开 API；下个 minor 随时可能挪。
3. **不要依赖 internal-only 模块**：`shared/logger` / `shared/errorClassifier` / `shared/TokenCalculator` 等都是包内私有。
4. **不要把你自己的 provider/tool/adapter 反向塞回 linnkit**——linnkit 是你装的 npm 包，物理上塞不进去；逻辑上也不要试图通过 monkey patch 修改 linnkit 内部。
5. **`promptKey` 在 ports 层是 opaque string**——linnkit 不认识你的产品菜单，也不会替你解析。
6. **前端代码禁止 import `@linnlabs/linnkit/runtime-kernel`**（namespace 全展开入口，含 `node:async_hooks` / `crypto` 等 Node-only 子树）。前端只能从 `@linnlabs/linnkit/runtime-kernel/events` slim seam 取 events governance 纯函数。
7. **生产代码禁止 import `@linnlabs/linnkit/testkit`**。`testkit` 顶层 `import { vi, expect } from 'vitest'`，会把 vitest runtime 拖进生产 bundle。如果你确实在 monorepo 里有 mixed 代码，请用打包阶段的 lint 规则守门。

> 第 6 / 7 条来自早期打包事故：`@linnlabs/linnkit/testkit` 一旦从根入口被静态导入，esbuild/tsup 会把整棵 testkit 子树带进 backend production bundle，导致生产启动时加载测试运行时。公开版本用独立子入口和 package smoke 测试守住这条边界。

## 2. 当前不建议你做的事

不要这样接：

1. **直接把 linnkit 真源仓内的 host adapters 整个抄过来当模板**——那是产品决策内嵌的实现（默认 provider / 默认 task / 默认 schema），里面糊了具体产品的语义。可以参考它们的**形状**和**装配顺序**，但不要直接拷贝再硬改。
2. **把别人的 agent registry / context / flow 当作公开 API 引用**——它们没在 `package.json#exports` 里。
3. **试图通过自定义 build 钩子修改 `@linnlabs/linnkit` 内部行为**——所有定制点必须通过依赖注入。
4. **为了省事继续从外部 schemas 包拿本该属于 agent 的 A 类协议**——0.1.1 已经把 schemas 收回包内（`@linnlabs/linnkit/contracts`），不要再走老路径。

正确做法：

- 复用 `@linnlabs/linnkit` 的 7 个公开子入口
- 在你自己的 host layer 决定 provider、tool、persistence、flow 的真实实现
- 通过 fence registry 把产品上下文挂进框架，而不是改框架

## 3. FAQ

**Q：我装的是 `@linnlabs/linnkit`，但 npm/yarn 报 401 / 404？**

优先检查项目或用户级 `.npmrc` 是否还保留旧的 GitHub Packages scope override：

```bash
npm config get @linnlabs:registry
```

如果输出是 `https://npm.pkg.github.com/`，删掉这条配置，让 npm 使用默认的 `https://registry.npmjs.org/`。`@linnlabs/linnkit` 当前是 npmjs.com 公开包，不需要 GitHub token。

**Q：我能不能 fork linnkit、改它内部然后用我自己的 fork？**

技术上可以，但你要自己负担"和上游同步 + boundary guard 自维护"的成本。99% 你想做的事都能通过依赖注入在 host 层完成；如果你发现某个改动只能 fork 才能做，那大概率说明你应该来跟 linnkit 维护方提 issue / PR。

**Q：我的产品上下文是不是只能用 fence 表达？**

A 类（system / user 注入）走 fence 是最干净的路。B 类（per-tool 工具调用上下文）按 tool 自己的 schema/context/patch 表达，跟 fence 无关。C 类（运行时副作用、telemetry）走 telemetry port。三类互不替代。

**Q：`document_fragment` / `context_before` 这类产品字段能进入 framework 吗？**

**不能**。产品上下文必须由 Host 转成正式 fence；Linnkit 新请求、持久化和上下文构建不接受产品字段或旧消息 type。缺少迁移的数据应由接入方在启用当前合同前显式处理，framework 不提供运行时兼容。

**Q：我能跳过 host-bound testkit，只用 linnkit 自带的 testkit 写测试吗？**

能跑通 contract 测试是可以的。但一旦你的 host 装配里有任何"默认 LlmNode 行为 / 默认 tool registry 默认值"等产品决策，第一层 testkit 不会替你验证。所以建议第二层 testkit 至少薄薄一层包一下。

**Q：父子 agent 的 cost 为什么 `childrenTotal` 是 0？**

99% 是你的 telemetry adapter 没把 `scope.parentRunId` 透传到 sink。检查：

- `withLLMTelemetryContext` 内是否传了 `parentRunId`
- LLM caller / tool runtime 是否包在 `withLLMTelemetryContext` 内
- 你的 `RunCostCollector` 是否监听了 `scope.parentRunId` 而不是只看 `scope.runId`

**Q：为什么 child 在单测正常，切 workspace、重建 runtime 或并发 host 后却写错 Store？**

先检查生产 ToolContext 是否显式注入了 child invoker。child lifecycle、Audit、Telemetry 和 EventStore 如果分别通过 global getter 延迟获取，就可能来自不同批次的 runtime 装配。正确边界是 composition root 创建一套 scope 和一个 child invoker，再把该实例贯穿 root 与递归 child；缺少端口直接拒绝，不创建默认 Memory runtime。测试还必须使用两套 scope 并发验证，不能只在同一 singleton 内测试多个 run。

**Q：`@linnlabs/linnkit/runtime-kernel` 导入报 "Missing tiktoken_bg.wasm"？**

升级到 ≥ `0.1.3`。0.1.0~0.1.2 三个版本里 tiktoken wasm 被错误 inline 进 dist，已在 0.1.3 修复。

**Q：升级到 0.5.0 后我之前的 import 报错了？**

0.4.x → 0.5.0 主要变化：

- `linnkitCompat` 命名空间已删除（0.3.0 起）
- `AgentProfileRequest` 的 host 产品字段（`document_fragment` / `context_before` 等）已移除（0.4.0 起）
- `MessageFormatter` 不再特殊处理 `document_fragment` / `<additional_context>` / `[任务完成]` 包装
- `linnkit/context-manager` 主入口冻结 chat namespace（`chatContext` / `chatTasks` 等已不再暴露）

具体兼容性看仓根 `CHANGELOG.md` 的 0.5.0 entry。
