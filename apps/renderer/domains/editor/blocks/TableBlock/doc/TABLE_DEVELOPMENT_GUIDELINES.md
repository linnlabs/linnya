# TableBlock 开发指南与避坑总结

## 1. 引言

本文档旨在记录在 `TableBlock` 功能开发过程中遇到的复杂问题、关键决策、以及从错误中习得的宝贵经验。TableBlock 由于涉及 ProseMirror 深度嵌套的节点结构和精确的位置解析，其开发和维护具有一定挑战性。本文档的目标是为未来的开发和问题排查提供指导，减少重复劳动和潜在错误。

## 2. UI 定位与经验值调整

在开发与表格交互的 UI 元素（如浮动工具栏 `TableFloatingToolbar.vue`）时，精确的定位至关重要。

### 2.1. 工具栏垂直偏移量 (`-48px`)

-   **现象**：在 `tableToolbarUtils.js` 的 `calculateToolbarPosition` 函数中，计算出的 `top` 值会减去 `48`。
    ```javascript
    pos = {
        top: domRect.top + window.scrollY - 48, // UI偏移：-48px 经验值，使工具栏显示在选中单元格区域的上方
        left: domRect.left + window.scrollX,
    };
    ```
-   **原因**：这个 `-48px` 是一个基于视觉效果的经验调整值。它的目的是将浮动工具栏从选区左上角单元格的顶部向上偏移一段距离，使其美观地显示在选中单元格区域的上方（通常是表格线上方或略微靠上），而不是直接贴着单元格顶部。
-   **教训与建议**：
    -   对于这类纯粹为了视觉效果或特定交互体验而设置"魔法数字"，务必在代码中清晰注释其用途和来源（例如，"经验值"、"视觉调整"）。
    -   如果这类值将来可能需要调整，考虑将其定义为常量或配置项，而不是硬编码在逻辑中。
    -   在团队协作中，明确记录这类值的调整原因和效果。

## 3. ProseMirror 位置解析的复杂性与核心原则

ProseMirror 的位置系统非常强大，但也极其精细。理解其核心概念是避免错误的根本。

### 3.1. 关键原则：节点自身位置 vs. 节点内容位置

这是最常见也最容易出错的地方：

-   **`$pos.before(depth)`**: 返回在指定深度 `depth` 的祖先节点**本身（其开标签）**的起始位置。**在获取 `tableCell`、`tableHeader` 或 `tableRow` 等容器节点的准确起始位置时，应优先考虑使用此方法。**
-   **`$pos.start(depth)`**: 返回在指定深度 `depth` 的祖先节点**内容**的起始位置（即其开标签之后的位置）。

**混淆这两者是导致复杂导航和节点定位逻辑出错的主要原因。**

### 3.2. 应用于 TableBlock 的节点结构与重要位置解析

我们的 `TableBlock` 具有以下核心结构 (简化版，详见 `TableBlock.js` 和 `TableCellContentBlock.js`):

```
table (顶级表格节点, 假设其在文档中从 P_table 开始)
 └── tableRow
      ├── tableHeader / tableCell (单元格节点, 假设某个单元格 td_A 从 P_cell_A 开始)
      │    └── tableCellContentBlock (单元格内容容器, 从 P_cell_A + 1 开始)
      │         └── inline* (文本和行内格式，如<p>，从P_content_A+1开始)
      └── ...更多单元格
```

-   **`tableStartPos`**: 通常指 `<table>` 节点在文档中的绝对起始位置 (`P_table`)。
-   **`cellStartPos` (单元格激活状态)**:
    -   在 `TableCellInteractionExtension.js` 中，当用户点击一个单元格，我们通过 `getDetailedCellInfoFromDocPosition` (内部依赖 `findCellAndTableInfoFromResolvedPos`) 获取该单元格的信息。
    -   关键在于 `findCellAndTableInfoFromResolvedPos` 中，对于找到的 `tableCell` 或 `tableHeader` 节点，其起始位置 `cellPos` **必须通过 `$pos.before(depth)` 获取**，才能得到 `P_cell_A`。
    -   这个 `cellPos` (即 `P_cell_A`) 随后被存储在插件状态 `activeCellPos` 中。
-   **`CellSelection` 中的 `$anchorCell.pos` / `$headCell.pos`**:
    -   当用户通过鼠标或键盘选中一个或多个单元格形成 `CellSelection` 时，`selection.$anchorCell` (或 `$headCell`) 是一个解析后的位置对象 (`ResolvedPos`)。
    -   根据 ProseMirror 的内部机制和我们的节点结构，这个 `$anchorCell.pos` **指向的是 `tableCellContentBlock` 节点的起始位置**，即 `P_content_A` (`P_cell_A + 1`)。这一点与上面的 `activeCellPos` 不同，需要在使用时特别注意区分。

### 3.3. `TableMap.rectBetween` 方法的参数
-   **现象**：在 `tableToolbarUtils.js` 中，为了获取选中单元格构成的矩形区域，我们使用了 `TableMap.get(tableNode).rectBetween(anchorOffset, headOffset)`。
    其中 `anchorOffset` 的计算方式是：`selection.$anchorCell.pos - tableStartPos;`
-   **解释**：
    1.  `selection.$anchorCell.pos` 指向 `tableCellContentBlock` 的起始 (即 `P_content_A = P_cell_A + 1`)。
    2.  `tableStartPos` 指向 `<table>` 节点的起始 (`P_table`)。
    3.  因此，`anchorOffset = (P_cell_A + 1) - P_table`。
    4.  `TableMap` 内部通常是基于表格**内容区**（即 `P_table + 1` 之后）的相对偏移来组织单元格映射的。
    5.  `rectBetween` 能够正确处理这种基于 `CellSelection` 计算出的偏移，表明其内部有相应的转换逻辑。

