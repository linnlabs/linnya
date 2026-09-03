# 纯 TS `MindMapModel`（前后端共用）方案：可行性、边界与落地路径（讨论稿）

> 中文说明：
> - 本文档**不是里程碑过程文档**，而是一个长期的架构备选：把 MindMap 的“数据结构变更语义（树结构 + arrows/summaries tidy + tagging 状态 + 证据联动）”抽象为纯 TS Model，供**后端工具确定性 apply/校验/干跑**与前端/后端共享语义复用。
> - 当前仓库的主线是 **MindMap Reasoning Canvas（读结构 → 打标 → 挂证据 → 自动刷新）**；Model 方案属于“下一阶段工程化/抽包”的候选方案，尚未实现。
>
> 最后更新：2026-02-04

---

## 1) 这个想法是否可行？

**结论：可行性很高，但前提是把“纯数据层”从 renderer 依赖里剥离出来**，否则后端无法安全复用。

理由（代码事实）：

- MindMap 的核心编辑本质上是 **树结构变更**（新增/移动/重排），并不像 Markdown/Tiptap 那样需要富文本 diff。
- 仓库里已经存在一组 **不依赖 DOM 的树操作函数**（纯数据）：
  - `packages/plugins/mindmap/src/renderer/shared/utils/tree/nodeTreeOperations.ts`
    - `moveUpObj/moveDownObj/removeNodeObj/insertNodeObj/insertParentNodeObj/moveNodeObj(...)`
  - `packages/plugins/mindmap/src/renderer/shared/utils/tree/index.ts`
    - `getObjById/fillParent/refreshIds/checkMoveValid/deepClone(...)`
- 但是：这些纯函数目前放在 renderer 域内，并且 `packages/plugins/mindmap/src/renderer/shared/utils/index.ts` 这个 barrel 同时 re-export 了 DOM/Layout/SVG 等模块（后端引入会被污染），因此**不能直接在后端工具中 import 这个入口**。

---

## 2) 为什么 `MindMapModel` 仍然值得做（在我们“不做 revision”的主线下）？

我们已经明确：AI 不做“修订稿/删删减减”，而是以 **新建节点（提出假设/验证/结论）+ 打标（状态/置信度/语义类型）+ 挂证据** 为主。

在这个主线下，`MindMapModel` 的价值更聚焦：

- **后端工具的确定性**：把“对 MindMapData 的变更”收敛成可测试的纯函数 apply（给定输入 JSON 与 ops，输出新 JSON + ChangeSet），减少工具实现漂移。
- **严格校验与干跑（dry-run）**：工具可在写入 `mindmap_versions` 前做 preflight（合法性校验、影响范围计算、tidy 风险提示）。
- **前后端语义复用**：当未来出现更多工具（批量新增、移动子树、从证据抽取生成节点、合并分支等）时，不用后端再“手写一套树操作 + tidy + 校验”。

注意：Model 的目标不是绕开 `mind.commands.*`（前端 contract/undo-reflow 仍然要走 command），而是让**后端工具**也拥有同等严格的“数据层正确性”。

---

## 3) 必须正视的边界：MindMap 不只有 `nodeData`

`MindMapData` 不止树，还包含（至少）：

- `nodeData`：树
- `arrows`：关联线（引用节点 ID）
- `summaries`：概要（引用节点范围/ID）
- 节点字段：`expanded/direction/...`
- 推理语义：`NodeObj.tagging?: { status/confidence/labels }`

因此 Model 的 apply 不能只改树，至少要确保（即便只是 dry-run/校验，也要计算这些影响）：

