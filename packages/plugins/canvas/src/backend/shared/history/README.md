# Canvas 选择性历史逆转

用户 undo/redo 与 Agent 组撤回共用同一逆转规则，公开入口为本目录 `index.ts`。历史片段保存实际变更字段及其逻辑来源；字段版本始终递增，恢复旧值不授予旧 Agent 覆盖权限。redo 仅针对上次 undo 实际生效的片段。

- `findProtectedCanvasHistoryCreations` 先计算后来使用关系的保护闭包；新卡被其他来源使用后，整张卡与其必要的新卡依赖保留。
- `reverseCanvasHistoryRecords` 分别决定新增、删除、字段编辑的逆转结果，只读取当前计划状态；删除还核对有限生命周期的来源 guard。
- `planCanvasHistoryReversal` 按“撤新边、恢复旧卡、恢复字段、撤新卡、恢复旧边”应用决定，再验证整图，保留可信历史元素供 Host 核验引用身份。`positionCanvasHistoryRestorations` 在整批最终集合上为真正被后续卡片占位的复活卡选择附近空位，本批即将删除或移走的卡片不构成障碍。

编辑 claim 阻止相应字段被逆转；后续独立写入、实体存在性变化及外部边都保留。删除 guard 只服务仍活跃的撤销/组历史，不能作为永久实体墓碑。真实交错写入、连续撤销及 Agent 组撤回由对应 feature 的 SQLite 业务测试与固定种子的 60 组交错序列验证。

字段逆转复用当前提交的语义单元：自动文字data/width/height、图片裁剪或资产与frame、二维位置/尺寸、交换的端点成组判断。来源检查包含未改动的依赖字段；例如后来改宽并重测过高度时，不恢复与该高度不匹配的旧正文，也不重写后来的高度，独立颜色仍可撤。`dependent_field_changed`及逐字段结果说明这种保留；旧记录缺前后来源事实时明确`history_dependency_unknown`并保留，不伪造测量或baseline来源。逻辑来源已经通过另一次撤销回到原状态时可重新满足依赖，不能用单调修订号误挡真正的历史逆转。