## 4. Decoration 应用：单元格激活状态 (选中柄与边框)

实现点击单元格后显示选中柄和高亮边框，涉及 `Decoration.widget` 和 `Decoration.node`。

### 4.1. `Decoration.widget` (选中柄 - 例如小圆点)
-   **`pos` 参数**：应设置为激活单元格**内容**的起始位置。如果 `activeCellPos` 是单元格节点 (`<td>`/`<th>`) 的起始位置 (`P_cell_A`)，则 widget 的 `pos` 应为 `activeCellPos + 1` (即 `P_content_A`)。
-   **`side` 参数**：设置为 `0`，尝试将 widget 精确地渲染在 `pos` 参数指定的位置。
-   **CSS 定位**：
    -   单元格节点 (`<td>`/`<th>`) 需设置 `position: relative;`。
    -   选中柄 widget 本身设置 `position: absolute;` 并通过 `left`, `top` 等相对于其父级（即该单元格）进行精确定位。
    -   **错误经验**：如果 widget 的 `pos` 错误地设置为单元格节点的起始位置 (`P_cell_A`) 并使用 `side: -1`，会导致 widget 相对于整个表格（或更上级容器）定位，而不是当前单元格。

### 4.2. `Decoration.node` (单元格边框/背景高亮)
-   **`from` 参数**：应设置为激活单元格节点 (`<td>`/`<th>`) 的起始位置 (`P_cell_A`)，即插件状态中的 `activeCellPos`。
-   **`to` 参数**：应为单元格节点的结束位置。计算方式为：`from + (1 + cellNode.content.size + 1)`。
    -   `cellNode` 是通过 `state.doc.nodeAt(from)` 获取的单元格节点。
    -   `1` 代表单元格节点的开标签。
    -   `cellNode.content.size` 是单元格直接内容（即 `tableCellContentBlock` 节点）的大小。例如，一个空的 `tableCellContentBlock` (仅含开闭标签) 其 `nodeSize` 为 `2`。
    -   末尾的 `1` 代表单元格节点的闭标签。
    -   所以，一个空的 `tableCell` (内容为一个空的 `tableCellContentBlock`)，其完整大小应该是 `1 + 2 + 1 = 4`。
-   **错误经验 / `nodeSize` 误区**：
    -   直接使用 `state.doc.nodeAt(from).nodeSize` 作为节点大小来计算 `to` 参数 (`from + node.nodeSize`) 时，需要非常小心。
    -   根据日志观察，对于 `tableCell` 或 `tableHeader` 节点，当其内容仅为一个（可能为空的）`tableCellContentBlock` 时，ProseMirror 报告的 `node.nodeSize` (例如，日志中为 `4`) 可能与我们期望的、用于视觉装饰的完整范围（包含开闭标签）一致。但如果其内容更复杂，或 `nodeSize` 的计算有其他因素影响，直接使用可能导致范围不精确（如"多一列"的视觉错误）。
    -   最稳妥的方式是理解节点的构成，并通过 `1 + content.size + 1` 来确保覆盖了节点的完整范围。在我们的案例中，`reportedSize: 4` 和 `calculatedSize: 1 + contentSize(2) + 1 = 4` 最终吻合，解决了范围问题。

## 5. 调试与问题排查通用建议

1.  **结构化日志**：在调试涉及位置、选区、节点遍历等复杂逻辑时，打印出相关的 `ResolvedPos` 对象的详细信息（如 `$pos.pos`, `$pos.depth`, `$pos.parent.type.name`, `$pos.start(d)`, `$pos.before(d)` 等），以及相关节点的类型、`nodeSize`、`content.size`、在文档中的精确 `startPos` 和 `endPos`。这对于理解代码执行路径和状态至关重要。
2.  **精确的节点定义**：手边常备 `TableBlock.js`、`TableCellContentBlock.js` 等节点定义文件，明确各节点的 `content` 模型、`attrs` 等，这有助于分析为何某些操作不符合预期（例如，内容不被允许插入，或属性未正确解析）。
3.  **ProseMirror DevTools**: 如果可用，使用 ProseMirror 开发者工具检查编辑器状态、选区、节点树等，可以直观地发现问题。
4.  **最小复现**：遇到复杂问题时，尝试在一个简化的环境中复现问题，排除其他干扰因素。
5.  **原子化事务**：确保所有对文档的修改都通过 ProseMirror 的事务 (transactions) 进行，这不仅保证了可撤销性，也使得调试时可以审查每一步的变更。
6.  **CSS `box-sizing: border-box;`**: 对于表格相关的元素（`table`, `td`, `th`），使用 `box-sizing: border-box;` 可以帮助统一视觉尺寸和ProseMirror的节点尺寸计算，减少因 `padding` 和 `border` 引起的布局问题。

## 6. 复杂表格操作：列插入中的挑战与解决

在实现如 `addColumnBeforeCustom` 和 `addColumnAfterCustom` 等列操作命令时，我们遇到了多个层面的复杂问题，主要涉及命令的意外多次执行、事务内精确位置管理、以及与 `TableMap` 的交互。

### 6.1. 命令意外多次执行与 `editor.can()`

-   **现象/问题**：最初，"向左插入列"功能会错误地插入两列，其中一列内容异常。通过日志发现，核心命令 `addColumnBeforeCustom` 在用户单次点击后被执行了多次。
-   **根本原因/分析**：
    1.  进一步排查发现，这些多次执行源于 `TableFloatingToolbar.vue` 中的计算属性（如 `canAddColumnBeforeState`），它依赖于 `editor.can().addColumnBefore()`。
    2.  Tiptap 的 `editor.can().<commandName>()` 在检查命令可用性时，实际上也会执行命令函数本身，并且会传递完整的 `props`（包括 `tr` 和 `state`）。
    3.  如果命令函数内部没有区分"检查能力"和"实际执行"，则在 `editor.can()` 调用时也会产生副作用（如修改事务 `tr`），导致意外行为或后续的实际执行在已修改的文档状态上操作。
