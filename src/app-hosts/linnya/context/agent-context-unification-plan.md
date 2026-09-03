# Agent 上下文统一与清理改造计划

> 状态：第一阶段已实施  
> 范围：仅讨论 Linnya `mode=agent` 的上下文结构；`mode=chat` 后续可能移除，暂不纳入本轮改造。

## 背景

`linnkit` 已经提供 fence 机制，用来把 host 注入的业务上下文按 role、位置、生命周期和预算规则组装到最终 LLM messages。

本次改造理论上只应发生在 Linnya host 侧。`linnkit` 已经提供通用 fence、preprocessor、must-keep、formatter 和 context pipeline 能力；当前问题主要是 Linnya 对不同业务上下文的归类、生命周期和注入入口没有用清楚。

当前 Linnya agent 模式已经部分使用 fence：

- `project-context`
- `document-context`
- `user-quote`
- 插件注册的 `selected-slides-element`
- 插件注册的 `selected-supplychain-node` / `selected-supplychain-edge`

改造前存在几类上下文归属不清：

- `current_time` 仍作为 prompt 变量写进 system prompt。
- `injected_context` 被映射成 `additional-context`，而 `additional-context` 当前是 `system / persisted / mustKeep`。
- skill 暴露同时存在 `<skills>` 使用说明和 `<available_skills>` 目录，两者语义重复。
- 文本引用、PPT 元素、供应链节点/边等“用户选中对象”还没有统一的上层抽象。
- 插件当前视图上下文应该开放注册，但需要和用户选区区分。

本计划目标是让上下文结构可读、可解释、可维护，并让每类上下文都有明确生命周期。

## 目标消息结构

最终希望 agent 模式上下文在概念上接近以下结构：

```text
role = system
<system_prompt>
  Agent 的长期行为规则、任务边界、输出规则。
</system_prompt>

<available_skills>
  <skill name="ai-tiled-upscale">Upscale raster images with tiled AI redraw workflow.</skill>
</available_skills>

[tools]
  工具不是 message 文本块，而是 provider call options 中的 native tool schema。
```

```text
role = assistant
历史 final_answer / thought / tool_calls。
```

```text
role = tool
历史 tool_output，必须和 assistant tool_calls 成对。
```

```text
role = user
<project_context>
  当前项目的人类可读信息。
</project_context>

<document_context>
  用户当前看到的页面、文档、画布、幻灯片或插件视图状态。
</document_context>

<user_quote>
  用户当前选中的文本、块、元素、节点、边、区域等对象。
</user_quote>

<local_time>
  当前本地时间，精确到秒。
</local_time>

<user_request>
  用户本轮真实请求。
</user_request>
```

## 分类原则

### system 只放长期不变量

`system` 应只包含：

- agent 身份、任务边界、长期行为规则
- 输出格式规则
- 稳定能力目录，例如极简 `<available_skills>`

不应包含：

- 当前时间
- 当前文件片段
- 用户引用
- 当前页面状态
- 临时插件视图状态

### user 放当前轮可变上下文

`user` 应包含本轮运行时事实：

- 当前项目
- 当前文件或当前视图
- 用户选中内容
- 本地时间
- 用户本轮请求

不能简单用“是否会变化”判断生命周期。`turn-only` 的真实含义是：**这段上下文只代表当前轮的最新环境快照，下一轮应该由 host 重新注入最新值，而不是从历史里回放旧值。**

保留历史记录的意义是让 agent 理解“当时用户是在什么条件下说这句话、做这个决定、等待了多久”。因此有些会变化的事实反而应该作为历史事实保留，例如每轮请求发生时的本地时间。

需要区分两类东西：

- 最新状态：下一轮必须以最新值为准，旧值回放会误导模型。
- 历史事实：它描述过去那一轮真实发生过什么，保留后能帮助模型理解对话过程。

建议分类如下：

