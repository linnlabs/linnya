# Scene motion planning

`planCanvasSceneMotion`
只把明确指定的卡片ID及前后逻辑快照转换为动画意图，不认识 Host、提交来源、Pixi、Vue 或真实显示状态。来源过滤由调用方完成，实际 display 起点、取消与重新定向由动画引擎负责。

先对 animateIds 去重，排除 protectedIds 与前后都不存在的ID。普通批次只产生新增160ms、xy移动220ms、删除120ms；单纯正文、染纸、尺寸等变化不产生场景移动。明确 batch 或有效ID超过200时，新增和现存卡统一 batch200ms，删除仍标 remove但时长200ms，避免逐卡滑动或scale。200张仍属于普通批次。

受保护卡先过滤，不参与大批次阈值。结果保持首次指定ID顺序，输入快照和集合均不修改。公开单条类型为 CanvasSceneMotionPlan；减少动态、当前正在拖动/编辑等具体状态由调用方决定是否提供动画ID及protectedIds，不能在纯规则里猜测来源或UI状态。
