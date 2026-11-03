# Canvas 卡片编辑动作

公开 `createCanvasElementActions` 消费正式文档会话和选择端口，所有动作最终走同一用户提交，不能直接改scene或持久化内容。纯计划入口公开 `buildAlignCommands`、`buildDistributeCommands`、锁定与层级规则，供菜单/键盘复用。

`align` 支持left/center-x/right/top/center-y/bottom及grid；按可移动选择的真实尺寸对齐边或中心。`distribute(horizontal|vertical)` 按实际宽/高计算相同间隙，保持两端卡位置，至少3张可移动卡才有内部可分布对象。空间不足时允许负间隙，不擅自扩展两端或改变卡片大小；需要消除重叠时使用自动排布。锁定卡和选区外卡不移动，原位卡不生成多余修订。

复制通过clipboard公开子图计划保留卡片样式和内部连线；每个标签出现位置分配新referenceId，目标documentId及assetId保持稳定。一次对齐、分布或复制只提交一批，撤销归正式用户会话。