| 上下文 | 推荐生命周期 | 原因 |
|---|---|---|
| 当前项目名/描述 | `turn-only` 最新快照 | 项目可能被切换或改名；下一轮必须以 host 注入的最新项目为准，不应该从历史里混入旧项目。 |
| 当前文件身份 | `turn-only` 最新快照 | 用户可能切换文件；历史旧文件身份不应继续影响当前轮。若需要理解过去讨论的是哪个文件，应在历史用户消息中保留可读摘要或引用。 |
| 当前视图上下文 `current-view-context` | `turn-only` 最新快照 | 当前页、光标附近内容、画布状态、插件视图都容易过期；下一轮应重新注入。 |
| 项目级长期规则 | `turn-only` 最新快照或 system-side 当前规则 | 这类规则一旦变更，agent 必须看到最新版本；不应把旧规则作为 persisted fence 回放。是否放 system 取决于它是不是明确的长期行为约束。 |
| 本轮请求时间 / 本地时间 | user-side 历史事实，精确到秒 | 时间虽然变化，但每轮时间能帮助 agent 判断时间间隔、上下文先后和“刚才/今天/之前”的含义。既然放在 role=user 并作为历史事实保留，就不需要再为了 system prompt cache 收敛到“天”。 |
| 用户显式文本引用 | 应作为历史事实保留，当前轮可 mustKeep | 引用是用户请求的一部分，后续讨论可能会指代“刚才引用的这段”。但大块原文是否完整保留，需要预算策略控制。 |
| 结构化选中对象 | 当前轮 mustKeep，历史保留摘要或稳定引用 | 选中元素是本轮编辑授权来源，当前轮不能被裁；但 DOM/source slice 可能过期，历史里更适合保留稳定 id、摘要和用户意图，而不是过期源码。 |
| `available_skills` | system-side 当前能力目录，不进入历史回放 | 它不是用户历史事实，也不是 UI 快照；由 agent 配置、插件启用状态和可用 skill 决定，应每轮按当前能力重新生成，不走泛化 `additional-context`。 |

第一阶段应先为每类上下文定义“最新状态”和“历史事实”的边界。不能因为一个值会变化就删历史，也不能因为它重要就 persisted 回放旧值。

### 不设置泛化垃圾桶

不保留 `other_turn_context` 这类兜底分类。

新增上下文必须先判断属于：

- project
- current view
- selection
- local time
- skill catalog
- stable system rule

如果无法归类，应先讨论业务边界，而不是放进通用容器。

## 当前上下文现状与问题

### current_time

现状：

- `current_time` 由 `getCurrentTimeForPromptByDay()` 生成。
- 目前被多个 agent prompt 以 `Current Time: {current_time}` 写入 system prompt。

问题：

- 当前时间是高频可变上下文，不是 agent 长期行为规则。
- 即使已经收敛到“天”，仍会让 system prompt 随日期变化。

目标：

- 移除 agent system prompt 中的 `current_time` 模板变量。
- 在 Linnya flow 物化 `user_input` 时写入 model-facing `content`。
- `raw_content` 保留原始用户文本，供 UI 气泡、标题、preview 和搜索预览使用。
- 时间内容精确到秒。
- 输出形态为：

```text
<local_time>2026-06-18 14:35:27</local_time>

<user_request>
用户本轮真实请求
</user_request>
```

实现说明：

- 本轮 `request.query` 与 `RuntimeEvent.user_input.content` 使用同一个 model-facing 内容，避免当前轮历史匹配失败后重复生成第二条 user message。
- `CurrentTurnMessageAssembler` 对已存在 `<user_request>...</user_request>` 的 user_input 做幂等处理，避免 selection/current-view fence 组装时出现嵌套 `<user_request>`。
- 前端可渲染消息、会话标题和 preview 优先读取 `raw_content`，不会把 `<local_time>` 显示进用户气泡。

### project-context

现状：

- `project_metadata.name` / `project_metadata.description` 被转换为 `project-context`。
- 当前是 `role=user / before-current-user / turn-only`。

讨论结论：

- 当前项目名、描述属于当前运行环境，应默认保留在 user-side。
- 如果未来出现“项目级长期规则”，应单独建 system-side 稳定上下文，不和项目元信息混在一起。

