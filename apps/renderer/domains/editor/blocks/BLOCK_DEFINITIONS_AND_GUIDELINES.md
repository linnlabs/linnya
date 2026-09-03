# 编辑器块定义与分组指南

## 1. 引言

本文档旨在为编辑器中自定义块（Node）的定义、分组、内容规则及相关配置提供指导和规范。遵循这些指南有助于保持项目代码的一致性、可维护性，并简化未来添加或修改块类型的工作。

## 2. 核心概念回顾

在深入具体块的定义之前，我们先回顾一下 Tiptap/ProseMirror 中的一些核心概念：

*   **节点 (Node):** 编辑器内容的基本单位。可以是块级（如段落、标题、表格）或行内级（如加粗文本、链接）。每个节点类型都有一个 schema 定义。
*   **Schema:** 定义了文档中允许的节点类型、它们的属性、内容规则以及它们之间的关系。编辑器的行为严格受 schema 约束。
*   **组 (Group):**
    *   **节点定义中的 `group` 属性:** 在每个节点的 `.js` 定义文件中，通过 `group: 'groupName1 groupName2'` 来声明该节点属于一个或多个组。
    *   **通用约定组:** ProseMirror 有两个特殊的约定俗成的组名：`'block'` (用于块级元素) 和 `'inline'` (用于行内元素)。将节点归入这些通用组有助于被 ProseMirror 的核心机制和第三方扩展识别。
    *   **自定义组别名 (`schema.js` 中的 `NODE_GROUPS`):** 在 `schema.js` 中，我们可以定义如 `NODE_GROUPS.BLOCK_CONTENT = 'baseBlock|headingBlock|...'` 这样的字符串常量。这些是**组的别名或集合**，主要用于在其他节点的 `content` 规则中方便地引用一批节点类型，从而定义文档结构。**一个节点被列入自定义组别名的字符串中，不代表它自动拥有了该组名作为其 `group` 属性的一部分，也不代表它自动加入了通用的 `'block'` 组。**
*   **内容规则 (Content Rule):** 在节点 schema 定义中的 `content` 属性，用于规定该节点类型**可以包含**哪些类型的子节点。它可以直接引用节点名（如 `'paragraph'`)、组名（如 `'block+'`，表示一个或多个属于 `block` 组的节点）、或自定义组别名（如 `${NODE_GROUPS.BLOCK_CONTENT}*`，表示零个或多个属于 `BLOCK_CONTENT` 集合中的节点）。
*   **优先级 (Priority):** 在节点定义中的 `priority` 属性（一个数值）。它主要影响 ProseMirror 在某些情况下如何选择节点，例如：
    *   **默认文本块选择:** 当 `createAndFill()` 需要填充一个空节点时，它会考虑节点的 `priority`（结合其是否属于 `'block'` 组和 `content: 'inline*'`）来选择默认的文本块。**优先级越高的节点越容易被选为默认文本块。**
    *   **粘贴和输入规则解析:** 多个规则匹配同一输入时，高优先级的规则先生效。
    *   **Schema 顺序:** 节点的注册顺序和 `priority` 会影响它们在最终生成的 ProseMirror Schema 对象内部的顺序，这间接影响某些匹配逻辑。
*   **原子块 (Atom Block):** 在节点定义中设置 `atom: true`。原子块被视作一个不可分割的整体，其内容通常由 NodeView 完全管理，用户不能直接编辑其内部。例如 `LatexBlock`。

## 3. 主要块定义清单与指南

以下是对项目中一些主要块类型的配置回顾和建议。

---

### 3.1. `BaseBlock`

*   **路径:** `domains/editor/blocks/BaseBlock.js`
*   **用途:** 编辑器的基础文本块，类似于段落。是新表格单元格、列表项等内容的默认填充块。
*   **关键配置:**
    *   `name: 'baseBlock'`
    *   `group: \`block ${NODE_GROUPS.BLOCK_CONTENT}\``
        *   **`block`**: 必须加入，以确保能被 `Schema.defaultTextblockType()` 正确识别为文本块候选。
        *   **`${NODE_GROUPS.BLOCK_CONTENT}`**: 必须加入（如果 `BLOCK_CONTENT` 是一个有效的组名字符串，并且此节点确实是该内容模型的一部分），以使其能被如 `RootBlock` 或 `TableCell` 等节点的 `content` 规则所允许。
    *   `content: 'inline*'` (或 `text*` 如果只允许纯文本): 表明它可以包含行内节点或文本，这是成为"文本块"的关键。
    *   `priority: 1000` (或更高，如 `ExtensionPriority.High` 对应的数值): 确保在默认文本块选择中具有高优先级，优先于如 `LatexBlock`、`CodeBlock`（如果它们也被错误配置为默认文本块候选）等。
    *   `draggable: false` (通常，因为拖拽由 `RootBlock` 的 NodeView 处理)
    *   `atom: false` (因为它需要容纳可编辑的行内内容)

