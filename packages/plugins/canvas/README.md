# Canvas

Canvas 是自由画布文档插件。后端逐元素保存当前事实，Renderer 的 scene、缩略图与编辑器均是它的投影。Markdown 是 Agent 阅读与 CLI 正文写入的交换格式，不是可整份覆盖的画布文件。

## 边界与入口

- `shared/model` 拥有卡片、连线、正文及提交快照合同；类型来自唯一 schema。
- `backend/features/canvasCommit` 拥有当前内容的提交，跨 feature 步骤由 backend orchestration 装配。
- `renderer/kernel` 只处理绘制与交互意图；Host 能力由适配器注入。
- 包外只消费 shared/backend/renderer 与测试专用 backend-test-support 入口，不 deep import。
- 文档引用、图片资产、历史保留、正文编辑器与 Conversation 权限仍由各 Host owner 通过窄门面提供。

## 数据规则

卡片 ID 为画布内稳定的 `cN`，线为 `eN`；ID 永不复用。元素 revision、画布 sequence 与历史版本身份独立。相机和选择不进入文档内容。每个写请求必须有稳定请求 ID，重试复用，不能靠相同内容猜测重试。

没有任务级文件锁。并发冲突按字段及实体依赖判断；当前编辑字段受保护。Agent 改动按对话与画布归组，用户撤销与组撤回分开；选择性撤回保留其他来源的后续修改。

## 用户撤销

`createCanvasHistoryRuntime` 由 Backend 按数据库实例创建，用户栈按文档与视图隔离，视图退出时释放；Agent 写入不进入用户栈。连续自动保存通过调用方传入同一个 `historyGroupId` 归为一步。`undo` 接受稳定请求编号与方向，返回提交回执及当前可撤销/可重做状态；重试不再次移动栈。

每个字段分开保存最后写版本与逻辑来源。撤销恢复旧逻辑来源，但修订号与字段版本继续增加，因此连续撤销能找到上一步，Agent 的过期写入仍会被拒绝。重做只反转实际撤销的子集。新增对象被其他来源修改或连接后整体保留，删除恢复必须匹配仍受历史记录持有的删除身份。删除身份不是正式元素或永久墓碑：用户栈退出、记录淘汰时回收。

提交参与者收到可信 `CanvasCommitContext`，在调用方同步 SQLite 事务内登记引用、资产等事实；发布只在事务成功后发生。同步日志最多 512 批；`readCanvasSynchronization` 遇到缺口或裁剪返回当前快照，日志不能承担撤回记录。

## 验证

插件自身提供 typecheck、test、lint、build 入口。测试覆盖真实提交/重开、失败回滚、并发/撤回与插件生命周期；技术探针放在 `dev/probes`，本地结果不成为构建依赖。插件不属于默认官方发行目标。

## Renderer

`renderer/features/canvasDocument` 拥有每个表面的已提交文档会话。打开前先订阅变更，再读取快照并追平读取窗口中的版本；提交和 push 均从 `canvas:changes` 接纳连续增量或日志裁剪后的正式快照。旧表面的异步结果不会写入新会话。`cardEditing` 独立持有输入草稿、组合输入状态及保存屏障，失败时保留正文，自动保存不结束同一次文字编辑撤销组。

`renderer/orchestration/createCanvasSurface` 只装配文档端口、嵌入编辑器、选择及绘制；生产 Host 与 Electron 探针可以注入同一组窄合同。文件会话切换和手动保存通过保存参与端口等待草稿落盘。kernel 只产生交互意图和显示预览：3px 后才拖动，松手提交一次，Escape/失焦取消。框选默认触碰选中，Cmd/Ctrl 改为全包含；Shift 追加。

可见正文走 portable Markdown DOM 与同一排版 class，经共享光栅队列只生成可见区域的 4096px 分块。Bitmap 所有权转交 kernel，主题/正文版本改变会重建；材质仅修改边框背景，不重建正文纹理。正文为 14px、1.7 行高和 16/18/18px 内边距。相机、选择和用户材质偏好不写进画布内容。