目标：

- 保持 `project-context` 在 user-side。
- 后续可统一输出为 `<project_context>`。

### document-context / current-view-context

现状：

- `context_before`
- `context_after`
- `document_title`
- `document_fragment`

会被归并进 `document-context`。

问题：

- `document-context` 当前同时承担“文件身份”“当前编辑器上下文”“用户当前视图”的职责。
- 插件视图，如 slides 当前页、mindmap 当前节点周边、supplychain 当前图谱状态，未来也需要同类能力。

目标：

- 抽象为 `current-view-context`。
- 不强制统一外层 `<current_view_context>` 标签。
- host 内置 editor/document 继续输出 `<document_context>`。
- 插件继续注册自己的 fence kind 和 formatter，例如 `<slides_context>`、`<mindmap_context>`、`<supplychain_context>`。
- 插件可以选择把当前可见状态暴露给 agent，但必须在插件自己的 agent 开发文档中说明标签语义、字段含义、生命周期和适用工具。

概念上这些都属于“当前视图上下文”，但物理标签由各 host/plugin 自己声明：

```text
<document_context>...</document_context>
<slides_context>...</slides_context>
<mindmap_context>...</mindmap_context>
```

理由：

- `linnkit` fence 机制本来就允许 host/plugin 自定义 kind 和 formatter。
- 不同文件类型的“当前视图”字段差异很大，统一外层标签带来的收益有限。
- 关键不是统一标签名，而是每个插件严格维护自己的上下文契约。

### selection-context

现状：

- 文本引用走 `user-quote`。
- Slides 选中元素走 `selected-slides-element`。
- 其他插件的选中对象走各自 contribution 声明的私有 kind。

问题：

- 这些都属于“用户当前选中对象”，但当前缺少统一抽象。
- `user_quote` 更适合文本引用，不适合结构化对象。
- `selected_xxx` 能表达插件类型，但 agent prompt 不应该理解所有插件私有标签。

目标：

- 概念上承认它们都属于“用户当前选中对象”。
- 第一阶段不强制引入统一 `<selection_context>` 外层标签。
- 各插件继续注册自己的 selection fence，例如 `selected-slides-element`、`selected-supplychain-node`。
- 每个插件必须把引用规范写清楚：选中对象代表什么、是否可作为编辑授权来源、历史中应保留源码还是稳定 id/摘要。

可选的统一形态暂不作为第一阶段目标：

```text
<selection_context>
  <user_quote source_doc="doc_1" block_id="abc123">
  用户选中的文本
  </user_quote>

  <selected_element type="slides.element" document_id="deck_1">
  插件提供的结构化元素源码或定位信息
  </selected_element>
</selection_context>
```

理由：

- 抽象统一对当前实现收益不高，反而可能把插件差异压扁。
- 文件类型不同，选中对象的语义差异很大：文本引用、PPT 元素、图节点、供应链边、表格区域都不一样。
- 只要 fence kind、formatter、attrs 和工具使用规则足够清楚，模型不需要依赖统一外层标签。

后续只有在出现跨插件通用 selection 工具、统一审计或统一预算策略时，再考虑增加 descriptor metadata，例如 `category: 'selection'`。

第一阶段已增加 `category` 字段：

```ts
type BackendPluginAgentFenceCategory =
  | 'current-view'
  | 'selection'
  | 'system-capability'
  | 'legacy';
```

该字段属于 Linnya/plugin SDK 契约层，不要求 linnkit `FenceDescriptor` 理解它。注册给 linnkit 时保持结构兼容，formatter、lifetime、mustKeep 行为不变。

### available_skills

改造前：

- `config.skill.enabled=true` 时，`appendSkillPromptSection()` 会向 system prompt 追加 `<skills>` 使用说明。
- `SkillCatalogEnricher` 会构建 `<available_skills>`，注入 `request.injected_context`。
- `injected_context` 又被转换成 `additional-context`。

问题：