-   **解决方案/关键原则**：
    -   在自定义命令函数（如 `addColumnBeforeCustom`）的开头，检查 `props.dispatch` 是否存在。
    -   如果 `!dispatch` (即 `dispatch` 为 `undefined` 或 `null`)，则表示当前是 `.can()` 检查调用。此时，命令应仅执行必要的逻辑判断并返回布尔值，**不应执行任何修改文档的操作**（如 `tr.insert`）。
    ```javascript
    // 在 tableOperationCommands.js 的自定义命令中
    export const addColumnBeforeCustom = () => ({ tr, dispatch, editor }) => {
      const isCanCheck = !dispatch;
      // ...
      if (isCanCheck) {
        // 执行只读的检查逻辑，例如：
        const detailedCellInfoForCheck = getDetailedCellInfoFromDocPosition(editor.state, editor.state.selection.$head.pos);
        return !!detailedCellInfoForCheck; // 如果在表格内，通常可插入
      }
      // ... 实际的列插入逻辑 ...
    };
    ```
-   **教训与最佳实践**：始终在自定义命令中通过检查 `dispatch` 来区分 `.can()` 调用和实际执行，避免在检查阶段产生副作用。

### 6.2. 事务内位置管理与 `TableMap` 交互的挑战

在单次命令执行（即 `dispatch` 存在时）的循环中向多行/多列插入单元格时，我们遇到了由位置计算错误引发的 `baseBlock` 内容异常、插入多列以及 `RangeError: No cell with offset X found` 等问题。合并单元格后，这类问题会进一步放大，因为用户看到的是逻辑行列，而文档里实际是带 `rowspan` / `colspan` 的物理 cell 节点。

-   **现象/问题**：
    1.  即使命令只执行一次，仍可能插入两列，或插入的单元格内容不正确（如 `baseBlock`）。
    2.  在 `addColumnBeforeCustom` 或 `addColumnAfterCustom` 的行循环中，调用 `map.findCell(offset)` 时频繁出现 `RangeError`。
-   **根本原因/分析**：
    1.  **`tr.mapping` 的缺失**：在一个事务 `tr` 内部，当通过 `tr.insert()` 或其他步骤修改了文档后，文档中后续节点的位置会发生变化。如果后续的 `tr.insert()` 操作仍使用基于 *原始* 文档计算的绝对位置，就会在错误的地方进行插入。
    2.  **`TableMap.findCell(pos)` 参数的精确性**：`map.findCell(pos)` 期望的 `pos` 参数是目标单元格节点在文档中的起始位置相对于表格**内容区**起始位置的偏移量 (即 `cellNodeDocPos - (tableStartPos + 1)`)。计算此偏移时任何微小的偏差（如偏离1）都可能导致 `RangeError`。
    3.  **循环内 `map.findCell` 的复杂性**：在遍历表格的每一行并尝试为该行确定正确的列插入点时，如果在循环内部依赖 `map.findCell` 和通过累加 `node.nodeSize` 计算出的偏移量，一旦 `TableMap` 的状态（它是基于表格初始状态创建的）与当前迭代中因 `nodeSize` 计算不精确而产生的偏移量不匹配，就会出错。

-   **解决方案/关键原则**：
    1.  **行列插入逻辑收口到专门模块**：
        -   `tableColumnInsertion.js` 负责 `addColumnBeforeCustom` / `addColumnAfterCustom` 的 TableMap 适配。
        -   `tableRowInsertion.js` 负责 `addRowBeforeCustom` / `addRowAfterCustom` 的 TableMap 适配。
        -   `tableCoreOperations.js` 只负责 `.can()` 检查、调用 helper、恢复 selection。
    2.  **按 TableMap 的逻辑行列判断，而不是按物理 child index 猜位置**：
        -   当插入点位于已有 colspan 单元格内部时，使用 `addColSpan(...)` 扩展该 cell。
        -   当插入点位于逻辑列边界时，才插入新的物理 cell。
        -   当插入点位于已有 rowspan 单元格内部时，扩展该 cell 的 `rowspan`，并跳过它覆盖的 `colspan` 范围。
        -   当插入点位于逻辑行边界时，才在新行创建新的物理 cell。
    3.  **仍然必须使用 `tr.mapping.map()`**：无论是 `setNodeMarkup` 扩展 colspan，还是 `tr.insert` 插入新 cell，都必须把基于原始 `TableMap` 的位置映射到当前事务位置。
    4.  **保留 Linnya 的内容模型**：ProseMirror 原生 `addColumn` / `addRow` 会用 `createAndFill()` 创建 cell；我们不能直接复用它，因为新 cell 必须包含带 id 的 `tableCellContentBlock`。因此当前实现复用官方算法思路，但用项目自己的 cell 创建函数。

-   **教训与最佳实践**：
    -   在单个事务中进行多次修改时，`tr.mapping` 是保证后续步骤位置准确性的生命线。
    -   理解 `TableMap.get(tableNode)` 创建的 `map` 是基于其参数 `tableNode` 的快照。在事务中修改 `tableNode` 后，原 `map` 不会自动更新。
    -   不要再用“累加 rowNode.child(c).nodeSize”作为行列插入主路径；它只适合无 span 的简单表格，会在合并单元格后把新 cell 插到错误位置。
    -   对于行列操作，`TableMap` 是逻辑结构真相；物理 cell 节点只是渲染结构。命令必须先判断逻辑行列，再决定扩展 span 或插入新 cell。
    -   `tableCoreOperations.test.js` 覆盖了四个关键场景：插入点落在 colspan 内时扩展 cell；选中 colspan cell 后在右侧插列时插到逻辑右边界；插入点落在 rowspan 内时扩展 cell；选中首行普通 cell 后在下方插行时仍尊重左侧跨行 cell。

