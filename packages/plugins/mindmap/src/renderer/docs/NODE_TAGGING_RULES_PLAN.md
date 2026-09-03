# 节点类型与打标规则（Status / Confidence）计划

> 最后更新：2026-02-05  
> 目标读者：MindMap 前端 / 后端工具 / Agent Prompt 维护者  
> 范围：`packages/plugins/mindmap/src/renderer/` + `packages/plugins/mindmap/src/backend/tools/mindmap/`

---

## 0) 背景与动机

我们希望 MindMap 不仅是“普通思维导图”，而是**推理画布**：节点具备语义类型（假设/问题/结论）与可视化打标（已证实/已证伪/未验证 + 高/中/低置信度）。

但如果所有节点都能随意贴任意标签，会导致：

- **语义漂移**：同样的状态在不同节点类型上表达不同含义；
- **工具/人协作不稳定**：Agent 或用户写入的标签不受约束，后续 UI/规则难以收敛；
- **数据一致性差**：同一节点同时被当作“问题”又带“已证伪”之类状态，语义冲突。

因此需要明确“**节点类型决定可用打标字段**”的规则，并在**前端命令**与**后端工具**两侧同时落地，保证写入路径一致。

---

## 1) 当前代码事实（已确认）

### 1.1 数据契约已经存在

- 版本化 Spine：`mindmap_versions.content_json`（`MindMapData / NodeObj`）
- 节点打标字段：`NodeObj.tagging?: NodeTagging`
  - `tagging.status?: string`（推荐：`open/verified/refuted/closed`）
  - `tagging.confidence?: string | number`（推荐：`high/medium/low`）
  - `tagging.labels?: Record<string, string | number | boolean>`
    - 目前“节点类型”用 `tagging.labels.kind` 表示（`hypothesis/question/conclusion`）

代码位置：

- 前端类型：`packages/plugins/mindmap/src/renderer/domain/types/index.ts`
- Tagging 展示：`packages/plugins/mindmap/src/renderer/features/tagging/*`

### 1.2 前端目前只提供 `kind` 的手动入口

- 右键菜单：`presentation/ui/MindMapContextMenu.vue`
  - 子菜单“节点类型 → 假设/子问题/结论/清除”
- 命令：`domain/commands/commands/taggingCommands.ts`
  - `node.setKind` 通过 `reshapeNode` 写入 `nodeObj.tagging.labels.kind`

### 1.3 status/confidence 的写入主要来自后端工具

后端工具：`packages/plugins/mindmap/src/backend/tools/mindmap/MindMapTagNodeTool.ts`

- 能写 `status/confidence/labels`
- **目前不会**按节点类型限制写入（同一套字段对所有节点一视同仁）

---

## 2) 术语澄清（避免混淆）

MindMap 当前存在两套“类似标签”的概念：

1) **旧 tags（视觉标签）**：`NodeObj.tags?: (string | TagObj)[]`  
   - 渲染路径：`shared/utils/dom/index.ts` 中 `.tags` 容器  
   - 适合：普通思维导图的“装饰性标签”

2) **tagging（推理语义打标）**：`NodeObj.tagging?: NodeTagging`  
   - 适合：假设验证（status）、置信度（confidence）、节点语义类型（kind）

本计划讨论的是 **(2) tagging**。我们不把 status/confidence 回写到旧 `tags`。

---

## 3) 规则定义（本计划的核心）

### 3.1 节点类型（kind）

节点类型使用推荐值（存储小写）：

- `hypothesis`：假设
- `conclusion`：结论
- `question`：问题

存储位置（现状）：`tagging.labels.kind`

### 3.2 允许的打标字段矩阵（强约束）

| 节点类型(kind) | status（open/verified/refuted/closed） | confidence（high/medium/low 或数值） | 其它 labels（除 kind 外） |
| --- | --- | --- | --- |
| hypothesis（假设） | ✅允许 | ✅允许 | ⛔默认不允许（先收敛） |
| conclusion（结论） | ⛔不允许 | ✅允许 | ⛔默认不允许（先收敛） |
| question（问题） | ⛔不允许 | ⛔不允许 | ⛔不允许 |

