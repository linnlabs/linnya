块级时光机（BlockHistory）
=========================

> 为单个块提供「版本快照 + 时光机」能力：列表查询、时间轴浏览、左右分栏对比、覆盖式预览以及版本恢复。  
> 设计上与 Revision（修订痕迹）解耦：**历史版本只作为外部快照，不进入 ProseMirror schema。**

## 目录结构

```text
BlockHistory/
  index.ts                  # 对外统一导出：Store、UI 组件、工具类型
  README.md                 # 本文件

  store/
    useBlockHistoryStore.ts # 全局单例 Store，管理版本数据与 UI 状态

  functions/
    readBlockHistoryPanelState.ts # 历史面板展示状态与恢复前确认规则

  orchestration/
    ensureBlockHistoryLoadedForRootBlockId.ts
    toggleBlockHistoryForRootBlockId.ts
    restoreBlockHistoryVersionForRootBlock.ts

  ui/
    HistorySideBySide.vue   # 左右分栏对比视图（当前块 vs 选中历史版本）
    HistoryOverlay.vue      # 覆盖式预览视图，用于快速浏览历史版本
    HistoryTimeline.vue     # 底部时间轴控制器，负责版本选择与恢复入口

  styles/
    block-history.css   # 块历史模式样式

  utils/
    createHistoryEditor.ts  # 历史视图专用 TipTap Editor 配置（只读）
    historyExtensions.ts    # 历史 Editor 的扩展组合（schema 精简版）
    RootBlockHistory.ts     # 历史视图用 rootBlock 节点扩展（无 NodeView，仅渲染）
    lineExtractor.ts        # 将 RootBlock JSON 转换为「逻辑行」并做行级 diff
    scrollSync.ts           # 分栏视图滚动同步与滚动辅助工具
```

## 核心设计思想

- **块级而非文档级**
  - 历史数据以 `target_block_id` 为主键维度存储，配合 `document_node_id` 区分文档。
  - 每个块有自己的版本列表，可独立浏览、对比和恢复，而不影响其它块。

- **快照而非增量 diff**
  - 数据层面存的是完整 `RootBlock` 的 `content_json`（序列化 JSON），不存增量 patch。
  - 前端在展示层（`lineExtractor.ts`）做「行级 diff」，避免后端过度复杂化。

- **与编辑器 schema 解耦**
  - 主编辑器使用的是完整的 RootBlock schema + 丰富 NodeView。
  - 历史视图使用 `RootBlockHistory` + `historyExtensions`：
    - content 里只允许一部分文本类块：`baseBlock | headingBlock | listItemBlock | quoteBlock | codeBlock`；
    - 不挂 NodeView，只通过 `renderHTML` 复用 `.root-block-outer` / `.root-block` DOM 结构和样式。
  - 这样可以：
    - 共享样式与视觉结构；
    - 避免在历史视图中引入图片、音频等复杂块带来的交互和 schema 负担。

- **单例 Store，跨组件共享**
  - `useBlockHistoryStore` 通过模块级 `singletonStore` 实现全局单例：
    - 菜单 Provider、`BlockView`、`History*` 组件都读写同一份状态；
    - `setViewMode / selectVersion` 一次更新，所有相关 UI 自动响应。

## 数据流与 IPC 交互

- **前端 Store：`useBlockHistoryStore.ts`**
  - 状态：
    - `versionsByBlock: Record<string, BlockVersion[]>`
    - `uiStateByBlock: Record<string, BlockHistoryUiState>`
  - 关键方法：
    - `loadBlockHistory(documentNodeId, blockId)`：从后端加载指定块的版本列表。
    - `createVersion(params)`：为当前 `RootBlock` 内容创建新版本（手动 / AI / 恢复）。
    - `restoreVersion(documentNodeId, blockId, versionId)`：请求后端基于某个版本恢复，并刷新本地列表。
    - `deleteVersion(versionId)`：删除指定版本，并在本地状态中维护选中版本的回退逻辑。
    - `setViewMode / selectVersion / isInHistoryMode`：驱动 UI 层的历史模式与选中版本。
- **Feature orchestration**
  - `ensureBlockHistoryLoadedForRootBlockId(documentNodeId, blockId)`：按块预取历史版本摘要，避免 read-model 触发副作用。
  - `toggleBlockHistoryForRootBlockId(documentNodeId, blockId)`：统一 left-handle / 旧 BlockChrome 的历史入口语义，负责打开 / 关闭 side-by-side。
  - `restoreBlockHistoryVersionForRootBlock(...)`：统一历史版本恢复流程，可选择先为当前内容创建快照，再替换当前 rootBlock 内容。

