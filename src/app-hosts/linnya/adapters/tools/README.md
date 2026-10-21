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
- 从正式 EventStore 事实派生的同会话 Web 访问记录窄 port（不建立计数表/缓存）

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
├── createWebReadAccessHistory.ts  # completed web_read 身份与根因计数，按会话含 child
├── citation-source-resolution/    # 跨 owner 的 Citation 来源收集、接纳与窄 resolver
└── conversation-scope/            # Linnya ToolContext 的 conversation / research instance 分区投影
```

---

## 3. 真实数据流

1. `allToolClasses.ts` 按当前 plugin runtime enabled 状态读取可用工具
2. `toolRegistry.ts` 构建默认 registry
3. `defaultPorts.ts` 把 registry 投影成 runtime 可消费的 ports
4. `defaultToolManager.ts` 向上层暴露只依赖 registry 的默认 `ToolManager` 创建入口

独立 composition 可在 `ToolRegistryOptions.createTool(ToolClass, defaultTool)` 中为已注册类
装配依赖，未定制时直接返回 `defaultTool`。registry 先按原构造合同创建默认实例并记录工具名，
工厂返回值必须同名，不能增添或重命名注册能力。构造器不应执行 I/O；实际 Provider 调用仍在
工具执行中发生。返回实例继续经过正式 schema 接纳、目录/执行范围、decorator、幂等与结果回执。
未传工厂时行为不变；工厂失败与普通构造失败遵循同一初始化策略，需要完整目录的 composition
必须启用 `strictInitialization`，失败不会自动替换成默认工具。该接缝不提供进程、网络或文件隔离。

Host contribution 可用 `hostOnlyToolNames` 声明仅由 Host 接纳的工具。名称必须对应当前 enabled
registry 中的真实工具；未注册声明会使初始化失败，避免错误配置暴露工具。`getToolSchemas` 与
`getAvailableToolNames` 始终排除这些工具，显式 Agent 白名单也不能开放它们；
`getTool`、`getToolDefinition` 与 `executeTool` 保留正式 Host 执行路径。该字段属于 Host 装配合同，
不扩展 Linnkit `BaseTool` 或公共插件合同。目录隐藏不授予或撤销执行权限，例如研究工具仍须核对
匹配的持久化 Host 入口，不能只凭工具名启动研究。

Concrete tool 可以使用 Host 窄 Schema 上下文提供动态参数、描述和可选
`isAvailableForContext`。返回 `false` 时仅从本次模型目录省略该工具，不能撤销或替代执行校验。
具体工具按自己的 owner 合同决定是否采用该能力；通用 `subagent` 公开当前注册的子类型，
不另设父角色目录白名单或角色 caller 白名单。调用是否获准仍由下述正式 Agent 工具范围检查负责，
不能把模型目录当作权限边界。Schema 上下文只投影明确需要的冻结字段，不包含整份请求或 metadata。

Citation source resolution 位于 app-level adapter，因为它需要编排 Citation、正式 producer event 与
conversation EvidenceStore。Citation domain 只拥有来源 DTO 和接纳规则；插件只经
`@plugin/backend/citationSourceRuntime` 读取已接纳投影，不能穿透该目录。

Citation ref allocator decorator 也位于 app-level adapter：它只把当前 `conversationId` 和 Host 的 SQLite
claim store 组合成 Citation domain 的窄 port。候选生成、来源身份与碰撞规则留在 Citation domain；SQLite
adapter 只负责原子事务和双唯一约束；Knowledge/Web/Workspace producer 都不得依赖这两个 Host 实现。

`createWebReadAccessHistory` 只负责把 EventStore 的指定工具历史投影与 Web owner 的访问拦截分类组合为
`WebReadAccessHistoryPort`，由 ToolContext factory 绑定当前会话并被 child 继承。它按请求 hostname 和
`runId + toolCallId` 统计已完成调用，当前调用排除后由 Web owner 加入本次失败；不会把网络重试当新调用。
SQL 排序流式返回身份/参数/终态，聚合只保留一条调用，不读取网页正文，也不建立跨请求 Map。
旧未分类错误单列，暂停中的无终态调用不计；重载、删除和截断直接跟随正式事实。详见
[Web 同主机反馈](../../../../tools/web/README.md#511-同主机访问拦截反馈)。

`conversation-scope` 也位于 app-level adapter，因为 `research.instanceId` 是 Linnya 产品的
存储分区语义，不属于 Linnkit 通用 ToolExecutionContext。该 feature 不读写任何产物，
也不使用 `Artifact` 作为泛化命名。

工具声明 `idempotency` 时，registry 只能调用 Linnkit 的 `computeToolIdempotencyKey()` 与正式 history helper，不能在 Host 复制 key 算法或恢复旧 16-hex 合同。这里的 history 命中服务 Host 直接执行入口；Graph ToolNode 仍拥有进程内 in-flight 合并。两者都不提供跨进程强幂等，后者必须由持久化锁或唯一索引另行保证。

Agent 的模型工具 schema 不承担执行授权。根运行从冻结 request 的 `availableTools` 绑定
`ToolContext.registeredRootAllowedTools`，禁用工具时为空；registered child 则使用自己的
`registeredChildAllowedTools`，并清除根范围。registry 在 decorator、自身幂等缓存和 concrete
tool owner 前共用同一检查；拒绝分别返回 `REGISTERED_ROOT_TOOL_NOT_ALLOWED` 与既有
`REGISTERED_CHILD_TOOL_NOT_ALLOWED`。空数组禁止所有正式工具，`undefined` 不增加限制。
没有 Agent scope 的外部人工/API 调用继续遵循自己的接入合同，不会被冒充为根 Agent。

默认 `BaseTool` 的未知顶层字段反馈由正式 Linnkit 包提供：列出 schema 合法字段，仅对唯一的近似
拼写给提示，不自动改参。覆盖 `validateArguments` 的具体工具继续使用自己的 owner parser；
Host registry 只转交结果，不再复制一套通用字段匹配规则。深层 admission 先于 start，仍以
具体工具的正式合同为准。

Host 明确接纳的强制入口只授权原始 `{toolName, toolCallId}`，不把工具名加入模型名单。身份从
冻结执行选项和当前 run 的首条正式工具决定绑定；开始使用 bootstrap，继续/交互恢复使用原
checkpoint 的完整 history，不从新请求或模型 metadata 猜测。已产生结果的 call 不能被模型重用
为新的权限。该授权不向 child 传递。名单由 [registered child owner](../child-runs/README.md)
按每个 child 单独绑定，不能继承父角色的名单代替自己的能力。这仅约束正式工具调用，不是
Shell 的网络、数据库或文件系统沙箱。

`RUN_RECOVERY_BLOCKED` 与 `RUN_PAUSE_REQUESTED` 是运行控制信号，必须向 Graph 传播，不能转成
一条已完成的 tool error。未决调用恢复由应用层 run-resumption 协调：明确只读工具可重新读取；
child 工具只在原 child identity / checkpoint 合同下重新进入；外部写入没有 owner 凭据时阻塞。

---

## 4. 开发注意事项

1. 新的宿主默认工具装配继续放这里，不要回写 `src/tools/*`
2. 上层如果只需要工具摘要能力，应优先消费 `ToolManager.getSummaryProvider()`
3. 旧 `src/tools/defaultPorts.ts` bridge 已删除；真实 port 实现只在本 Host adapter
4. 如果一个变更是 concrete tool 本体，不应该落到这里
5. 执行开始日志只记录工具名和 run/call 关联身份，不打印参数值；命令、正文和凭据不能因调试日志绕过正式审计边界。

---

## 5. 相关文档

- [Linnkit Tool runtime](https://github.com/linnlabs/linnkit/blob/main/src/runtime-kernel/tools/README.md)
- [Linnkit 工具接入](https://github.com/linnlabs/linnkit/blob/main/docs/integration/tools.md)
- [Linnkit 工具开发规范](https://github.com/linnlabs/linnkit/blob/main/docs/integration/tool-development-guide.md)
- [Linnya Flow adapter](../flow/README.md)
- [Linnya concrete tools](../../../../tools/README.md)
- [Conversation 工具投影与渲染](../../../../../docs/conversation-platform/09-tools.md)
