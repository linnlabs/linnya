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

## Agent 改动与确认

Backend 按数据库实例持有 `createCanvasHistoryRuntime`。组合入口位于 `backend/orchestration/history`；用户栈与 Agent 组共用 `backend/shared/history` 的字段片段及逆变更规则。`agentChanges` 只拥有持久组、待确认批次与审批回执。组按对话与文档累计，子 run 共享组；没有对话的开发 CLI 使用该画布的命令行组。对话身份没有外键，删除对话不丢撤回记录。`closeGroup` 关闭当前组，后续写入创建新组。

`commitAgent` 返回 `committed` 或 `pending`。同一对话、请求编号的重试不受 run/工具视图变化影响；异载荷拒绝。删除用户创建的卡累计达到 20 张，或一批移动至少 20 张且覆盖当前用户卡九成时，整批保存为待确认。每组最多一批，新待确认替换旧批。只有可信 Renderer 入口调用 `resolveApproval`；CLI 不接收批准标志。批准按当前字段版本、编辑声明与预期删除修订重新验证；同意或拒绝后的重试有稳定结果。撤回或完成组使待确认过期。

组记录不依赖 512 批同步日志；进程重启后仍可撤回。`withdraw` 支持整组或元素子集，撤回本身进入发起视图的用户栈。新对象一旦被其他来源使用，整体保留；恢复删除对象使用原 ID，原位置被后来卡片占用时在四个方向中选择最近可用位置，并返回 `restored_nearby`。依赖消失或同方向线已存在时跳过，保留当前图。

`registerView` 幂等记录初开序号；`listGroups` 的 `deletedCards` 用于查看旧位置，`visibleDeletedCards` 仅包含当前打开后产生的删除框。这些可见删除框参与新卡避让，全部视图关闭后不留下隐藏障碍。`reviewElement` 只清除角标，不删除撤回记录；后续 Agent 再改该卡会重新标记。`retainedElements` 暴露用户栈和持久组仍持有的元素版本供资产 owner 计算保留集合。内容和组状态变化分别发布；调用方用 `groupsChanged` 接纳不增加内容序号的待确认、拒绝、完成和审阅状态变化。
