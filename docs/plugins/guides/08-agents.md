# 08 · Agent 与 Subagent

> 适用场景：插件贡献自己的 agent、subagent type、prompt。

## 贡献方式

- agent 通过 contribution 的 `agentDefinitions` 贡献；subagent type 通过 `subagentTypes` 贡献。
- agent prompt 文件随插件包维护，不放 host。

## 规则

- 插件不能修改默认 agent 的系统提示词；插件能力说明不应无条件进入全局 prompt。
- manifest 的 `agents` 字段只用于插件详情页展示，不是运行时 prompt 注入。
- agent / subagent 的 `promptKey` 在类型上是 `string`（host `PromptKey` 是 string 别名），插件**可自定义**，无需在 host 注册内置 key；运行期 prompt 由 agent 定义的 `task.systemPromptBuilder` 自包含，`promptKey` 仅作运行期路由键。
- **promptKey 必须带可识别命名空间前缀**（插件名或功能域，如 `diagram_editor`），并集中定义在插件 shared 的 `*PromptKeys` 常量里。Core schema 与 `@plugin/backend/agentRegistry` 不登记具体插件的 Agent ID 或 PromptKey；host registry 的 `getAgentDefinitions`（promptKey）与 `getSubagentTypes`（subagent type）只在聚合期做**全局唯一性校验**，撞键即 fail-fast。
- subagent type 默认不继承父会话历史。只有角色真实依赖最近父 turn 时，才在 `SubagentTypeContribution.inheritTurns` 声明固定非负数量；这属于注册方的上下文权限策略，不应变成模型可修改的工具参数。即使声明继承，父 Agent 的 `prompt` 仍应完整写明目标、约束和期望产物。
- agent 的 `availableTools` 引用插件工具时，从工具 class 派生名单（见 [07 工具](./07-tools.md) 的单一真源纪律）。
- 长任务 Agent 可以在 `config.maxSteps` 声明自己的 Graph 节点预算；这是 Agent definition 的产品策略，Host 的 root/registered child-run 装配统一消费。未声明时使用 Linnkit 框架默认值，插件不得在 Renderer 或 wire DTO 复制第二份默认值。
- `config.skill.enabled=true` 时，`availableTools` 必须包含 `skill`，否则启动期配置校验会失败。声明 `config.skill.requiredSkills` 时也必须开启 `config.skill.enabled`，不能只写资源名却不给模型 skill 入口。
- **prompt 引用 skill 必须可校验**：prompt 里点名的 skill（如「先学习某技能」）必须是插件自己随包分发的 skill，并在 agent 定义里声明 `config.skill.requiredSkills`。平台同步 enabled 插件 runtime resources 时会对照该插件的 `resources/skills/<name>/SKILL.md` / `skillResourceRoots` 校验；缺失或 frontmatter 不合法会 fail-fast。

## Agent Fence 上下文

插件可以通过 contribution 的 `agentFences` 注册自己的上下文围栏。Linnya host 只要求声明语义分类，不强制统一 XML 外层标签。

```ts
agentFences: [{
  kind: 'selected-slides-element',
  category: 'selection',
  llmRole: 'user',
  placement: 'before-current-user',
  lifetime: 'turn-only',
  mustKeep: true,
  formatter: wrapSelectedElement,
}]
```

`category` 可选值：

- `current-view`：用户当前看到的视图状态，例如当前页、当前画布焦点、当前图谱筛选。
- `selection`：用户明确选中的对象，例如文本引用、幻灯片元素、节点、边、表格区域。
- `system-capability`：当前 agent 可用能力目录。
- `legacy`：迁移期兼容上下文，不建议新增。

规范：

- current-view / selection fence 默认应使用 `lifetime: 'turn-only'`，由插件每轮重新提供最新视图或选区。
- selection 如果是编辑授权来源，应设置 `mustKeep: true`，并控制 `maxBudgetFraction`，避免关键定位信息被裁剪。
- 插件继续使用自己的 formatter，例如 `<slides_context>`、`<selected_slides_element>`；不要为了统一而再包一层 `<current_view_context>` 或 `<selection_context>`。
- 每个 fence 的文档必须说明字段语义、是否可作为编辑授权来源、历史中哪些字段可能过期、关联工具如何使用它。
- 不要把业务上下文塞进泛化 `injected_context` / `additional-context`；新增上下文必须注册明确的 fence kind。

## 启停语义

- 禁用/卸载插件后：agent 定义从 registry 收缩、subagent type 不可委派、相关 skill 从 catalog 收缩，模型可见能力立即收缩（启停会清 agent task cache）。
- 真实运行期解析必须走 `getRegisteredAgentDefinitions()` / `AgentDefinitionResolver`，由平台读取 SQLite enabled 状态。
- 静态目录、配置校验和测试夹具若必须读取“所有已注册插件能贡献什么”，使用 `getAllRegisteredAgentDefinitionsForStaticCatalog()` 或 `ALL_AGENT_DEFINITIONS_FOR_TESTS`。这两个名字刻意带有 static/test 语义，**不反映真实运行态**，生产代码不得依赖测试快照（审计 T-12）。