### 6.3. 按索引删除列：不能通过首行 `CellSelection` 中转

Table AI 撤销输出列时会调用 `deleteColumnByIndex(editor, tablePos, columnIndex)`。这里的 `columnIndex` 是逻辑列索引，而不是第 0 行的物理 cell 索引。

旧实现会先用 `map.positionAt(0, columnIndex, tableNode)` 找第 0 行对应位置，再创建 `CellSelection`，最后调用原生 `deleteColumn()`。这个做法在简单表格里能工作，但当第 0 行存在 `colspan` 时会出错：

- 逻辑列 1 可能仍被第 0 行的同一个跨列 cell 覆盖。
- `CellSelection` 选中的就是整个跨列 cell。
- 原生 `deleteColumn()` 会按 selection 的矩形范围删除，结果可能一次删掉多列，而不是只删 `columnIndex` 这一列。

当前实现把逻辑列删除收口到 `tableColumnDeletion.js`：

1.  直接从 `tablePos` 读取最新 table node，并用 `TableMap.get(tableNode)` 校验 `columnIndex`。
2.  调用 ProseMirror tables 的 `removeColumn(tr, { map, table, tableStart }, columnIndex)` 删除指定逻辑列。
3.  删除后把 selection 放回第一行可用单元格的 `tableCellContentBlock` 内，避免选区停在被删除列或 cell 容器边界。

对应测试：`tableColumnDeletion.test.js` 覆盖了删除 colspan 内部逻辑列、删除 colspan 第一列、拒绝删除最后一列，以及 `deleteColumnByIndex` 命令入口不再走 `CellSelection` 中转。

### 6.4. 已有单元格读写：逻辑坐标不能等同于物理 child 下标

Table AI 写表、逐行 prompt 上下文、批量填充这类入口拿到的通常是用户看到的逻辑 `row / col`。在普通表格里，逻辑列 1 看起来刚好等于 `rowNode.child(1)`；但只要出现 `colspan` 或 `rowspan`，这个等式就不成立。

-   **根本原因/分析**：
    1.  `rowNode.child(index)` 是该行实际存在的物理 cell 顺序。
    2.  `row / col` 是用户视角下的 TableMap 逻辑网格坐标。
    3.  一个物理 cell 可以通过 `colspan` 覆盖多个逻辑列，也可以通过 `rowspan` 覆盖多行；此时某个逻辑坐标对应的 cell 可能不在当前行的同名 child 下标上。
    4.  `map.positionAt(row, col, tableNode)` 更适合“推导插入位置”。读取或写入已有 cell 时，真正表示覆盖关系的是 `map.map[row * map.width + col]`。

-   **当前规则**：
    1.  读取 / 写入已有逻辑坐标时，统一使用 `position/tableMapUtils.js` 的 `getCellOffsetAtLogicalPosition(map, row, col)`。
    2.  命令或 AI 层拿到 offset 后，再计算 `cellDocPos = tablePos + 1 + offset`，并通过 `getCellContentBlockPositions` 定位 `tableCellContentBlock` 内容区。
    3.  批量写入时必须对同一个物理 cell 去重，避免 rowspan 覆盖多行时重复写入。
    4.  `map.positionAt(...)` 只保留在结构插入这类需要推导边界的位置；读取 / 写入 / 已有 cell 导航都不能把它当作主路径。

-   **已收口入口**：
    -   `commands/tableFillTargets.js` 负责批量填充目标解析。
    -   `ai/tableCellWriter.js` 负责工具写表目标解析。
    -   `ai/tableRowProcessing.js` 负责逐行 prompt / row context 读取。
    -   `ai/tableAiUtils.js` 的区域读取也通过同一 helper 获取覆盖 cell。
    -   `extensions/TableSelectionDecoratorExtension.js` 负责持久选区 / 输出列 / 列引用装饰的逻辑坐标去重。
    -   `position/tableCoordinateUtils.js` 负责 Excel 风格坐标定位和表头读取。
    -   `ui/composables/tableCoordinateHeaderMetrics.ts` 负责坐标轴列宽 / 行高测量。
    -   `position/tableNavigationUtils.js` 负责键盘导航和外部进入表格时的逻辑格子解析。

坐标轴测量有一个额外规则：优先使用非跨列 / 非跨行 cell 的 DOM 尺寸；只有某个逻辑列或逻辑行只剩跨列 / 跨行 cell 可测时，才把该 cell 的 DOM 尺寸按 `colspan` / `rowspan` 均分。这样可以避免把一个跨两列的总宽度直接当作单列宽度。

对应测试：`tableFillTargets.test.js` 覆盖 colspan / rowspan 下批量填充不会写错物理 child；`tableCellWriter.test.js` 覆盖 rowspan 逻辑坐标写入；`tableRowProcessing.test.js` 覆盖逐行上下文读取 rowspan 覆盖 cell；`TableSelectionDecoratorExtension.test.js` 覆盖装饰去重；`tableCoordinateUtils.test.js` 覆盖 Excel 坐标与表头读取；`tableCoordinateHeaderMetrics.test.ts` 覆盖坐标轴测量候选选择；`tableKeys.test.js` / `tableNavigators.test.js` 覆盖 Enter、Shift+Tab、ArrowDown 和外部进入表格时的 rowspan 目标解析。

### 6.5. 键盘导航：区分逻辑覆盖与垂直邻居

表格键盘导航也不能直接使用 `map.positionAt(row, col, tableNode)` 读取已有 cell。用户看到的“上一格 / 下一格 / 最后一格”可能被 `rowspan` 或 `colspan` 覆盖，真实 cell 不一定在当前物理行里。

