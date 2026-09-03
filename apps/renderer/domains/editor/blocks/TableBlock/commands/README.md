# 表格命令模块结构说明

本目录包含表格操作的各种命令，采用模块化设计以提高可维护性。

## 文件组织

### 集中导出和注册

- **index.js**
  - 统一导出所有表格相关命令
  - 作为命令的统一访问入口
  - 便于其他组件直接导入命令函数

- **registerTableCommands.js**
  - 负责将命令注册到编辑器实例
  - 提供模块化的注册函数
  - 被TableBlock.js中的addCommands()方法调用

### 核心实现文件

- **tableCoreOperations.js** (原 tableOperationCommands.js)
  - 包含表格核心操作的底层实现逻辑
  - 这些函数返回命令执行逻辑
  - 直接操作 ProseMirror 文档模型、处理节点位置和事务映射

### 工具栏封装文件

- **tableToolbarCommands.js**
  - 提供表格工具栏的高级命令封装
  - 不包含实际实现，只是调用已注册的编辑器命令
  - 提供错误处理和执行状态管理等额外功能

- **tableCommandChainRunner.js**
  - 统一运行 toolbar-facing 的 `editor.chain().focus().xxx().run()`
  - 以 `run()` 的真实布尔返回值作为成功标准
  - 避免 selection / hydrate 条件不满足时命令 no-op 却被封装层误报成功

- **tableCellContentAggregation.js**
  - 负责多个 `tableCellContentBlock` 的内容聚合
  - 纯 ProseMirror 文档结构逻辑，不依赖 toolbar / Vue / DOM
  - 多个 cell 同时需要聚合时从后往前替换，避免事务内位置偏移

- **tableCellContentNormalization.js**
  - 负责 tableCell / tableHeader 的内容结构不变量
  - 将空 cell、旧版非标准子节点、多个内容块、缺失 id / blockType 的内容块统一收敛为一个 `tableCellContentBlock`
  - split / merge / 后续 paste 或 legacy 修复都应优先走这个入口，命令层不直接拼接 cell 内容

- **tableColumnInsertion.js**
  - 负责列插入的 TableMap 逻辑
  - 适配 ProseMirror tables 的 colspan/rowspan 算法，同时创建 Linnya 标准 `tableCellContentBlock`
  - 插入列时按逻辑列判断：插入点落在已有 colspan 内则扩展 cell，否则插入新的物理 cell

- **tableRowInsertion.js**
  - 负责行插入的 TableMap 逻辑
  - 适配 ProseMirror tables 的 rowspan/colspan 算法，同时创建 Linnya 标准 `tableCellContentBlock`
  - 插入行时按逻辑行判断：插入点落在已有 rowspan 内则扩展 cell，否则在新行创建对应物理 cell

- **tableColumnDeletion.js**
  - 负责按逻辑列索引删除列
  - 直接使用 TableMap + `removeColumn`，不再把列索引转换成 `CellSelection`
  - 避免第 0 行存在 colspan 时，按索引删一列被误扩大成删除整个跨列 cell 的矩形范围

- **tableFillTargets.js**
  - 负责把批量填充的逻辑行列解析为真实物理 cell 的内容范围
  - 读取已有 cell 覆盖关系时走 `getCellOffsetAtLogicalPosition`，不再用 `rowNode.child(columnIndex)` 猜物理节点
  - 对 rowspan 覆盖到多行的同一个物理 cell 做去重，避免一次填充重复改写同一个 cell

### 专项功能文件

- **tableAlignCommands.js** - 处理单元格对齐相关命令
- **tableCellCommands.js** - 处理单元格合并与拆分；命令层只触发规范化模块，不内联拼接内容块
- **tableDeleteCommands.js** - 处理删除行列操作；按索引删列委托给 `tableColumnDeletion.js`
- **tableFillCommands.js** - 处理数据填充相关功能；目标解析委托给 `tableFillTargets.js`

## 命令执行流程

1. 用户在 `TableFloatingToolbar.vue` 中点击按钮
2. 调用 `tableToolbarCommands.js` 中的函数 (如 `addColumnBefore`)
3. 这些函数通过 `tableCommandChainRunner.js` 使用 `editor.chain().focus().addColumnBefore().run()` 调用编辑器命令，并向上返回真实执行结果
4. 编辑器执行注册的 `addColumnBefore` 命令
   - 这些命令通过 `registerTableCommands.js` 注册到编辑器上
   - 最终执行 `tableCoreOperations.js` 中的实际实现

## 添加新命令指南

添加新的表格命令时，请遵循以下步骤：

1. 根据功能性质，在适当的核心文件中添加底层实现
2. 在 `registerTableCommands.js` 中注册新命令
3. 将新命令导出到 `index.js`
4. 在 `tableToolbarCommands.js` 中添加封装函数（如需要）
5. 封装函数必须尊重 `chain().run()` 的返回值；失败路径不能继续安排异步修复或 UI 成功态
6. 如果命令会改变 cell 内部内容结构，优先把结构规则放进纯模块（参考 `tableCellContentNormalization.js`），避免 UI / 命令层重复持有位置和拼接规则
7. 如果命令按行列读写已有单元格，必须通过 TableMap 逻辑坐标 helper 解析物理 cell；不要把逻辑列索引直接传给 `rowNode.child(index)`
8. 在 `TableFloatingToolbar.vue` 中使用该命令