> 中文说明：
> - “问题节点无法贴其它标签”按当前口径理解为：**除 `labels.kind=question` 外，不应存在 status/confidence/其它 labels。**
> - 结论不允许 status，是为了让“已证实/已证伪”语义聚焦在“假设验证”上；结论只保留置信度（表达结论可靠程度）。

### 3.3 kind 为空（未设置类型）时的策略

需要明确一个默认策略，否则规则无法执行。

推荐策略（偏保守，避免误写入）：

- **kind 未设置**：视为“普通思维导图节点”，不展示/不编辑 status/confidence（保持 minimal）
- 若未来希望“未设置 kind 也能标置信度”，需要单独扩展矩阵并同步全链路

---

## 4) 数据一致性策略（不靠 UI 兜底）

规则必须被当作**数据层 invariant**。因此需要两类动作：

### 4.1 写入前校验（validate）

对任何“写 tagging”的入口进行校验：

- **前端**：命令层（`mind.commands.*`）校验并拒绝不合法写入
- **后端工具**：`mindmap_tag_node` 校验并拒绝不合法写入

拒绝策略建议：

- 对单节点操作：直接失败（error），返回明确原因（kind=question 不允许设置 status/confidence 等）
- 对批量操作：逐条校验，**任何一条非法即整体失败**（保证一次工具调用的原子性与可预测性）

> 中文说明：不做“悄悄忽略字段”的防御性行为；一旦规则不满足就失败，让调用方修正。

### 4.2 kind 变更时归一化（normalize）

当节点 kind 被手动修改时，需要决定如何处理“旧 tagging”：

- 例：hypothesis（带 status/confidence） → question  
  若不清理，节点会立刻违例。

推荐策略：

- 在 `node.setKind` 执行完成后，对 `tagging` 做一次 **normalizeByKind(kind, tagging)**：
  - question：仅保留 `labels.kind='question'`（其它全部移除）
  - conclusion：移除 status；保留 confidence；移除除 kind 外 labels（按 3.2）
  - hypothesis：允许 status/confidence；labels 仅保留 kind（先收敛）

> 这里不是“补丁式修复”，而是对 invariant 的**主动维护**：kind 变化意味着节点语义变化，字段集合也必须同步变化。

---

## 5) 前端落地计划（Renderer）

### 5.1 规则模块（单一事实来源）

新增一个纯 TS 的规则模块（位置待定，要求可被 commands 与 UI 共用）：

- `allowedTaggingByKind(kind)`：返回可用字段集合
- `validateTaggingMutation(kind, patch)`：校验一个“写入 patch”是否合法
- `normalizeTaggingForKind(kind, tagging)`：kind 变化后收敛数据

实现约束：

- 禁止 `any` 类型断言；用显式类型收敛与 switch 窄化
- 中文注释解释“为什么这样约束”

> 位置建议：
> - 若需要前后端共用：优先考虑抽到 `packages/` 下的新包（见 7.1）
> - 若先仅前端落地：可以先放在 `packages/plugins/mindmap/src/renderer/domain/` 下

### 5.2 命令层：新增 status/confidence 的写入命令

在 `domain/commands/commands/` 增加：

- `node.setStatus({ nodeId, status: 'open'|'verified'|'refuted'|'closed'|null })`
- `node.setConfidence({ nodeId, confidence: 'high'|'medium'|'low'|number|null })`

要求：

- 与 `node.setKind` 一致：只 patch `tagging` 的目标字段，禁止覆盖/清空整个 tagging（避免抹掉其它字段）
- 写入前按 3.2 做校验
- 通过 `mind.reshapeNode(...)` 触发 operation，保持 reflow/历史语义一致
- 对折叠节点（DOM 找不到）需明确策略：要么禁止（更严格），要么仅改数据并 fire reshapeNode operation（与 `node.setKind` 现状一致）

### 5.3 UI：右键菜单提供手动入口（最小可用）

扩展 `MindMapContextMenu.vue`：

- 增加“状态”子菜单（仅 hypothesis 显示）
  - 待验证(open)、已证实(verified)、已证伪(refuted)、已关闭(closed)、清除
- 增加“置信度”子菜单（hypothesis + conclusion 显示）
  - 高/中/低、清除
