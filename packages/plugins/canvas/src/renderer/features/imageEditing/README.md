# 图片属性编辑

选中单张未锁定图片后进入模态编辑：原图上拖出可见范围，键盘滑块调整四侧边界；图注、替代文字和替换图片在同一草稿保存。裁剪保存归一化可见范围及对应卡片矩形，保留源图在世界坐标中的比例和位置，不改变原始资产。恢复完整原图可还原裁剪前范围。替换保留当前卡片框与文字、清除旧图裁剪。

`orchestration/createCanvasImageEditing`拥有打开、准备资产、数据字段声明续约和提交过程；`store`只持有草稿，`functions`拥有裁剪和目标规则。新资产准备不建立引用，保存经正式Canvas session一次更新，归属与撤销由既有Backend事务维护。字段冲突、被锁定或被删除时保留草稿并显示错误；取消不提交，迟到异步结果不能恢复已关闭的草稿。

裁剪方式参考[tldraw图片数据模型](https://github.com/tldraw/tldraw/blob/main/packages/tlschema/src/shapes/TLImageShape.ts)的原资产与可见范围分离原则，不复制其实现。源图大小与媒体格式继续由Host图片资产合同决定。