- **IPC Gateway：`apps/renderer/shared/ipc/blockHistoryGateway.ts`**
  - 提供类型安全的调用封装：
    - `listVersions / getVersion / createVersion / restoreVersion / getLatestVersion / getVersionCount / deleteVersion`
  - 真正的数据库逻辑在 `src/electron-main/.../block-history.service.ts`，通过 IPC handler 暴露给前端。

- **调用入口示例**
  - 块操作菜单（`commonProvider`）中：
    - `openBlockHistory`：点击「查看历史版本」时，调用 `loadBlockHistory` 后进入 `side-by-side` 视图。
    - `createBlockVersion`：点击「创建为新版本」时，将当前 `RootBlock` JSON 序列化为 `contentJson` 并写入后端。

## UI 视图职责划分

- **`HistorySideBySide.vue`**
  - 用途：主编辑器右侧的只读对比视图。
  - 特点：
    - 使用 `useEditor(createHistoryEditorOptions())` 创建一个只读的 TipTap 实例。
    - 监听 `selectedVersion` 与 `historyEditor`，将 `version.content_json` 包装为 `doc` + `rootBlock` 后注入。
    - 只负责渲染内容，不再直接渲染恢复/关闭按钮（交互由外层容器或时间轴负责）。

- **`HistoryOverlay.vue`**
  - 用途：覆盖式预览历史版本，适合快速 glance。
  - 特点：
    - 通过 `extractLinesFromContentJson` 将 `content_json` 映射为逻辑行列表逐行展示。
    - 支持键盘 `Esc` 关闭。
    - 恢复按钮只向外发出 `restore(versionId)` 事件，实际恢复逻辑由 `useBlockHistoryUi` 统一处理。

- **`HistoryTimeline.vue`**
  - 用途：底部时间轴 + 版本选择 & 快速恢复。
  - 特点：
    - 将版本列表反转为「最旧 -> 最新」用于时间轴排布。
    - 根据圆点几何中心和鼠标坐标计算最近版本，支持点击与拖拽滑块选择版本。
    - 通过 `emit('restore', versionId)` 将恢复操作上抛；虚拟化主路径由 `BlockChromeHostHistoryPanel` 接住，再调用 `restoreBlockHistoryVersionForRootBlock` 做确认弹窗、快照策略和内容替换。非虚拟化旧路径仍由 `useBlockHistoryUi` 承接。

## BlockChromeHost 边界

大文档 rootBlock 渲染虚拟化路径中，历史入口与面板已经拆成两层：

- `BlockChromeHostLeftHandle.vue`：只负责版本按钮摘要、预加载历史版本、打开 / 关闭历史模式。
- `BlockChromeHostHistoryPanel.vue`：只在处于历史模式的当前 block 上挂载，负责把历史头部、右侧对比面板、覆盖预览和时间轴 Teleport 回 `.root-block` 文档流。

Host 不直接理解版本恢复规则：

- 当前内容是否已有快照，由 `functions/readBlockHistoryPanelState.ts` 判断。
- 恢复历史版本、按需创建当前内容快照、替换 ProseMirror rootBlock 内容，由 `orchestration/restoreBlockHistoryVersionForRootBlock.ts` 执行。
- 历史组件 `HistorySideBySide / HistoryOverlay / HistoryTimeline` 仍保留在 BlockHistory feature 内，Host 只负责挂载位置和事件转交。

## 工具与算法

- **`lineExtractor.ts`**
  - 功能：
    - 从 `RootBlock` 的 JSON 或字符串中提取「逻辑行」，为 overlay / diff 提供统一的行粒度。
    - 支持简单的 LCS（最长公共子序列）行级 diff，输出：
      - `addedLines: Set<number>`
      - `removedLines: Set<number>`
      - `changedPairs: Array<[number, number]>`
  - 注意：
    - 这里是纯前端算法，不依赖 ProseMirror 类型，只依赖结构约定。

- **`scrollSync.ts`**
  - 功能：
    - `createScrollSyncer`：在左右两列容器之间同步滚动，支持比例同步或直接 `scrollTop` 同步。
    - `useScrollSync`：Vue Composable 版本，用于在组件内方便初始化 / 销毁。
    - `scrollIntoViewIfNeeded`：辅助滚动某行到可视区域。
    - `getScrollRatioDiff`：计算两列滚动比例差异（用于调试或对齐判断）。