-   **水平或边界导航**：使用 `getCellNavigationTargetAtLogicalPosition(state, tableNode, tablePos, row, col)`。它先通过 `getCellOffsetAtLogicalPosition` 解析逻辑格子的真实覆盖 cell，再返回 `tableCellContentBlock` 的可选区范围。
-   **垂直导航**：使用 `getAdjacentVerticalCellNavigationTarget(state, tableNode, tablePos, row, col, direction)`。它先找到当前真实 cell，再用 `TableMap.nextCell` 跳过 rowspan 覆盖范围，避免 Enter / ArrowDown 从跨行 cell 错跳到右侧物理 cell。
-   **外部进入表格**：`tableNavigators.js` 也走同一套 helper。进入表格末尾时，如果右下角逻辑格被上方 rowspan cell 覆盖，光标应进入那个真实覆盖 cell，而不是推导到不存在的结构边界。
-   **Toolbar 定位 / 多选区收缩**：`tableToolbarUtils.js` 和 `tableToolbarSelection.ts` 不能直接用 `rect.top * width + rect.left` 后自行读 `map.map`。它们统一通过 `getCellOffsetAtLogicalPosition` 解析左上角逻辑格子对应的真实 cell，再读取 DOM 或创建 `CellSelection`。

这条规则的目标很简单：命令层只表达“去用户看到的哪个格子”，位置层负责把它翻译成 ProseMirror 真实位置。

---

## 7. Vue 响应式系统与 Tiptap Editor 实例状态交互的深层问题

在 TableBlock 功能（特别是浮动工具栏 `TableFloatingToolbar.vue` 及其组合式函数 `useTableAiInteraction.ts` 等）的开发过程中，我们遇到了一个极为棘手且反复出现的问题：Tiptap 的 `Editor` 实例在从父组件 (`EditorContext.vue`) 通过 props 和 Vue 的计算属性 (`computed`) 传递到子组件或组合式函数后，其 `.state` getter 会意外返回 `undefined`，而 `.view.state` 却可能仍然有效。这直接导致了 ProseMirror 的 `RangeError: Applying a mismatched transaction` 错误，因为所有依赖编辑器状态的命令和事务都无法正确执行。

此问题在开发环境 (HMR 启用时) 尤为明显，HMR 似乎会影响 Vue 响应式系统对 `Editor` 实例的代理行为，或导致实例的某些内部链接断裂。

### 7.1. 现象与核心症状

1.  **`Editor.state` 为 `undefined`**:
    *   最直接的症状是，在子组件或组合式函数中获取到的 `Editor` 实例（通常是通过 `.value` 从 `ref` 或 `computed` 中解包得到），当尝试访问其 `.state` 属性时，返回 `undefined`。
    *   日志通常显示：`editorInstance.state` -> `undefined`。

2.  **`Editor.view.state` 仍然有效**:
    *   令人困惑的是，在同一个 `editorInstance` 上，访问 `editorInstance.view.state` 往往能返回一个有效的 ProseMirror `EditorState` 对象。
    *   这表明编辑器视图 (`EditorView`) 可能仍然持有一个有效的状态引用，但 `Editor` 实例顶层的 `.state` getter 已经失效。

3.  **"Mismatched Transaction" 错误**:
    *   由于 ProseMirror 命令（如 `mergeCells`, `addColumnAfter` 等）和事务分发 (`view.dispatch(tr)`) 都依赖于一个与 `view.state` 同步的、有效的 `editor.state`，当 `editor.state` 为 `undefined` 时，任何基于此状态创建或应用事务的操作都会失败。
    *   ProseMirror 内部检查发现 `transaction.docs[0]` (来自新事务的状态) 与 `this.state.doc` (来自 `view.state.doc`，但期望与 `editor.state.doc` 一致) 不匹配，从而抛出错误。

4.  **HMR 的"临时修复"与干扰**:
    *   在某些情况下，手动保存项目中的任意 JS/Vue 文件（触发 HMR 更新）后，问题可能会"暂时消失"，编辑器功能恢复正常。这表明 HMR 过程可能重新建立了 Vue 的响应式代理或 Tiptap 实例的某些内部链接。
    *   然而，这种"修复"是不可靠的，问题会在后续操作或下一次 HMR 更新后再次出现。这增加了调试的复杂性，因为问题的可复现性受到了 HMR 活动的影响。

5.  **Vue `computed` 属性的"黑魔法"**:
    *   问题主要出现在 `Editor` 实例被 Vue `computed` 属性包装和传递后。
    *   例如，在 `TableFloatingToolbar.vue` 中：
        *   `toolbarProps = inject('toolbarProps')` (包含原始 `editor` ref)。
        *   `mergedProps = computed(() => toolbarProps.value || defaultValue)` (第一层 `computed`)。
        *   `editorForHooks = computed(() => mergedProps.value.editor)` (第二层 `computed`，专门为钩子创建)。
    *   当我们直接使用 `mergedProps.value.editor` 时，其 `.state` 通常是正常的。
    *   但是，当通过 `editorForHooks.value` 获取到的实例，其 `.state` 却可能变为 `undefined`。
    *   这强烈暗示 Vue 在创建和管理这些计算属性的代理对象时，对于 Tiptap `Editor` 这种外部复杂对象（拥有自己的 getter/setter 和内部状态）的处理方式存在一些未知的副作用或边界情况。

### 7.2. 失败的尝试与错误的排查方向

1.  **怀疑 Tiptap/ProseMirror 命令本身**:
    *   花费了大量时间检查原生命令的返回值、参数，或尝试用自定义命令包裹原生命令，试图捕获或绕过错误。这通常是徒劳的，因为问题根源不在命令逻辑，而在命令执行时所依赖的编辑器状态。