---

### 3.2. `LatexBlock`

*   **路径:** `domains/editor/blocks/LatexBlock.js`
*   **用途:** 显示和编辑 LaTeX 公式的原子块。
*   **关键配置:**
    *   `name: 'latexBlock'`
    *   `group: \`block ${NODE_GROUPS.BLOCK_CONTENT}\`` (如果希望它能独立存在于 `RootBlock` 中或表格单元格中)
        *   **`block`**: 加入，表明它是一个块级元素。
        *   **`${NODE_GROUPS.BLOCK_CONTENT}`**: 加入，以允许其作为 `RootBlock` 或 `TableCell` 的内容。
    *   `atom: true`: 非常重要，表明其内容由 NodeView 管理，不可直接编辑。
    *   `content: ''` (或不定义): 原子块通常没有 ProseMirror 管理的子内容。
    *   `priority: 100` (或默认值): 通常不需要高优先级，因为它不应被选为默认文本块。
    *   `draggable: true` (如果希望它能通过 NodeView 拖拽)

---

### 3.3. `TableBlock`

*   **路径:** `domains/editor/blocks/TableBlock.js`
*   **用途:** 实现表格功能。
*   **关键配置 (Table 节点本身):**
    *   `name: 'table'` (与 Tiptap 内置表格命令兼容)
    *   `group: \`block ${NODE_GROUPS.BLOCK_CONTENT}\`` (允许其作为 `RootBlock` 的子节点)
        *   **`block`**: 加入，表明它是一个块级元素。
        *   **`${NODE_GROUPS.BLOCK_CONTENT}`**: 加入，以允许其作为 `RootBlock` 的内容。
    *   `content: 'table_row+'`: 表格内容必须是至少一个 `table_row`。
    *   `isolating: true` (通常表格是隔离的，内部回车等行为有特殊处理)。
    *   **`cellContent: 'baseBlock'` (在 `EditorContext.vue` 中 `TableBlock.configure()` 时设置):** **非常重要，但这只对 `insertTable` 命令有效**，用于指定初始创建表格时单元格的默认内容。对于后续的 `addRowAfter` 等命令，需要依赖 `BaseBlock` 自身的高 `priority` 和正确的组设置来成为默认填充。
*   **相关节点 (在 `EditorContext.vue` 中配置):**
    *   `TableRow`: `content: '(table_cell | table_header)+'`
    *   `TableCell`: `content: \`\${NODE_GROUPS.BLOCK_CONTENT}+\``, `group: 'block'` (可以考虑加入，尽管它被父节点严格约束)
    *   `TableHeader`: `content: \`\${NODE_GROUPS.BLOCK_CONTENT}+\``, `group: 'block'` (同上)

---

### 3.4. `HeadingBlock`, `QuoteBlock`, `CodeBlock`, `ListItemBlock` 等

*   对于这些也是块级内容、且可能包含文本或行内元素的块：
    *   `group`: 考虑设置为 ``block `${NODE_GROUPS.BLOCK_CONTENT}```。
    *   `content`: 根据其是否应包含行内内容来设置（例如 `inline*` 或更具体的）。
    *   `priority`: 如果它们也可能意外成为"默认文本块"的候选（例如，如果它们的 `content` 也是 `inline*`），但您不希望它们优先于 `BaseBlock`，则应确保其 `priority` 低于 `BaseBlock`。通常，`BaseBlock` 应该有最高的 `priority`（在所有可作为默认填充的文本块中）。
    *   `CodeBlock` 如果是设计为内部直接编辑代码文本的，其 `content` 可能是 `text*`。

#### `ListItemBlock`（无序 / 有序列表项）

*   本项目采用“**一个列表项 = 一个块**”的结构（而不是标准 HTML 的 `<ol><li>` 嵌套节点）。
*   **列表类型通过 `attrs.listType` 区分**：
    *   `bullet`：无序列表（项目符号）。
    *   `ordered`：有序列表（编号）。
*   **缩进通过 `attrs.level` 控制**（目前限制 0~3），Tab/Shift+Tab 与 Backspace 的行为与 `bullet` 一致。

## 4. 添加新块的步骤和注意事项

