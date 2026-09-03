# Linnya Context Policies

`src/app-hosts/linnya/context-policies/*` 承接 Linnya 专属的上下文策略默认值。

当前 owner：

- `defaultContextPolicy.ts`
- `defaultAgentProviderRegistry.ts`

这层负责：

- Linnya 默认 context policy
- 把 must-keep 策略交给核心上下文 Provider
- 注册 `AgentCoreContextProvider` 与 `AgentWorkingMemoryProvider`

这层不负责：

- context pipeline core
- provider / preprocessor 协议
- context compaction 的候选选择、模型调用或事件提交
- 任何 Context build 内部 LLM 调用

中文备注：

- Context build 是纯数据构建：不调模型、不发布事件、不返回内部 LLM usage 旁路。
- 自动 context compaction 由 Graph 的独立 pipeline stage 使用当前模型执行；这里不再注册摘要 Provider、checkpoint Provider 或专用摘要 Agent。
- 编辑器 block、项目/文档元数据、用户引用、补全 intent 和行为统计只属于 Linnya `AgentInvokeRequest`，不得塞进通用 context policy。

一句话：

- 通用 context core 在 `packages/linnkit/src/context-manager/*`
- Linnya 默认策略在 `src/app-hosts/linnya/context-policies/*`
