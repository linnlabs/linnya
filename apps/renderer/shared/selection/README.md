# Shared Selection

`shared/selection/` 只承接跨业务稳定的列表选择基础规则。目前的唯一能力是：把有序 ID 列表中由锚点和目标确定的闭区间，并入已有选择。

## 边界

- 共享层负责区间定位、正反向归一化、去重和合并。
- 各 domain 负责决定单选、切换选择、Shift 优先级、锚点来源以及状态写入。
- 锚点或目标不在有序列表时，共享函数返回 `null`，不猜测业务 fallback。

文件列表与对话列表必须通过 `mergeOrderedSelectionRange` 复用同一范围算法，不能在 store、Vue 组件或 domain functions 中再次实现索引循环。
