# Agent Harness 模块说明

Layer: `package-neutral harness primitives`

`packages/linnkit/src/testkit/agent-harness/` 不再承接完整的 Linnya host 闭环。  
这里保留的是共享断言与 scripted AI harness primitive；依赖 Linnya 默认 tool/runtime/registry 的 harness 已外置到 `src/app-hosts/linnya/testkit/agent-harness/*`。

---

## 1. 模块定位

本模块负责：

- scripted AI harness
- 常用断言
- 为更高层 host-bound harness 提供共享 primitive

本模块不负责：

- 证明 kernel 已完全独立
- 替代具体业务模块自己的回归断言
- 重新引入大量模块级 patch 作为主路径

---

## 2. 核心职责

1. 提供稳定的 scripted AI turn 装配
2. 提供常用断言，减少 graph/flow/tool 集成测试重复样板
3. 作为 `src/app-hosts/linnya/testkit/*` 的底层 primitive

---

## 3. 关键边界 / 不变量

1. `scriptedInferenceHarness` 不得重新耦合 Linnya host 默认实现
2. graph loop / child-run / tool runtime host-bound harness 必须放在 `src/app-hosts/linnya/testkit/*`
3. 这里的断言函数保持 package-neutral，不导入 app-hosts

---

## 4. 详细目录树

```text
packages/linnkit/src/testkit/agent-harness/
├── README.md
├── scriptedInferenceHarness.ts
└── assertions.ts
```

---

## 5. 关键数据流

### 5.1 Scripted AI Harness

1. 构造 scripted turns
2. 提供 `llmCaller` 与 `CanonicalInferencePort` 注入
3. 供 runtime-kernel 或 app-host harness 复用

### 5.2 Assertions

1. 针对消息序列、tool output、最终结果提供稳定断言
2. 避免每个集成测试自行复制辅助逻辑

---

## 6. 推荐使用方式

### 6.1 只需要 scripted canonical inference

优先用：

- `createScriptedInferenceHarness(...)`

### 6.2 需要 graph loop / child-run / tool runtime 闭环

优先用：

- `src/app-hosts/linnya/testkit/agent-harness/*`

---

## 7. 开发注意事项

1. 如果测试依赖 Linnya 注册表、默认 tools、默认 event-store，就不要写在这里
2. scripted inference 只能通过 `CanonicalInferencePort` 注入，禁止 patch 模块级 Provider 单例
3. 优先复用 `assertions.ts`，不要在测试里复制消息断言

---

## 8. 测试与验证入口

参考回归：

- `packages/linnkit/src/runtime-kernel/graph-engine/__tests__/graph-loop.integration.test.ts`
- `packages/linnkit/src/runtime-kernel/graph-engine/__tests__/graph-loop.stepPolicy.test.ts`
- `src/tools/agent_control/subrun/shared/__tests__/subagentRunner.integration.test.ts`
- `src/tools/agent_control/subrun/subagent/__tests__/subagentTool.failure-recovery.integration.test.ts`
- `src/tools/deep_research/__tests__/researchSubagentWorkspace.integration.test.ts`

---

## 9. 相关文档

- `packages/linnkit/src/testkit/README.md`
- `src/app-hosts/linnya/testkit/README.md`
- `src/app-hosts/linnya/testkit/agent-harness/README.md`
- `packages/linnkit/src/runtime-kernel/graph-engine/README.md`
- `src/app-hosts/linnya/adapters/flow/README.md`
- `packages/linnkit/src/runtime-kernel/tools/README.md`
