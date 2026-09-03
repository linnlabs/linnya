# MindMap Agents（推理画布 / Issue Tree）

本目录包含专用于 **MindMap（Reasoning Canvas / Issue Tree）** 场景的一组 agent。它们通过受限工具集对 MindMap 结构进行读取、创建节点、打标、挂证据，从而支持“问题拆解 → 假设生成 → 证据验证 → 结论沉淀”的闭环。

## Agent 一览

### 1) `decompose_question`（拆解问题）

- **用途**：把一个问题节点拆解为 3-7 个更具体、可验证、可执行的子问题，并创建为子节点。
- **入口语义**：右键 `question` 节点 → 拆解问题。
- **核心约束**：
  - 只做 **问题拆解**，不进入“验证/打标/挂证据”的闭环。
  - `question` 节点（`kind="question"`）**不允许**写 `status` / `confidence`（如果要表达优先级，用问题文本表达）。
- **工具白名单**（最小集合）：
  - `read_file`（使用 `view="document"` 读取 NodeRef View）
  - `mindmap_create_node`
- **实现**：`decompose_question/index.ts` + `decompose_question/prompt.ts`

### 2) `propose_hypothesis`（提出假设）

- **用途**：围绕目标节点提出 3-6 个可验证的子假设，并创建为子节点。
- **入口语义**：右键 `question` / `hypothesis` 节点 → 提出假设。
- **核心约束**：
  - 只负责 **生成假设（kind=hypothesis）并创建子节点**，不做打标/挂证据（避免混入验证闭环）。
  - 倾向使用 MECE、金字塔结构、对立/零假设、维度化假设类型（机制/条件/比较等）来保证覆盖面与非冗余。
- **工具白名单**：
  - `read_file`（使用 `view="document"` 读取 NodeRef View）
  - `list_files`
  - `mindmap_create_node`
- **实现**：`propose_hypothesis/index.ts` + `propose_hypothesis/prompt.ts`

### 3) `reasoning_canvas`（推理画布：打标 + 挂证据的闭环 agent）

- **用途**：在 MindMap 场景下进行更完整的推理工作：读结构、创建节点、**打标（status/confidence）**、**挂证据**，必要时搜索知识库。
- **入口语义**：用户处于 MindMap 页面时的通用推理 agent（更“全能”的 MindMap 工作流）。
- **核心能力**：
  - 对节点进行 `mindmap_tag_node`（用于假设节点的 `status` / `confidence` 等标记）
  - 对节点进行 `mindmap_attach_evidence`（把来源证据挂载到对应结论/假设上）
  - 可结合知识库工具检索证据后再挂载
- **工具白名单**（相对完整）：
  - Workspace：`list_files` / `read_file`（`view="document"`） / `write_file`
  - MindMap：`mindmap_tag_node` / `mindmap_attach_evidence` / `mindmap_create_node`
  - 知识库：`knowledge_search` / `list_knowledge_base` / `knowledge_read`
  - 工作记忆/其它：`todo_read` / `todo_write` / `generate_image`
- **实现**：`reasoning_canvas/index.ts` + `reasoning_canvas/prompt.ts`

### 4) `validate_hypothesis`（验证假设：搜证据 → 挂证据 → 打标）

- **用途**：专注于“验证假设”闭环：定位目标 `hypothesis` 节点，检索证据，生成 2-4 个结论子节点并挂证据，产出最终结论节点，并更新原假设节点的状态与置信度。
- **入口语义**：右键 `hypothesis` 节点 → 验证假设。
- **核心约束**：
  - 必须证据驱动：结论需要有证据支撑；找不到证据要承认不足。
  - `hypothesis`：允许 `status` + `confidence`
  - `conclusion`：允许 `confidence`，**不允许** `status`
  - `question`：**不允许** `status/confidence`（也不鼓励其它标签）
  - 证据必须通过 `mindmap_attach_evidence` 显式挂载到对应结论节点上（不能只在文本里提来源）。
- **工具白名单**：
  - `read_file`（使用 `view="document"` 读取 NodeRef View）
  - `mindmap_tag_node`
  - `mindmap_attach_evidence`
  - `mindmap_create_node`
  - 知识库（可选）：`search_in_knowledgebase` / `list_knowledge_base` / `knowledge_read`
- **实现**：`validate_hypothesis/index.ts` + `validate_hypothesis/prompt.ts`

## 推荐使用流程（高层）

- **先拆解**：用 `decompose_question` 把大问题拆成可验证的子问题（只创建 `kind="question"`）。
- **再提出假设**：用 `propose_hypothesis` 围绕某个问题或假设生成子假设（只创建 `kind="hypothesis"`）。
- **进入验证闭环**：
  - 偏“专项验证”用 `validate_hypothesis`（搜证据 → 结论节点 + 挂证据 → 标记假设状态）
  - 偏“MindMap 内综合推理与沉淀”用 `reasoning_canvas`（更完整的工具集与闭环能力）