1.  **创建节点定义文件:** 在 `domains/editor/blocks/` (或相应子目录) 下创建新的 `.js` 文件，例如 `MyNewBlock.js`。
2.  **定义节点 Schema:**
    *   `name`: 唯一名称 (例如 `myNewBlock`)。
    *   `group`:
        *   是否为块级元素？加入 `'block'` 组。
        *   它应该被哪些父节点的 `content` 规则所允许？将其加入相应的自定义组别名字符串 (`NODE_GROUPS.XYZ`) 中，并在其 `group` 属性中也声明这个别名（如果这个别名代表了一个逻辑分组，例如 `NODE_GROUPS.BLOCK_CONTENT`）。
    *   `content`: 定义它可以包含哪些子节点。如果它是一个文本块，则为 `inline*` 或 `text*`。如果是容器块，则引用其他节点名或组。如果是原子块，则通常为空。
    *   `attrs`: 定义节点需要的属性 (如 `id`, `blockType`, 以及其他特定属性)。
    *   `priority`: 明智地设置。对于应作为主要默认文本填充的块（如 `BaseBlock`），设置高优先级。其他块根据需要设置，避免冲突。
    *   `atom`: 如果内容由 NodeView 管理，则为 `true`。
    *   `selectable`, `draggable`, `isolating`: 根据需要设置。
    *   `parseHTML()`: 定义如何从 HTML 解析此节点。
    *   `renderHTML()`: 定义如何将此节点渲染为 HTML (主要用于非 NodeView 的情况或序列化)。
    *   `addCommands()`: 添加与此节点相关的命令。
    *   `addNodeView()`: 如果需要自定义渲染和交互，关联一个 Vue NodeView 组件。
3.  **更新 `schema.js`:**
    *   如果创建了新的自定义组别名，在此处定义。
    *   将新节点的 `name` 添加到适当的 `NODE_GROUPS` 字符串中，以确保它能被允许插入到预期的父节点中 (例如，加入到 `NODE_GROUPS.BLOCK_CONTENT` 以允许在 `RootBlock` 或 `TableCell` 中使用)。
4.  **在 `EditorContext.vue` 中注册扩展:**
    *   导入新创建的块。
    *   将其添加到 `Editor` 实例的 `extensions` 数组中。
    *   **注意注册顺序:** 虽然 `priority` 是主要因素，但注册顺序有时也会间接影响 Schema 的内部顺序。通常将具有高 `priority` 的基础块（如 `BaseBlock`）放在前面。
5.  **（可选）创建 NodeView 组件:** 如果是原子块或需要复杂交互的块，创建对应的 Vue 组件。
6.  **（可选）添加 CSS 样式。**
7.  **测试！** 测试插入、编辑、删除、序列化、反序列化以及与其他块的交互。

## 5. 分组策略和最佳实践

*   **明确区分 `group` 属性和 `NODE_GROUPS` (自定义组别名):**
    *   节点的 `group` 属性（在节点定义 `.js` 文件中）声明了该节点**实际属于**哪些组。
    *   `NODE_GROUPS`（在 `schema.js` 中）是用于在 `content` 规则中**引用一批节点名称**的便捷方式。
*   **通用组 `'block'` 和 `'inline'`:**
    *   所有块级元素都应在其 `group` 属性中包含 `'block'`。
    *   所有行内元素都应在其 `group` 属性中包含 `'inline'`。
*   **`BaseBlock` 的特殊性:**
    *   确保 `BaseBlock` (或您选择的默认段落/文本块) 正确配置为高优先级、属于 `'block'` 组、且 `content: 'inline*'`。这是避免新单元格/列表项等被错误填充的关键。
*   **细化自定义组:**
    *   如果需要更精细地控制某些块只能出现在特定类型的父容器中，可以创建更多的自定义 `NODE_GROUPS` 别名。
    *   例如，可以有 `NODE_GROUPS.TABLE_CELL_CONTENT`，它可能只包含 `BaseBlock` 和 `InlineLatexNode`，而不包含 `TableBlock` 自身。
*   **原子块 (`atom: true`):**
    *   通常不应有 `content: 'inline*'`。
    *   其 `group` 应包含 `'block'` (如果它是块级的)，并根据需要加入自定义组别名。
    *   其 `priority` 通常不需要很高。

## 6. 调试技巧

*   **检查编辑器 Schema:**
    *   在浏览器控制台中，访问 `editor.schema.spec.nodes` 和 `editor.schema.spec.marks` 可以查看最终生成的节点和标记规范。
    *   检查 `editor.schema.nodes.[nodeName].groups` 可以看到某个节点实际属于哪些组。
    *   使用 `editor.schema.defaultTextblockType()` (如果可访问) 或通过观察行为来推断哪个块被选为默认文本块。
*   **ProseMirror Dev Tools (浏览器扩展):** 非常有助于检查当前文档的节点结构、选区、事务等。
*   **逐步简化:** 当遇到问题时，尝试临时移除一些扩展或简化 schema，以定位问题来源。
*   **阅读 Tiptap 和 ProseMirror 文档:** 官方文档是理解核心行为的最佳来源。

---

希望这份指南能为您的项目提供清晰的指引！ 