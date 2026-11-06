# Canvas version history

本 feature 拥有持久化版本与反向字段增量，不拥有用户撤销栈、Agent 变化组、Workspace 引用表或资源字节。当前内容始终来自元素行；视口、选区、缩略图、线路径和隔离显示投影不进入历史。

## 提交与身份

`recordCommit` 在当前内容的同一 SQLite 事务里接收标准 `CanvasHistoryCommitInput`，保存回到上个恢复点所需的字段值。失败抛错回滚整批；返回的 afterCommit 才设 timer 和发布预算状态。移动不会重复写未修改正文。

开组前恢复点由历史编排的 `groupStarted` 事件调用 `checkpoint`，只在 Agent 组真正新建并保存的同一事务内触发。普通提交使用 history.before；待审批使用尚未写入的严格状态。全跳过也可能正式建立结果组，必须保留该时刻的恢复点，不能等首次实际内容写入。审批替换、拒绝、重放及撤回后仍存在的老组不重复触发；失败则组与恢复点一起回滚。checkpoint 自己初始化尚无 head 的基线，不另猜历史事实；维护与通知仍由成功事务后的现有回调调度。

版本身份为文档范围内的 canvas-version:sequence。未到恢复点时，列表有一个持久 current 内容对应的 live 元数据项；保存恢复点后仍是同一身份，不因 timer 导致无内容变化的恢复冲突。版本时间是实际内容提交时间，sequence 与版本身份、元素 revision 的职责分开。列表只读元数据列，不读取 BLOB。

`initialize` 首次创建完整基线；既有基线不重复创建。`checkpoint` 支持可信 snapshot，用于已进入 current 事务的开组前版本与恢复版本。普通恢复点为停手约三十秒、关闭、开新 Agent 组前，连续编辑最长十分钟。迁移调用 reason=migration，当前恢复点即使未变也补完整锚点；当前只实现 canonical format 1，不臆造更早格式转换。

## 反放、锚点与裁剪

每个恢复点保存 SHA-256，字段逆增量累计压缩字节超过完整快照时补锚点。锚点可独立预览，普通反放遵循实际 previous 身份，不按 sequence 减一猜父版本。维护先校验链元数据并计算保留计划；没有实际删除就不解码快照或改写版本载荷。裁剪只接纳并合并跨越删除区间的逆增量，不重新 diff 整张画布；仍相邻的记录保持原对象与载荷。最旧保留点改变时才按预览同一路径验证并生成该点的一张锚点，不在内存里保存全部版本快照。版本身份和hash不变，未涉及的旧载荷仍在真正预览时接纳，不把维护当全库完整性审计。

保留决策通过 Core documentHistory 计划。默认软预算一百 MiB，最近五版始终保留；计算值包含持久压缩载荷/序列化元数据与仅历史持有的资源事实，不把 SQLite 空闲页当作可回收字节。共享历史资产只计一次，分配给最新保留的持有版本，避免删旧版本就误以为仍共享的资源已经释放。重链后重算实际载荷，再向 Core 请求必要的进一步裁剪；不能以重链前估算冒充最终预算。超预算通过 budgetStatus / budgetChanged 明确返回。

Host 窄 port 提供 protectedAssetIds（current、undo、groups、pending）、实际 assetByteFacts 及同事务 reconcileHistoryAssets。缺失事实失败，禁止按零字节处理。重链、删旧版本与资产归属变更同事务回滚，其他文档的资源不受影响。成功保存之后的 checkpoint/compact 失败只报告并保留既有历史；不回滚已经提交的内容。

## 恢复与接线

`prepareRestore` 返回经过验证的目标 snapshot 与真实来源摘要；正式恢复仍经可 Cmd+Z 的 user transition，保留 open Agent groups。最终事务再次 assertCurrent，并把目标 elements 作为可信 retainedElements 交给 Host 引用登记。恢复的 onCommit 在外层 recordCommit 之后同事务 checkpoint 并保存 restoredFrom，不能在提交后另行补来源。恢复不回滚被引用的文档。

组合层负责传入严格完整 current snapshot（由 readCanvasCommitState 构造），不能传 readCanvasSnapshot 的只读隔离投影。close/dispose 刷恢复点；新恢复点、超预算或历史持有者释放才安排独立维护，普通Agent写入和角标审阅只通知组状态，不启动全历史整理。停用时取消timer并完成同步维护。

编码只接收已规范化的快照或严格逆增量；使用JSON标准replacer稳定对象键顺序，不为每次hash/压缩重复做JSON往返和通用schema克隆。未发布开发态的旧数据在初始化schema收敛时重建，不在读取路径兼容旧哈希算法。

实现参考了 [tldraw 的 RecordsDiff](https://github.com/tldraw/tldraw/blob/main/packages/store/src/lib/RecordsDiff.ts) 对差分合并/反放的分离，以及本仓 Slides 的 source-history 校验与维护纪律。这里只借鉴行为和边界，没有引入外部 store、CRDT 或历史依赖库。