2.  **在命令内部用 `view.state` 替换 `editor.state`**:
    *   尝试在自定义命令中，如果发现 `editor.state` 为 `undefined`，则使用 `editor.view.state` 作为当前状态。
    *   这在某些简单情况下可能"欺骗"过一些检查，但无法根本解决问题。因为 ProseMirror 的事务机制期望 `Editor` 实例本身是"完整"的，其顶层 `.state` 应该与 `view.state` 保持一致。仅仅替换状态对象，而 `Editor` 实例本身（特别是其 `.state` getter）仍然"损坏"，会导致更深层次的不匹配。

3.  **过度依赖 `watch` 或 `nextTick`**:
    *   试图通过 `watch` 编辑器实例的变化，或在 `nextTick` 后执行命令，期望能获取到"更新后"的、健康的实例。这通常也无法解决根本问题，因为 `computed` 属性返回的那个"损坏的"代理对象一旦形成，其 `.state` getter 可能就一直无效，直到下一次 HMR 或某种深层响应式重建。

### 7.3. 最终的解决方案与核心原则

解决这个问题的核心在于**最大限度地减少 Vue `computed` 属性对 Tiptap `Editor` 实例的不必要或深层嵌套的包装，并确保在组件树中传递和使用 `Editor` 实例时，尽可能地追溯到那个被证明其 `.state` getter 行为正常的"原始"或"最接近源头"的响应式引用。**

1.  **识别"健康的"编辑器实例来源**:
    *   通过细致的日志和实验，我们发现在 `TableFloatingToolbar.vue` 中，通过 `mergedProps = computed(() => inject('toolbarProps').value || defaultValue)` 获取到的 `mergedProps.value.editor`，其 `.state` getter 是能正常工作的。我们将此视为一个"相对健康"的编辑器实例来源。

2.  **直接命令执行的策略**:
    *   对于在组件内部直接调用的编辑器命令（如 `TableFloatingToolbar.vue` 中的 `executeTableCommand` 函数），应**直接使用**这个"健康的"来源：
        ```javascript
        // TableFloatingToolbar.vue
        const mergedProps = computed(() => inject('toolbarProps').value || defaultValue);

        const executeTableCommand = (commandFn) => {
          const editorToUse = mergedProps.value.editor; // 直接使用
          if (editorToUse && editorToUse.state) { // 确保 state 存在
            commandFn(editorToUse);
          } else {
            console.error('[Toolbar] Editor or editor.state is not available for command:', commandFn.name);
            // 可以进一步记录 editorToUse.view.state 进行对比
          }
        };
        ```

3.  **向组合式函数 (`use` hooks) 传递编辑器实例的策略**:
    *   **避免再次创建专门的 `computed` 属性来传递 `editor`**:
        *   我们发现，即使 `mergedProps.value.editor` 是好的，如果创建一个新的 `const editorForHooks = computed(() => mergedProps.value.editor)` 并将 `editorForHooks` 传递给 `use` 钩子，钩子内部通过 `editorForHooks.value.state` 访问时，问题仍然可能复现。
    *   **传递"包含 editor 的父级 ComputedRef"**:
        *   更稳健的做法是，将那个包含"健康 editor"的、层级更靠上的 `ComputedRef` (即 `mergedProps`) 直接传递给组合式函数。
        *   组合式函数内部再通过 `.value.editor` 的方式来访问实际的 `Editor` 实例。

        ```javascript
        // TableFloatingToolbar.vue
        const mergedProps = computed(() => inject('toolbarProps').value || defaultValue);
        
        const { /* ... */ } = useTableAiInteraction({ 
          mergedEditorProps: mergedProps, // 传递 mergedProps 整体
          hideToolbar: /* ... */ 
        });

        // useTableAiInteraction.ts
        export function useTableAiInteraction({ mergedEditorProps, /* ... */ }) {
          // ...
          const handleAIAction = async (action) => {
            const currentEditorInstance = mergedEditorProps.value.editor; // 从父级 ComputedRef 的 .value 中获取 editor
            
            if (!currentEditorInstance) {
              console.error('[Hook] Editor instance (from mergedEditorProps.value.editor) is null/undefined.');
              return;
            }
            if (!currentEditorInstance.state) {
              console.error('[Hook] Editor state (from mergedEditorProps.value.editor.state) is undefined.');
              // 记录 currentEditorInstance 和 currentEditorInstance.view.state
              return;
            }
            
            // 后续逻辑使用 currentEditorInstance
            const { state, view } = currentEditorInstance; 
            // ...
          };
          // ...
        }
        ```

4.  **对组合式函数参数的考量 (备选方案)**:
    *   如果不想传递整个 `mergedProps`，另一种理论上可行但我们未深入采用的方案是，让组合式函数接受一个返回 `Editor` 实例的**函数**作为参数：
        ```javascript
        // TableFloatingToolbar.vue
        useSomeHook({ getEditor: () => mergedProps.value.editor, /* ... */ });

        // useSomeHook.js
        export function useSomeHook({ getEditor, /* ... */ }) {
          const editor = getEditor(); // 在需要时调用
          // ...
        }
        ```
        这种方式的缺点是 `getEditor()` 返回的实例可能不是响应式的，或者其响应式行为可能与直接传递 `ComputedRef` 不同。

### 7.4. 教训与未来开发建议