- `<skills>` 和 `<available_skills>` 都在告诉模型如何使用 skill，语义重复。
- `<available_skills>` 当前经 `additional-context` 进入 system/persisted/mustKeep，不够明确。

讨论结论：

- 保留一个极简 `<available_skills>` 即可。
- 每个 skill 只暴露 `name + description`。
- 不再额外追加 `<skills>` 使用说明，除非工具 schema 无法表达最小调用方式。

目标形态：

```text
<available_skills>
<skill name="ai-tiled-upscale">Upscale raster images with tiled AI redraw workflow.</skill>
</available_skills>
```

目标归属：

- 放在 `role=system`，作为当前 agent 能力目录。
- 每轮按当前 agent 配置、插件启用状态和 skill 可用性重新生成。
- 不作为 user-side 当前上下文。
- 不作为历史事实回放。

第一阶段实施结果：

- 已删除额外 `<skills>` 使用说明，只保留极简 `<available_skills>`。
- 当前采用 `GenericAgentTask` 的 system prompt builder 阶段拼入 capability catalog。
- 不再通过 `additional-context` 承载 skill catalog。
- 已删除 `SkillCatalogEnricher` 和内置注册入口，避免旧路径继续写入 `injected_context`。

### additional-context / injected_context

现状：

- `injected_context` 被转换为 `additional-context`。
- `additional-context` 是 `role=system / placement=after-system / lifetime=persisted / mustKeep=true`。
- skill catalog 已迁出该链路，当前没有已知生产路径继续通过它注入 `<available_skills>`。
- 测试和历史文档中仍保留 `additional-context` 作为“补充上下文”的迁移期样例。

问题：

- `injected_context` 来源过宽，既可能是 skill catalog，也可能是业务 enricher 注入的临时上下文。
- 默认 persisted/mustKeep 风险较高，容易把短期上下文变成长期 system 内容。

保留理由：

- 作为迁移期兼容入口，能承接还未拆分语义的老 enricher。
- 如果未来确实存在“稳定 system 补充上下文”，`additional-context` 可以短期复用。
- 当前 context policy 已有 `additional-context` 的 mustKeep/truncation 配置，直接删除会牵动测试和兼容面。

废弃理由：

- 名字过宽，容易变成新的上下文垃圾桶。
- 原主要真实用途是 skill catalog，而 skill catalog 已改成 `role=system` 的明确能力目录。
- persisted/mustKeep 默认过强，不适合承载来源不明的短期上下文。

建议：

- 第一阶段保留 `additional-context` 作为 deprecated 兼容入口。
- 禁止新增业务继续写入 `injected_context -> additional-context`。
- 已把 skill catalog 迁出 `additional-context`。
- 新上下文必须按真实语义拆成明确 fence：
  - `skill-catalog`
  - `stable-system-context`
  - `current-view-context`
  - 其他业务明确类型
- 第二阶段统计无生产调用后，再删除 `injected_context` 和 `additional-context`。

### project rules / project instructions

现状：

- 当前通用项目注入只有 `project_metadata.name` / `project_metadata.description`，会转成 `project-context`。
- 没看到通用的“项目级长期规则 / project instructions”注入链路。
- Review agent 有专属字段 `agent_system_prompt`、`agent_knowledge`、`review_background`，属于 review agent 私有上下文，不代表通用项目规则。

含义：

- 目前所谓项目上下文只是项目人类可读元信息，不是项目级长期规则。
- 暂时不需要新增 `project-instructions`。

后续触发条件：

- 如果产品层出现“用户可保存的项目级规则/偏好/交付规范”，再新增明确的 system-side fence，例如 `project-instructions`。
- 该 fence 必须每轮读取最新版本，不应 persisted 回放旧规则。
- 它应和 `project-context` 分开：前者是规则，后者是项目元信息。

### review-context

`review-context` 是 review agent 专属上下文，本轮不纳入统一改造讨论。

### system-reminder

`system-reminder` 当前由 runtime 在最后一条 LLM message 末尾追加，运行稳定，并且已有 agent/plugin 自定义入口。本轮不纳入统一改造讨论。

