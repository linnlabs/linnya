# Canvas 连线编辑

公开 `createCanvasConnectionEditing` 拥有选中线、标签草稿及端点手势；位置与几何消费kernel公开合同，保存只调用正式文档会话。标签编辑有独立字段声明与续约，失败保留草稿。

标签编辑的保护/保存屏障由 `createCanvasConnectionLabelEditing` 协调，端点手势只管理指针生命周期并交给 `commitCanvasEndpointGesture` 提交。浮条避让的屏幕投影在纯函数 `projectCanvasConnectionToolbar` 中计算；不在 UI 或 Store 中另算几何。

选择、属性、标签和端点修改消费正式元素修订号；显示几何取kernel.readEdgeGeometry，不另算多线排开后的标签位置。标签与端点在编辑开始时保护实际字段，每两秒续约，结束或取消释放。冲突保留标签草稿，用户动作的跳过结果由CanvasDocumentSession明确报告。

卡边圆点开始连线；已有端点拖到空白时变为自由点。新线拖到空白只要求textCreation开始临时草稿，不能提前创建空卡或用删除补偿取消。唯一正文编辑器由surface组合根连接，连线feature不直接访问Host编辑器。

`reverse()` 先完成当前标签保存，再读取最新选中线修订并提交交换from/to。完整端点包含固定边或悬空坐标，不重建线身份，不改方向枚举、标签、颜色或线型；锁定线须先解锁。纯命令 `buildCanvasConnectionReversal` 从本feature index公开，不建立Agent坐标入口。

`endpoint('from'|'to')` 只返回当前端点或null，不提交。Page/Surface据card端点定位稳定卡片ID，据point端点定位世界点；本feature不引入第二套相机导航或Host文档导航。右键/浮条可共用既有patch/remove/beginLabel和上述能力。

Canvas命中连线后，唯一只读标签面板以Renderer UI DropdownPanel展示当前canonical全文，可滚动、选字复制，普通文本插值不解释HTML。位图的200px拟合不影响该全文。Canvas到面板的120ms越过间隙只保留连线身份，修改/删除立即读取最新事实，失焦和销毁释放计时；Esc关闭回焦画布，搜索及加入对话快捷键继续走Page统一入口。