1.  **深入理解 Vue 响应式代理的边界**: 当将非纯数据对象（如包含复杂 getter/setter、内部状态管理、原型链方法的 Tiptap `Editor` 实例）引入 Vue 的响应式系统时，需要特别警惕。Vue 的代理可能无法完美兼容或可能改变这些对象的某些内部行为。
2.  **最小化 `computed` 包装层级**: 对于这类复杂外部对象，尽量避免不必要的或深层嵌套的 `computed` 属性包装。每一层新的 `computed` 都可能引入新的代理对象，增加问题的复杂性。
3.  **"信源"原则**: 努力识别并坚持使用被证明是"可靠"的响应式数据源（如我们例子中的 `mergedProps.value.editor`）。后续所有对该数据的访问应尽可能直接地从这个"信源"派生，减少中间转换。
4.  **HMR 下的严格测试**: 在 HMR 环境下进行充分测试，特别是涉及跨组件状态传递和复杂外部库交互的功能。HMR 常常是问题的"放大镜"。
5.  **日志驱动调试**: 面对此类问题，详细的、有针对性的日志是无可替代的。不仅要记录值的存在性，还要记录值的类型 (`typeof`)、是否为 Proxy、以及关键内部属性（如 `.state` vs `.view.state`）的实际内容。
6.  **优先探究 `.state` 失效，而非直接用 `.view.state`**: 虽然 `.view.state` 可能有效，但它只是一个症状的线索。目标应该是修复 `.state` getter，确保 `Editor` 实例的完整性。依赖 `.view.state` 只是权宜之计，治标不治本。
7.  **考虑 `shallowRef` 或 `markRaw`**: 虽然我们没有直接采用，但在某些情况下，如果一个对象不需要深度响应式，或者其响应式行为由自身管理（如 Tiptap Editor），可以考虑使用 Vue 的 `shallowRef` 来包装它，或者用 `markRaw` 将其标记为不应被代理。这可以避免 Vue 对其进行深层代理，但需要仔细评估其对功能的影响（例如，如果 Vue 模板或 `watch` 需要响应其内部变化，则可能不适用）。
    *   **注意**: Tiptap 官方文档在 Vue 2 中建议使用 `editor.destroy()` 并在 `beforeDestroy` 中处理，Vue 3 中则是在 `onBeforeUnmount` 中 `editor.value.destroy()`。Tiptap 的 `useEditor` 钩子内部通常会处理好这些。如果我们手动管理 `Editor` 实例，则需要确保正确处理其生命周期，并考虑它与 Vue 响应式系统的交互方式。将 `new Editor(...)` 的结果直接赋给一个 `ref` 时，Vue 会使其成为响应式。

这次问题的解决过程是一次宝贵的学习经历，它提醒我们在使用强大框架的同时，也要对其内部机制和潜在的边界情况保持敬畏和探索精神。

---

*本文档将持续更新，以反映在 TableBlock 开发过程中遇到的新问题和解决方案*

---

## 8. 内容聚合问题：合并单元格后的 `tableCellContentBlock` 处理

在实现表格单元格合并功能时，即使 Tiptap 的标准 `mergeCells` 命令能够正确处理单元格的 `colspan`/`rowspan` 属性以及删除被覆盖的物理单元格节点，我们仍然遇到了合并后主单元格内容结构不符合预期的问题。

### 8.1. 现象与问题描述

-   **预期行为**：当多个单元格被合并时，它们各自的内容（通常包裹在自定义的 `tableCellContentBlock` 节点内）应该被聚合到一个新的、单一的 `tableCellContentBlock` 中，并且不同来源的文本内容之间应该有适当的分隔（如空格）。
-   **实际行为**：Tiptap 的 `editor.chain().focus().mergeCells().run()` 命令执行成功后，合并后的主单元格（具有 `colspan > 1` 或 `rowspan > 1` 的单元格）内部直接包含了所有来自原始被合并单元格的 `tableCellContentBlock` 节点。例如，如果合并了两个各含一个 `tableCellContentBlock` 的单元格，目标单元格就会包含两个 `tableCellContentBlock`，而不是一个聚合了两者内容的 `tableCellContentBlock`。

### 8.2. 原因分析

-   Tiptap 的 `mergeCells` 命令在移动和合并内容时，会遵循目标单元格节点的 schema 定义。
-   我们的 `CustomTableCell` (以及 `CustomTableHeader`) schema 定义其 `content` 属性为 `"tableCellContentBlock+"`，意味着它允许一个或多个 `tableCellContentBlock` 作为其子节点。
-   因此，当 `mergeCells` 命令处理被合并单元格的内容（即它们各自的 `tableCellContentBlock` 节点）时，它发现这些节点都符合目标单元格的 schema，于是便将它们原封不动地、依次移入了合并后的主单元格内。
-   这个行为在技术上是符合 schema 规则的，但未能满足我们对内容进行语义上聚合的特定需求。

### 8.3. 解决方案：内容结构规范化模块 (Content Normalization)

为了解决这个问题，当前实现把内容结构规则收口到 `commands/tableCellContentNormalization.js`。`tableCellCommands.js` 只负责执行合并 / 拆分命令；命令成功后，由规范化模块扫描最新 `editor.state.doc`，找出不满足结构不变量的 `tableCell` / `tableHeader`，并生成一个独立的 ProseMirror 事务修正结构。

规范化模块覆盖四类情况：

- 空 cell：补一个新的 `tableCellContentBlock`
- 旧版 / 粘贴遗留结构：把非 `tableCellContentBlock` 的直接子节点下压为内联内容，并包进单一内容块
- 合并后的多内容块：复用 `commands/tableCellContentAggregation.js` 的聚合内核，把多个 `tableCellContentBlock` 合并为一个
- 属性缺失：为单一内容块补齐稳定 `id` 和 `blockType='tableCellContent'`

这样做有两个原因：

- 命令层不再需要依赖当前 selection 去反推“刚刚合并的是哪个 cell”，避免虚拟化 hydrate / selection 恢复后拿到旧位置。
- 结构规则可以用纯 ProseMirror 节点测试覆盖，不依赖 toolbar、Vue 或真实 DOM。

1.  **执行原生命令**：首先，正常调用 `editor.chain().focus().mergeCells().run()`。