## 插件开放方向

插件需要两类上下文扩展点。这里的“当前视图上下文”和“用户选中对象”是概念分类，不要求物理 XML 外层标签统一。

### 当前视图上下文

插件可选择暴露当前用户正在看的视图。

示例：

- Slides：当前页、总页数、当前 deck 状态、可见 warnings。
- MindMap：当前节点、附近节点、当前画布焦点。
- 第三方图谱插件：当前实体、当前图谱范围、当前筛选条件。

概念上归类为 current view，但物理标签由插件自己声明：

```text
<slides_context>...</slides_context>
<mindmap_context>...</mindmap_context>
<plugin_context>...</plugin_context>
```

### 用户选中对象

插件可暴露用户明确选中的对象。

示例：

- Slides element
- MindMap node
- 第三方插件 entity / relation

概念上归类为 selection，但物理标签由插件自己声明：

```text
<selected_slides_element>...</selected_slides_element>
<selected_plugin_entity>...</selected_plugin_entity>
```

## 建议迁移步骤

### 第 1 步：冻结目标结构

先确认 agent 模式目标上下文结构：

- system：长期规则 + 极简 skill catalog
- user：project + current view + selection + local time + user request

### 第 2 步：新增明确 fence kind

第一阶段实际调整：

- `local_time` 不新增 fence，直接作为持久化 user_input.content 的历史事实。
- `available_skills` 不新增 fence，在 skill-enabled agent 的 system prompt builder 阶段拼入。
- 插件 current view fence：由插件按文件类型自行命名和注册，不新增统一 `current-view-context`。
- 插件 selection fence：由插件按选中对象类型自行命名和注册，不新增统一 `selection-context`。
- 插件 fence descriptor 新增 `category`，用于声明 `current-view` / `selection` / `system-capability` / `legacy`。

是否保留旧 kind 作为兼容层，需要结合现有测试和插件调用面评估。

### 第 3 步：迁移 current_time

- 从 agent prompt variables 中移除 `current_time`。
- 在 `user_input.content` 中写入 `<local_time>` 和 `<user_request>`。
- 在 `raw_content` 中保留用户原文。
- 更新相关 agent prompt 测试。

### 第 4 步：合并 skill 暴露

- 移除 `appendSkillPromptSection()` 对 `<skills>` 的 system prompt 追加。
- 将 `buildSkillCatalogXml()` 改为生成极简 `<available_skills>`。
- `GenericAgentTask` 对 skill-enabled agent 在 system prompt 中追加该 catalog。
- 不再通过 `additional-context` 承载 skill catalog。
- 删除 `SkillCatalogEnricher` 空实现和内置注册入口，减少迁移期死路径。

### 第 5 步：规范 selection fence

- 不强制引入统一 `<selection_context>` 外层标签。
- 要求插件文档写清楚 selection fence 的语义、字段、生命周期、是否 mustKeep。
- 必要时后续再增加 descriptor metadata 支持统一审计或预算策略。

### 第 6 步：开放 current view plugin provider

- 定义插件如何贡献当前视图上下文。
- 明确该上下文默认 `turn-only`，默认 user-side。
- 避免插件直接写入泛化 `injected_context`。
- 不强制统一 `<current_view_context>` 外层标签，各插件保持自己的上下文标签。

### 第 7 步：同步公开上下文工程文档

当 host 侧方案稳定后，更新：

- 独立 Linnkit 仓的 `docs/integration/context-engineering.md`
- 独立 Linnkit 仓的 `docs/integration/context-fences.md`
- `src/app-hosts/linnya/context/README.md`

重点补充 role 结构图，让接入者能直观看到最终上下文构成。

## 待确认问题

1. `additional-context` 的废弃周期：保留 deprecated 多久，是否需要 runtime warning？
2. 插件 current view provider 的注册接口放在 plugin contribution 哪一层？
3. selection fence 是否需要 descriptor metadata 支持统一审计或预算策略？
