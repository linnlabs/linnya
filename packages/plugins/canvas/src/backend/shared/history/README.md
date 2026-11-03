# Canvas 选择性历史逆转

用户 undo/redo 与 Agent 组撤回共用同一逆转规则，公开入口为本目录 `index.ts`。历史片段保存实际变更字段及其逻辑来源；字段版本始终递增，恢复旧值不授予旧 Agent 覆盖权限。redo 仅针对上次 undo 实际生效的片段。

- `findProtectedCanvasHistoryCreations` 先计算后来使用关系的保护闭包；新卡被其他来源使用后，整张卡与其必要的新卡依赖保留。
- `reverseCanvasHistoryRecords` 分别决定新增、删除、字段编辑的逆转结果，只读取当前计划状态；删除还核对有限生命周期的来源 guard，恢复卡片在原位被占用时选择附近空位。
- `planCanvasHistoryReversal` 按“撤新边、恢复旧卡、恢复字段、撤新卡、恢复旧边”应用决定，再验证整图，保留可信历史元素供 Host 核验引用身份。

编辑 claim 阻止相应字段被逆转；后续独立写入、实体存在性变化及外部边都保留。删除 guard 只服务仍活跃的撤销/组历史，不能作为永久实体墓碑。真实交错写入、连续撤销及 Agent 组撤回由对应 feature 的 SQLite 业务测试与固定种子的 60 组交错序列验证。