2.  **扫描最新文档结构**：
    *   原生命令成功后，调用 `buildTableCellContentNormalizationTransaction(editor.state)`。
    *   规范化模块从最新 `state.doc` 遍历 `tableCell` / `tableHeader`，统一处理空 cell、旧结构、多个内容块和属性缺失。
    *   这一步不依赖 `selection.$anchor`、`CellSelection.$anchorCell.pos` 或 DOM 位置，因此不会被 hydrate 前后的旧位置影响。

3.  **检查子节点并聚合内容**：
    *   确认 `mergedCellNode` 被成功找到，并且它包含多个子节点 (`mergedCellNode.childCount > 1`)。
    *   进一步验证这些子节点是否全部都是 `tableCellContentBlock` 类型。
    *   如果上述条件均满足，则开始聚合内容：
        *   初始化一个空的 Prosemirror `Fragment` ( `aggregatedContentFragment = Fragment.empty;`)。
        *   遍历 `mergedCellNode` 的所有子节点 (即那些旧的 `tableCellContentBlock` 节点)。
        *   对于每个子节点的 `content` (这也是一个 `Fragment`)，将其追加到 `aggregatedContentFragment`。
        *   在追加不同来源的内容块之间，智能地插入一个空格文本节点 (`schema.text(' ')`) 作为分隔符。插入空格的条件是：不是第一个内容块、聚合片段和当前内容块都有实际内容、且现有内容和新内容之间没有天然的空格。

4.  **创建新的单一内容块并替换**：
    *   使用 `schema.nodes.tableCellContentBlock.create(...)` 方法，创建一个全新的、单一的 `tableCellContentBlock` 节点。这个新节点使用上一步生成的 `aggregatedContentFragment` 作为其内容，并被赋予一个新的唯一 `id` 和 `blockType` 属性。
    *   基于最新编辑器状态 (`state.tr`) 创建一个新的 Prosemirror 事务 (`transaction`)。
    *   对每个目标 cell，内容范围固定为 `contentStartPos = cellPos + 1` 到 `contentEndPos = contentStartPos + cellNode.content.size`。
    *   如果同一个事务里有多个 cell 需要聚合，必须按 `pos` 从大到小替换，避免前一个替换改变后面 cell 的原始位置。
    *   调用 `transaction.replaceWith(contentStartPos, contentEndPos, newSingleContentBlock)`，用这个新建的、包含聚合内容的单一 `tableCellContentBlock` 替换掉合并单元格内原有的所有子节点。
    *   为该事务添加元数据标记：`normalizedTableCellContent=true`、`normalizedTableCellContentCount` 与 `normalizedTableCellContentReasons`，以便追踪或调试。
    *   使用 `view.dispatch(transaction)` 将这个修改应用到编辑器。

对应测试：`commands/tableCellContentNormalization.test.js` 会验证空 cell、旧结构包裹、多内容块聚合、header cell 属性修复和通过最新 editor state dispatch 的入口行为；`commands/tableCellContentAggregation.test.js` 继续验证聚合内核的空格边界与位置替换顺序；`extensions/TablePasteSanitizerHandler.test.ts` 验证外部粘贴的 Slice 归一化同样复用这套结构不变量。

### 8.4. 教训与启示

-   **标准命令的局限性**：即使是像 Tiptap 这样优秀的库提供的标准命令，也可能因为其通用性而无法完全满足特定应用场景下的所有细微需求。这些命令通常会严格遵循 schema 定义。
-   **后处理的重要性**：当标准命令的行为与特定需求存在偏差时，采取"命令后处理"的策略是一种有效的补充手段。即先让标准命令完成其主要工作，然后通过一个紧随其后的自定义事务来微调结果，使其完全符合预期。
-   **理解 Schema 与内容模型**：深刻理解自定义节点的 schema (特别是 `content` 定义) 以及 Prosemirror 的 `Fragment` 和节点操作机制，是实现这类复杂后处理逻辑的基础。
-   **事务的原子性与精确性**：在后处理中，所有修改仍需通过 Prosemirror 事务进行，确保操作的原子性和可追溯性。精确计算替换范围 (`replaceWith` 的 `from` 和 `to` 参数) 至关重要。

通过这种方式，我们成功地确保了在单元格合并后，其内容不仅视觉上统一，在文档结构层面也表现为单一、聚合的内容块，这对于后续的内容处理、编辑以及数据导出都更为有利。

---

## 9. Table AI 列引用状态与 Editor 实例边界

早期版本通过 Vue ref、shared helper 和防抖回调传递 Editor 实例，并把列引用状态复制到多个模块。这套路径已经删除。现行实现遵循以下规则：

- Editor 实例只由 `tableAiHighlightRuntime` 按 `editorId` 注册和持有；列引用 functions 不接收 Editor，也不读取 Vue ref。
- 模式、稳定表身份、active refs 和执行态只存在于 `domains/editor/features/table-ai-mode/` 会话中。
- 解析和颜色是纯函数。颜色由当前上下文列顺序计算，不允许使用模块级颜色 Map，也不需要在退出时 reset。
- 整体选区引用的矩形由源列范围合并得到，不能复用 `outputRect`；两者分别代表输入上下文和写入目标。
- orchestration 更新 store 后直接调用同 feature 高亮 runtime；延迟 InputRule 必须携带原 `sessionId`。
- 高亮 runtime 每次从最新 `editor.state.doc` 按 `rootBlockId` 重定位表格，再用最新 `editor.state.tr` 创建 Decoration transaction。
- Decoration 只传动态 CSS 变量；静态背景、透明度和层叠样式统一归 `styles/table.css`。

排查列引用问题时，应分别观察 active refs 中的颜色、Decoration attrs 和浏览器 computed style。若前两者正确而最终视觉错误，应检查 CSS 变量定义层级，不能通过重新分配颜色或增加 store fallback 掩盖样式作用域问题。
