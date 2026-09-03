# Linnya Backend Tools Adapter

Layer: `host-adapters/tools`

这里收口 Linnya 后端默认工具装配。  
如果要回答“当前产品默认有哪些工具、默认 tool runtime / preview 是怎么接上的”，应该看这里。自动上下文压缩不属于工具装配，也不在本目录注册摘要 Provider 或专用 Agent。

---

## 1. 模块定位

本目录负责：

- 默认 `ToolRegistry`
- 默认工具类惰性读取入口 `getAllToolClasses()`
- 默认 `ToolRuntimePort / ObservationPreviewPort`
- 默认 `ToolManager` 装配
- Citation sequence、Conversation ref allocator 与来源解析的 ToolContext 装饰
- 正式 producer history 与 Evidence fallback 的 app-level Citation source resolution
- Linnya `conversationId + research.instanceId` 到工具存储分区的窄 ToolContext 投影

本目录不负责：

- 定义 runtime-owned tool protocol
- 定义 `BaseTool` / `ToolExecutionContext`
- 承载 concrete tools 本体

---

## 2. 详细目录树

```text
src/app-hosts/linnya/adapters/tools/
├── README.md
├── allToolClasses.ts              # Linnya 默认工具类惰性读取兼容入口
├── toolRegistry.ts                # 默认 ToolRegistry 实现与装配
├── defaultPorts.ts                # 默认 ToolRuntime / Preview 装配
├── defaultToolManager.ts          # 默认 ToolManager 装配
├── citationSequenceToolContextDecorator.ts
├── citationRefAllocatorToolContextDecorator.ts
├── documentCitationWriteToolContextDecorator.ts
├── citation-source-resolution/    # 跨 owner 的 Citation 来源收集、接纳与窄 resolver
└── conversation-scope/            # Linnya ToolContext 的 conversation / research instance 分区投影
```

---

## 3. 真实数据流

1. `allToolClasses.ts` 按当前 plugin runtime enabled 状态读取可用工具
2. `toolRegistry.ts` 构建默认 registry
3. `defaultPorts.ts` 把 registry 投影成 runtime 可消费的 ports
4. `defaultToolManager.ts` 向上层暴露只依赖 registry 的默认 `ToolManager` 创建入口

Citation source resolution 位于 app-level adapter，因为它需要编排 Citation、正式 producer event 与
conversation EvidenceStore。Citation domain 只拥有来源 DTO 和接纳规则；插件只经
`@plugin/backend/citationSourceRuntime` 读取已接纳投影，不能穿透该目录。

Citation ref allocator decorator 也位于 app-level adapter：它只把当前 `conversationId` 和 Host 的 SQLite
claim store 组合成 Citation domain 的窄 port。候选生成、来源身份与碰撞规则留在 Citation domain；SQLite
adapter 只负责原子事务和双唯一约束；Knowledge/Web/Workspace producer 都不得依赖这两个 Host 实现。

`conversation-scope` 也位于 app-level adapter，因为 `research.instanceId` 是 Linnya 产品的
存储分区语义，不属于 Linnkit 通用 ToolExecutionContext。该 feature 不读写任何产物，
也不使用 `Artifact` 作为泛化命名。

工具声明 `idempotency` 时，registry 只能调用 Linnkit 的 `computeToolIdempotencyKey()` 与正式 history helper，不能在 Host 复制 key 算法或恢复旧 16-hex 合同。这里的 history 命中服务 Host 直接执行入口；Graph ToolNode 仍拥有进程内 in-flight 合并。两者都不提供跨进程强幂等，后者必须由持久化锁或唯一索引另行保证。

---

## 4. 开发注意事项

1. 新的宿主默认工具装配继续放这里，不要回写 `src/tools/*`
2. 上层如果只需要工具摘要能力，应优先消费 `ToolManager.getSummaryProvider()`
3. 旧 `src/tools/defaultPorts.ts` bridge 已删除；真实 port 实现只在本 Host adapter
4. 如果一个变更是 concrete tool 本体，不应该落到这里

---

## 5. 相关文档

- [Linnkit Tool runtime](https://github.com/linnlabs/linnkit/blob/main/src/runtime-kernel/tools/README.md)
- [Linnkit 工具接入](https://github.com/linnlabs/linnkit/blob/main/docs/integration/tools.md)
- [Linnkit 工具开发规范](https://github.com/linnlabs/linnkit/blob/main/docs/integration/tool-development-guide.md)
- [Linnya Flow adapter](../flow/README.md)
- [Linnya concrete tools](../../../../tools/README.md)
- [Conversation 工具投影与渲染](../../../../../docs/conversation-platform/09-tools.md)