- **arrows/summaries 的 tidy 影响**：当节点新增/移动/删除导致引用失效时，需要有统一口径（不一定后端落库 tidy，但必须在校验/摘要阶段可解释地提示“会被 tidy 掉的引用”）。
- **方向/布局相关语义一致性**：例如 `moveNodeObj(...)` 在“根/第一层附近”会调整 `direction`；后端复用时必须保持一致，否则左右分支会错乱。
- **`parent` 字段**：`fillParent(...)` 是运行时补的（不会持久化）。Model 需要在加载 JSON 后 `fillParent`，保存时必须确保输出不含 `parent`。
- **tagging 字段的合并语义**：`tagging.status/confidence/labels.kind` 必须可共存（不能互相覆盖），且 labels 支持 merge/replace。

---

## 4) 与 Evidence（卫星表）的契约：Model 需要产出 ChangeSet

MindMap evidence 存在于 `mindmap_evidence` 卫星表，外键关联 `mindmap_node_id`。因此任何“影响 nodeId 集合”的操作都需要明确联动策略。

建议 `MindMapModel.apply(ops)` 的返回值包含 **ChangeSet**（中文注释必须写清楚）：

- `addedNodeIds / removedNodeIds / movedNodeIds / updatedNodeIds`
- `taggedNodeIds`（status/confidence/labels 变更）
- `tidiedArrowIds / tidiedSummaryIds`（如果有）
- `affectedRootIds`（用于前端刷新后最小聚焦/选中策略参考）

后端工具可据此做：

- **证据联动（可选）**：
  - 删除子树：对被删 `nodeIds` 做 evidence `softDeleteByNodeIds(...)`（或等价策略）
  - 复制/克隆：明确是否 `cloneEvidence(...)`
  - 移动：一般不需要改 evidence（nodeId 不变），但可能影响 UI 展示/排序

> 说明：当前我们把“挂证据”拆成独立工具 `mindmap_attach_evidence`（写卫星表，不改版本），Model 可以先不覆盖 evidence 写入，但 ChangeSet 仍应为未来联动预留接口。

---

## 5) 推荐的落地形态（只改工程边界，不改业务语义）

### 5.1 抽离一个真正“可后端复用”的模块

当前纯树操作在 renderer 下（`apps/renderer/...`），后端不应依赖 renderer 目录。推荐抽离到共享位置：

- 方案 1：新建 `packages/mindmap-model-core/`（纯 TS、无 DOM）
- 方案 2：挂到 `packages/schemas/src/mindmap/`（若希望 schema 与 model 同包演进）

模块内容建议拆两层（高内聚低耦合）：

- **`mindmap-model-core`**：只处理 `MindMapData`（树/arrows/summaries/tagging）与 ChangeSet
- **`mindmap-model-evidence`**：把 ChangeSet 映射为 evidence service 调用（后端专用，但仍然不依赖 renderer）

### 5.2 前端仍保留现有 commands/contracts

前端不应改成“直接用 Model 改数据然后 refresh”，否则会绕开：

- `operation` 事件（undo/redo/history）
- command hooks（保证一致性/插件联动）
- reflow 调度口径

Model 的价值是“后端确定性 apply + 校验”，不是让前端绕开 contracts。

---

## 6) 触发迁移到 `packages/` 的标准（Checklist）

当出现以下任一情况时，Model 抽包 ROI 会非常高：

- 后端工具需要**新增/移动/重排**等更复杂的树编辑（不仅仅是 tagging）
- 需要系统化 `ChangeSet` 与单测覆盖（避免工具之间口径不一致）
- 需要与前端一致的 tidy/校验口径（arrows/summaries/tagging merge 语义）
- 工具数量增长导致“同类 tree 操作”在多个工具里重复实现

---

## 7) 需要进一步核对的“未读代码事实”（后续补齐）

为了把 Model 方案做成“严格正确”，还需要补齐两类事实（不靠猜）：

- **summaries 的 tidy/一致性规则**：删除/移动节点后 summaries 如何处理？是否有统一 tidy？
- **MindMapData 的完整 schema**：后端写新版本必须保持字段不丢（theme/direction/viewport/扩展字段），需要对齐后端 MindMap 文档读写的 JSON shape

