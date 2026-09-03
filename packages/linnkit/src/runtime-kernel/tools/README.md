# Runtime Kernel Tools Protocol

Layer: `runtime-kernel/tools`

这里承接工具系统中可复用的 runtime 协议与 helper。  
如果要回答“graph 执行工具时最小需要哪些合同”，应该看这里。

---

## 1. 模块定位

本目录负责：

- `BaseTool` 这类纯工具合同
- `ToolExecutionContext` / `ToolSchemaBuildRequest`
- `ToolContextPatch`
- history capability
- 参数规范化与幂等 key

本目录不负责：

- 默认 ToolRegistry 装配
- `allToolClasses`
- `tool_output` host 存储
- host concrete tools
- 自动上下文压缩；该能力由 Context Manager 产出计划、Graph tick pipeline 执行

---

## 2. 关键边界 / 不变量

1. `ToolContext` 不整体搬进 runtime-kernel，只继续拆 runtime-owned 小接口
2. runtime consumer 优先吃小接口，不再直接依赖完整 `ToolContext`
3. host 默认 ports 和 default ToolManager 不属于这里
4. concrete tools 不属于这里
5. idempotency key 使用 32 hex 的 sha256 前缀；`conversation` scope 必须有 `conversationId`，`turn` scope 必须有 `turnId`，缺字段是注入契约错误，不做静默降级
6. ToolNode 只提供进程内 in-flight 合并与 working history 成功输出复用；跨进程强幂等需要宿主的持久化锁或唯一索引契约配合
7. 历史 16 hex key 不参与前缀兼容或双读；升级后旧 key 会按 cache miss 处理，避免把已废止的 64bit 合同继续带入主链
8. `ToolRuntimeDefinition.validateArguments` 是工具 owner 的深层参数 admission；ToolNode 必须在发布 `tool_process(start)` 前调用，失败只产生配对 `tool_output(error)`
9. 工具模型输入默认是 `required`；只有工具 owner 显式声明 `modelInputDelivery='when_supported'` 时，附件才是可选增强，模型不兼容不能反向把主操作改判失败
10. 请求级动态 Schema 通过 `ToolSchemaBuildRequest` 把通用 invocation 转交给 Host；runtime-kernel 不投影、不命名 Host 产品字段
11. 模块内部依赖同域类型时直接引用定义叶子；`tools/index.ts` 与 feature `index.ts` 只服务公开出口，禁止内部实现反向经过 barrel 形成循环依赖

---

## 3. 详细目录树

```text
packages/linnkit/src/runtime-kernel/tools/
├── README.md
├── toolContracts.ts              # BaseTool / ToolParameterSchema / ToolResult 合同
├── toolExecutionContext.ts       # 最小执行上下文
├── ports.ts                      # Schema 构建、定义查询与执行端口
├── toolContextPatch.ts           # host/product 增量 patch 合同
├── toolContextRuntime.ts         # working/persisted history capability helper
├── conversationView.ts           # history 视图合同
├── argNormalizer.ts              # 参数规范化
├── ui-types.ts                   # tool ui / structured result 协议
└── idempotency/
    └── toolIdempotency.ts
```

---

## 4. 真实数据流

1. graph-engine 通过 `ToolExecutionContext` 与 ports 使用工具
2. schema generation 通过 `ToolSchemaBuildRequest` 把本次通用 invocation 交给 Host 的 `ToolCatalogPort`
3. runtime 通过 `toolContextRuntime.ts` 读取 working / persisted history
4. host 或 product 在外层通过 `ToolContextPatch` 注入增量信息

### 4.1 参数 admission 与执行开始边界

`parameters` 负责向模型公开 JSON Schema，`validateArguments` 负责执行前的 owner 深层合同。两者都由同一个 concrete tool 提供，避免“模型看到的 schema”和“执行时 schema”分叉。字符串长度等 JSON Schema 约束（如 `minLength`）也必须与 owner parser 同源。判别对象使用递归 `oneOf` 表达，每个分支应封闭自己的 `properties`；不能把跨分支限制降级成 description 提示。

Runtime-kernel 只拥有接口与调用时序，不拥有 host 的字段身份、互斥分支、parser 和错误码。产品 schema builder
不能放进这里；通用 admission helper 只有在 parser-neutral 的输入/错误合同已经跨 host 稳定后才值得成为公开 API。

### 4.2 流式生命周期 policy

工具可以在 runtime definition 上声明通用 `streaming` policy：`emitPlaceholder` 表示需要在调用身份刚形成时发布占位，`emitArgumentSnapshots` 表示工具有明确的生命周期参数合同，可以消费尚未完成 owner admission 的参数快照。未声明时，Linnkit 不发布早期占位或参数快照。Linnkit 只处理 policy，不识别工具名、插件名、组件或产品领域；policy 通过 invocation context 传递，不能进入 provider 请求 options。生命周期数据不等于 owner admission 成功，执行前仍必须经过 `validateArguments`。

ToolNode 的顺序固定为：解析/规范化参数 → owner admission → 模型输入能力 admission → `tool.allow` 审计 → `tool_process(start)` → executeTool。任何 admission 失败都必须走 `tool_output(error)`，不能先发 loading 再由 Renderer 猜测失败。

Host 可以为具体工具失败填写 `ToolExecutionResult.errorCode`；runtime 会将它原样带入
`tool_output.error_code`。该字段只表达稳定分类，不替代给模型看的 `error/observation`，Linnkit
也不维护任何产品错误码表。

模型输入 delivery 是通用执行合同，不是工具名特判：`required` 工具在不兼容模型上不可执行；
`when_supported` 工具保持可见，ToolNode 把真实 active model 的准入事实写入执行期
`modelInputAdmission`。工具只有在 `admitted=true` 时才生产 selection；不兼容只省略增强附件，
scope、完整性、resolver 或 Provider 等真实失败仍然失败。

这里的准入按 requirement 中的实际 placement 独立计算。模型声明 `image_input` 且 route 只支持
`user_image` 时，用户附件可以进入模型，但 `tool_result_image` requirement 仍是不兼容；Runtime 不做角色转换。

---

## 5. 开发注意事项

1. 如果一个类型只是给 runtime consumer 用，优先放这里
2. 如果一个能力需要默认 registry 或 preview 存储，它大概率不该放这里
3. 改 `ToolExecutionContext` / `ToolSchemaBuildRequest` 时，要想到 graph-engine、quickstart 和 testkit 都会受影响
4. 不要重新把完整 `ToolContext` 当成“任意 patch 袋子”
5. Host 从 invocation 验证自己的结构扩展并派生窄工具上下文；不得把完整请求交给所有工具，也不得要求 Linnkit 建立产品 Map 或用途枚举

---

## 6. 相关文档

- [Graph Engine](../graph-engine/README.md)
- [Linnkit 工具接入](../../../docs/integration/tools.md)
- [Linnkit 工具开发规范](../../../docs/integration/tool-development-guide.md)