- **`historyExtensions.ts` & `createHistoryEditor.ts`**
  - 目的：提供一个**只读、轻量**的 TipTap 编辑器配置，专用于历史面板展示。
  - 关键点：
    - 禁用 `history / dropcursor / gapcursor` 等编辑相关功能。
    - 使用 `RootBlockHistory` 代替主编辑器的 RootBlock，避免挂载 NodeView。
    - 共享 `lowlight` 实例，保证代码块语法高亮一致。

## 与 Revision 的关系与边界

- BlockHistory 负责的是：**「时光机级别」的快照管理**，粒度在块级，操作的是整棵 `RootBlock` 子树。
- Revision 负责的是：**「行内/词级」的修订痕迹**，通过 marks / 自定义 node + diff 算法在主文档内就地展示。
- 两者的交互方式建议：
  - AI 润色 / 修订可以在完成后，选择性地调用 BlockHistory `createVersion` 做一个快照，用于之后的大版本回滚。
  - BlockHistory 不直接改写 Revision schema，而是通过 Block 内容的整体替换，让 Revision 仅关注当前版本内的细粒度变更。

## 版本入口与左侧控制岛设计

### 设计决策：为什么放在左侧？

版本入口（`BlockVersionHandle`）放在块的**左侧**，与 `DragHandle` 组成「左侧控制岛」，而不是放在右侧。核心理由：

1. **阅读流与重要性**：人类从左到右阅读，左侧信息天然更受关注。版本是块的「身份属性」，不是「旁注」。
2. **避免右侧遮挡**：右侧有 `AnnotationPanel`，如果版本按钮也放右侧，会有遮挡和拥挤问题。
3. **语义统一**：左侧 = 块的「身份 + 操作」区（Identity + Control），包括结构操作（拖拽）和时间维度（版本）。右侧 = 阅读视角的「旁注/审阅」区（批注）。
4. **未来扩展**：左侧控制岛可以容纳更多标签（AI 生成标记、锁定标记等），形成统一的块元信息入口。

### 自适应布局

根据块高度自动切换布局模式：

- **垂直排列**（默认，块高度 ≥ 36px）：
  - 版本按钮在上，拖拽手柄在下
  - 适合多行文本块
  
- **横向排列**（紧凑模式，块高度 < 36px）：
  - 版本按钮在左，拖拽手柄在右
  - 适合单行文本、标题等矮块
  - 通过 `ResizeObserver` 监听块高度变化，动态添加 `.is-compact` 类

### 相关文件

- **组件**：
  - `apps/renderer/domains/editor/ui/components/BlockLeftHandleGroup.vue`：左侧控制岛容器
  - `apps/renderer/domains/editor/ui/components/BlockVersionHandle.vue`：版本按钮组件
  
- **Composable**：
  - `apps/renderer/domains/editor/ui/composables/useBlockVersionHandle.ts`：版本按钮状态与自适应逻辑
  
- **样式**：
  - `apps/renderer/domains/editor/styles/layout/block-layout.css`：控制岛布局定位
  - `apps/renderer/domains/editor/features/BlockHistory/styles/block-history.css`：版本按钮视觉样式

### 交互行为

- **显隐**：与 `DragHandle` 一致，`root-block-outer:hover` 时显示
- **点击**：直接打开 Side-by-Side 历史视图，自动选中最新版本
- **仅在有历史版本时渲染**：通过 `useBlockVersionHandle.hasHistory` 控制

## 使用建议

- **在块菜单中集成**
  - 「创建为新版本」：在用户觉得当前内容值得存档时手动触发，类型标记为 `'manual'`。
  - 「AI 润色后自动保存版本」：可选，将 AI 结果写入 BlockHistory 并在 `originType` / `originMetadata` 中携带模型与 diff 统计信息。
  - 「查看历史版本」：只在该块存在历史版本时保持可用；无历史时在菜单层面直接禁用，避免空视图。

- **通过版本按钮快速访问**
  - 有历史版本的块，左侧会显示时钟图标按钮
  - 点击即可直接进入历史视图，无需打开菜单

- **开发调试**
  - 可以在 `useBlockHistoryStore` 中临时打印 `versionsByBlock` 与 `uiStateByBlock` 观察状态流转。
  - 配合 `apps/renderer/docs/AI-REVISION&TRACK-CHANGES-V3.md` 理解整体「修订 + 历史」系统的分层与演进方向。