- question：不显示状态/置信度入口；并且在菜单上可提示“问题节点不支持打标”（可选）

交互细节：

- 子菜单项显示 ✓ 表示当前值（与 kind 子菜单一致）
- 选择后走 `instance.commands.node.setStatus / setConfidence`

### 5.4 Tagging 展示：保持不变

`features/tagging` 继续只负责展示与 DOM data-* 注入，不承担“编辑/写入”责任。

> 说明：写入属于“编辑器能力”（commands + UI），展示属于“feature addon”。保持边界清晰。

---

## 6) 后端工具落地计划（mindmap_tag_node）

在 `MindMapTagNodeTool` 写入前增加规则校验：

1) 解析目标节点当前 kind（来自 `node.tagging.labels.kind`）  
2) 对 op 中的 `status/confidence/labels` patch 按 3.2 校验  
3) 若不合法：抛错终止（保持工具执行的确定性）

注意：

- tool 支持 `labels_mode=merge|replace`，但本计划初期默认禁止除 kind 以外 labels，因此：
  - 如果 labels 包含除 `kind` 外的 key：直接报错（或作为 phase2 扩展）
- 若节点没有 tagging 或没有 kind：
  - 按 3.3 策略：视为“普通节点”，拒绝写 status/confidence（除非工具同时写入 kind 并且通过校验）

---

## 7) 前后端共享（可选但推荐）

### 7.1 抽一个共享 contracts 包（推荐）

为了避免“前端/后端各写一套规则”导致漂移，建议把以下内容抽到 `packages/`：

- NodeKind 常量（hypothesis/question/conclusion）
- 状态与置信度推荐值（open/verified/refuted/closed，high/medium/low）
- 规则矩阵（allowed fields）
- `validate/normalize` 纯函数

候选落点：

- 新建 `packages/mindmap-contracts/`（纯 TS，无 DOM）
- 或扩展 `packages/schemas/`（如果这里被定义为“跨端契约库”）

### 7.2 同步 Agent Prompt

Agent 侧已有工具指引会使用 `mindmap_tag_node` 写 status/confidence。规则落地后需要同步 prompt：

- question 节点不要再尝试写 status/confidence
- conclusion 节点不要写 status（只写 confidence）

---

## 8) 测试与验收

### 8.1 单测（推荐，至少覆盖规则函数）

- `validateTaggingMutation`：
  - hypothesis：允许 status/confidence
  - conclusion：拒绝 status，允许 confidence
  - question：拒绝 status/confidence/其它 labels
- `normalizeTaggingForKind`：
  - kind 切换时字段被正确清理

### 8.2 手动验收（UI）

- hypothesis 节点：右键能设置状态与置信度，徽标展示正确，CSS 样式（refuted/verified/closed）生效
- conclusion 节点：只能设置置信度；尝试设置状态应不可见或被拒绝
- question 节点：不出现状态/置信度入口；切换到 question 后旧标签被清理

### 8.3 工具验收（后端）

- 对不合法组合（如 conclusion + status=refuted）工具应明确报错，不写新版本
- 合法组合写入后，前端 AutoRefresh 刷新能展示正确徽标与样式

---

## 9) 里程碑拆分（建议）

- **Milestone A（前端编辑闭环）**
  - 规则模块（仅前端）
  - 新 commands：setStatus/setConfidence
  - 右键菜单入口
  - kind 变更 normalize

- **Milestone B（后端工具强约束）**
  - `mindmap_tag_node` 加校验与错误信息
  - 更新 Agent prompt 文档/模板
 

- **Milestone C（contracts 抽包）**
  - 把规则抽到 `packages/`，前后端统一引用

---

## 10) 未决问题（需要在实现前定案）

1) **kind 未设置时**，是否允许写 confidence？（本计划建议先不允许，保持收敛）
2) 结论节点是否需要“已证伪/已证实”这类状态？（当前规则不允许；如果业务强需要，需要重新定义语义）
3) “其它 labels”未来是否要开放？如果要开放，需要：
   - 明确 label key 的白名单（按 kind 区分）
   - 明确 merge/replace 行为与冲突策略

