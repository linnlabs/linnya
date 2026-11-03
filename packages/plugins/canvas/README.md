# Canvas

Canvas 是自由画布文档插件。后端逐元素保存当前事实，Renderer 的 scene、缩略图与编辑器均是它的投影。Markdown 是 Agent 阅读与 CLI 正文写入的交换格式，不是可整份覆盖的画布文件。

框选加入Conversation后，引用chip通过通用kind挂载点按需读取当前已提交选区供只读hover预览；关闭释放实例，异步切项目不显示旧正文。点击先复核画布当前归属，再打开并定位仍存在的卡片。hover不保存编辑草稿，也不修改发送快照；发送继续通过`prepareForSend`等待草稿保存并读取最新内容。

选中图片卡可打开[图片属性编辑](./src/renderer/features/imageEditing/README.md)，非破坏性裁剪、图注与替换保存为一次正式内容变更，并进入现有用户撤销链。

## 边界与入口

- `shared/model` 拥有卡片、连线、正文及提交快照合同；类型来自唯一 schema。
- `backend/features/canvasCommit` 拥有当前内容的提交，跨 feature 步骤由 backend orchestration 装配。
- `renderer/kernel` 只处理绘制与交互意图；Host 能力由适配器注入。
- 包外只消费 shared/backend/renderer 与测试专用 backend-test-support 入口，不 deep import。
- 文档引用、图片资产、历史保留、正文编辑器与 Conversation 权限仍由各 Host owner 通过窄门面提供。

当前内容提交及纯规则的职责见 [canvasCommit owner](./src/backend/features/canvasCommit/README.md)。

## 数据规则

卡片 ID 为画布内稳定的 `cN`，线为 `eN`；ID 永不复用。元素 revision、画布 sequence 与历史版本身份独立。相机和选择不进入文档内容。每个写请求必须有稳定请求 ID，重试复用，不能靠相同内容猜测重试。

没有任务级文件锁。并发冲突按字段及实体依赖判断；当前编辑字段受保护。Agent 改动按对话与画布归组，用户撤销与组撤回分开；选择性撤回保留其他来源的后续修改。

## 用户撤销

`createCanvasHistoryRuntime` 由 Backend 按数据库实例创建，用户栈按文档与视图隔离，视图退出时释放；Agent 写入不进入用户栈。连续自动保存通过调用方传入同一个 `historyGroupId` 归为一步。`undo` 接受稳定请求编号与方向，返回提交回执及当前可撤销/可重做状态；重试不再次移动栈。

每个字段分开保存最后写版本与逻辑来源。撤销恢复旧逻辑来源，但修订号与字段版本继续增加，因此连续撤销能找到上一步，Agent 的过期写入仍会被拒绝。重做只反转实际撤销的子集。新增对象被其他来源修改或连接后整体保留，删除恢复必须匹配仍受历史记录持有的删除身份。删除身份不是正式元素或永久墓碑：用户栈退出、记录淘汰时回收。

提交参与者收到可信 `CanvasCommitContext`，在调用方同步 SQLite 事务内登记引用、资产等事实；发布只在事务成功后发生。同步日志最多 512 批；`readCanvasSynchronization` 遇到缺口或裁剪返回当前快照，日志不能承担撤回记录。

## 验证

插件自身提供 typecheck、test、lint、build 入口。测试覆盖真实提交/重开、失败回滚、并发/撤回与插件生命周期；技术探针放在 `dev/probes`，本地结果不成为构建依赖。插件不属于默认官方发行目标。

[Canvas Regression](../../../.github/workflows/canvas-regression.yml) 在 macOS、Windows、Linux 分别验证业务结果与离屏绘制的确定性工作量；Linux不代表新增Desktop发行平台。共享CI不比较帧耗时，也不能代替真实GPU、输入法和屏幕交互验收。固定模型任务与完整证据的评分入口见 [Agent验收](./scripts/agent-evaluation/README.md)；模型评测与无凭据CI分开运行。

## Renderer

单张文档卡近景聚焦时，通过Host公开挂载门面显示只读全文或类型owner详情；远景、框选和文字编辑期间仍保留位图。挂载取消、项目边界与相机分流见[文档详情](./src/renderer/features/documentDetail/README.md)。

`renderer/features/canvasDocument` 拥有每个表面的已提交文档会话。打开前先订阅变更，再读取快照并追平读取窗口中的版本；提交和 push 均从 `canvas:changes` 接纳连续增量或日志裁剪后的正式快照。旧表面的异步结果不会写入新会话。`cardEditing` 独立持有输入草稿、组合输入状态及保存屏障，失败时保留正文，自动保存不结束同一次文字编辑撤销组。

`renderer/orchestration/createCanvasSurface` 只装配文档端口、嵌入编辑器、选择及绘制；生产 Host 与 Electron 探针可以注入同一组窄合同。文件会话切换和手动保存通过保存参与端口等待草稿落盘。kernel 只产生交互意图和显示预览：3px 后才拖动，松手提交一次，Escape/失焦取消。框选默认触碰选中，Cmd/Ctrl 改为全包含；Shift 追加。

可见正文走 portable Markdown DOM 与同一排版 class，经共享光栅队列只生成可见区域的 4096px 分块。Bitmap 所有权转交 kernel，主题/正文版本改变会重建；材质仅修改边框背景，不重建正文纹理。正文为 14px、1.7 行高和 16/18/18px 内边距。相机、选择和用户材质偏好不写进画布内容。

图片卡的受管显示源、归一化裁切和底部说明使用 `cardRendering/content` 的同一 DOM 投影及公开媒体样式，前台与后台出图一致。后台指定区域按输出长宽等比居中，边界不添加整图适配留白；导出倍率不受交互相机缩放范围限制。

文档卡也使用同一纯DOM投影：标题、无封面摘要、封面及不可用状态。Worker只消费请求中明确提供的授权`summary`和`previewStatus`；引用权限状态优先于迟到的预览状态，失去访问权时不显示旧摘要或图片，缺metadata仅显示不可访问身份牌。

## Agent 改动与确认

Backend 按数据库实例持有 `createCanvasHistoryRuntime`。组合入口位于 `backend/orchestration/history`；用户栈与 Agent 组共用 `backend/shared/history` 的字段片段及逆变更规则。`agentChanges` 只拥有持久组、待确认批次与审批回执。组按对话与文档累计，子 run 共享组；没有对话的开发 CLI 使用该画布的命令行组。对话身份没有外键，删除对话不丢撤回记录。`closeGroup` 关闭当前组，后续写入创建新组。

`commitAgent` 返回 `committed` 或 `pending`。同一对话、请求编号的重试不受 run/工具视图变化影响；异载荷拒绝。删除用户创建的卡累计达到 20 张，或一批移动至少 20 张且覆盖当前用户卡九成时，整批保存为待确认。每组最多一批，新待确认替换旧批。只有可信 Renderer 入口调用 `resolveApproval`；CLI 不接收批准标志。批准按当前字段版本、编辑声明与预期删除修订重新验证；同意或拒绝后的重试有稳定结果。撤回或完成组使待确认过期。

组记录不依赖 512 批同步日志；进程重启后仍可撤回。`withdraw` 支持整组或元素子集，撤回本身进入发起视图的用户栈。新对象一旦被其他来源使用，整体保留；恢复删除对象使用原 ID，原位置被后来卡片占用时在四个方向中选择最近可用位置，并返回 `restored_nearby`。依赖消失或同方向线已存在时跳过，保留当前图。

`registerView` 幂等记录初开序号；`listGroups` 的 `deletedCards` 用于查看旧位置，`visibleDeletedCards` 仅包含当前打开后产生的删除框。这些可见删除框参与新卡避让，全部视图关闭后不留下隐藏障碍。`reviewElement` 只清除角标，不删除撤回记录；后续 Agent 再改该卡会重新标记。`retainedElements` 暴露用户栈和持久组仍持有的元素版本供资产 owner 计算保留集合。内容和组状态变化分别发布；调用方用 `groupsChanged` 接纳不增加内容序号的待确认、拒绝、完成和审阅状态变化。

## Host 文档与生命周期

Backend contribution 按数据库实例拥有文档运行态，停用释放定时器、编辑声明与用户撤销栈。创建在同步事务内维护 Workspace 节点、Canvas 当前内容和初始搜索快照；只读 VFS 投影不能被普通文本写入覆盖。正式写入将文档引用、受管图片归属和节点时间加入同一事务，Agent 的项目归属在最终提交时复核。成功后才发布内容序号；通知失败不伪称回滚。

搜索纯文本快照独立于历史版本：第一批脏内容启动 30 秒刷新，持续输入不会无限延后，关闭时刷新。引用投影使用 Workspace 当前路径；跨项目和已删除引用仅展示不可访问状态。快照按 UTF-8 限制为 1 MiB。Renderer `canvas:read` 可带视图身份登记删除框基线，`canvas:close` 释放视图。

历史面板经通用 documentHistory capability 读取摘要和恢复，Canvas 的 `history-preview` / `history-budget` 只传验证后的画布 DTO。恢复会话身份同时携带真实视图及该次草稿捕获编号，Backend 验证仍打开的视图，恢复推送回显完整身份；迟到的恢复结果不能清除后来的草稿。恢复前的脏内容与恢复结果均在同一内容事务形成检查点，恢复进入发起视图的用户撤销栈，保留既有 Agent 组。历史资产与当前内容、用户栈、Agent 组、待确认批次的可达集合一起登记/释放。详见 [版本历史 owner](./src/backend/features/canvasVersionHistory/README.md)。
CLI 的 `payloadIdentity` 由可信编排从原始 operations/options 构造，不能由模型填写 hash。`replayAgentRequest` 在 Markdown 解析、append 归一化、测高及资产接管前查询；原始身份与成功回执在同一事务保存，正文变更不会让同次 append 重试变成第二次追加。未传身份时仍以正式 operations 为准。`approvalResults` 提供当前对话最近 50 条审批状态，CLI 读操作可主动报告已允许、拒绝或过期结果。

文字卡自动高度复用 shared 的 `canvasAutomaticTextHeight`，手动缩放后持久化为 fixed；编辑器 DOM 测量和正文在同一次更新提交。正文、拖动、缩放分别持有字段保护 owner，同视图只向 Backend 发送这些 owner 的字段并集；结束其中一个动作不会清除另一个尚在进行的动作，长拖动和缩放持续续约。

图片卡与正文插图只持久化受管 assetId/稳定 src。Renderer 从正式图片端口读取临时 bytes，用有界缓存投影为 data URI，避免 media 协议在 HTML 光栅时空白；异步准备图片不提前建立归属。文档卡经通用候选与 preview 门面读取当前项目标题、封面和不可用状态，打开仍走 Workspace 导航。搜索由 shared 纯函数同时供 Renderer/CLI 消费，不把内部文档 ID 当作可见正文。

显示图片共享 `cardRendering/content.resolveCanvasDisplayImages`：串行解码并生成长边不超过2048的派生，原始资源不进入长期显示缓存；查看原图仍按需读取正式资产。图片归属和结构化正文不使用显示派生。可见文档预览最多4个并行，preview缓存按32 MiB/128项限制；远景仅按owner的 `overview:thumbnail` 声明保留小缩略，不推断具体插件或有图即缩略。标题、preview及在途结果随文档变更和插件可用性失效。

Renderer只读降级同时关闭编辑器、插图锚点、拖动/缩放、菜单和快捷键写入口，释放字段声明但保留已有正文草稿。软件GPU或WebGL恢复提示独立于正文错误。历史预览为独立只读表面；恢复发起窗口的viewId通过通用 `historyClientSessionId` 冻结传递，不能选择其他窗口的撤销栈。

加入对话使用一个 Canvas 选区引用；发送前先等待仍打开表面的草稿保存，再经 Backend 冻结一次最新提交内容。画布关闭后仍可刷新，失败不会回退加入时旧文字。引用记录文档和卡片身份，点击经通用 Workspace 导航打开并定位；同一选区通过通用 composer 去重键合并。复制含标签的子图时保留目标 documentId，但为每个新出现位置分配新的 referenceId，避免原子引用索引冲突。

部分所选卡删除时只发送仍存在的卡；全部删除时引用保留原始选择身份、显示已删除并发送该次提交的删除说明，不含旧正文。撤销删除后，同一引用可再次读取恢复的卡。复制/剪切没有有效元素时仍失败，不能用删除说明替换用户剪贴板。

## CLI 与自动布局

`linnya-canvas` 通过正式 Plugin CLI bridge 注入已冻结的项目、对话及 run 身份，路径解析和最终提交均复核项目归属。`read/show/find/neighbors/region/check/groups` 不创建写运行态；`apply` 先解析受管正文、批量真实测高，再作一次字段事务。`render` 只在授权 conversation 目录创建独占图像产物，返回正式 locator。Skill 维护模型可见语义操作合同，不开放磁盘数据库、批准标志或 Agent 坐标。

布局与检查在独立 Node worker 内执行，ELK 仅进入计算 worker 制品。取消、关闭视图和停用插件会终止未提交计算；最终提交保留已完成事实。新卡预测ID在进入事务前反绑本批临时名字，因此其他来源先分配同号卡也不会改错对象。期间尺寸改变、锁定、编辑声明及新增障碍按最新内容复核；布局只平移实际成功的目标组，不移动用户新增卡。

布局 `diagnostics` 描述本次计算窗口；命中正式请求回执时返回空诊断数组，提交序号、分配ID和逐操作结果仍复用原回执，不重新测量或运行布局。

Standalone `entry.command` 只提供 read/show/find/neighbors/region/check，显式指定 `--project`，可传 `--database`，用只读连接消费相同查询规则。help 不加载原生数据库；该制品不装配写入协调器、Agent审批或历史运行态。Agent facade 拒绝上述独立宿主参数；render 继续复用 App 已注册的正式 Hidden Worker。

## 格式与损坏隔离

当前内容格式为1。读取时仅把可验证的元素交给显示投影；未知类型、非法正文/字段版本/排序、坏分组及依赖隔离卡片的线保留原始SQLite行，并返回 `integrity` 诊断。出现任何此类问题或更高格式版本时整张画布只读，当前提交、撤销、批准与恢复共享提交入口并拒绝写入，避免老版本剥离未来字段。隔离只影响展示，不写占位节点、不回存过滤后的快照。未来增加真正内容格式迁移时，必须先用版本历史保留迁移前状态。

兼容策略参考 [Excalidraw对未知属性保留的修复](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/CHANGELOG.md) 与 [tldraw的schema迁移owner约定](https://github.com/tldraw/tldraw/blob/main/packages/tlschema/README.md)；本插件以只读和原始行保留避免静默损失。

## Renderer 写确认

同一表面把commit、undo、排布和Agent组撤回/批准放入写确认通道。运输结果不确定时，保留原调用与冻结负载并显示“重试确认”；只重发同一requestId，其他意图等待。已收到成功回执但补拉失败时只重试接纳，不再次发送写入。明确业务拒绝会释放通道并保留对应草稿；关闭使本地等待失效，不否认后台已成功事实。初次文字卡已经创建而关联线跳过时接纳真实卡片身份，准确说明部分成功。

一次多图片导入先完成全部资产准备，再共同提交全部卡片、归属和一次用户撤销；准备任一图片失败时不创建部分卡片。准备结果只保留稳定资产身份与尺寸，不在UI数组长期持有原图字节。初始图框尺寸由shared `canvasDefaultImageSize`计算。

图片等比框统一消费Host的`displayWidth/displayHeight`（已考虑EXIF方向）；`width/height`仍是资产编码身份，不因显示转正迁移旧ledger。Renderer导入、Backend导入和CLI预检/正式写入共用同一显示比例；既有卡片及替换时的用户卡框保持既定布局，裁剪仍按浏览器转正后的图像范围归一化。

历史恢复的 `clientSessionId` 是Canvas的opaque `[viewId,captureUUID]` token。Header打开历史时冻结正文、临时新卡、连线标签的编辑世代；正式恢复通知先同步提交，再仅清理仍匹配的草稿。重复通知和旧面板的迟到通知不会删除后来的输入，恢复不调用保存旧草稿的finish。预算从Backend正式状态读取并订阅变化，超过软预算会说明最近5版与仍可达资产的保留原因。

Canvas表面、正文编辑器和历史预览统一读取Renderer UI公开的 `RENDERER_UI_THEME_ATTRIBUTE`，并监听同一属性。`moon-blue`依据Renderer UI正式语义仍使用浅色纸张；不能通过历史data-theme或dark class猜测当前主题。

键盘与读屏通过同一选择/导航流程工作：搜索定位既支持卡片也支持线标签，关闭搜索/右键菜单和结束标签编辑会回焦画布；选中摘要复用正文搜索投影和当前可访问文档标题，限制朗读长度，不输出目标内部ID。失败草稿可显式选择“使用已保存内容”，经危险操作确认后仅放弃本地草稿；写入进行中或结果待确认时禁止放弃，不自动重载覆盖。

默认模式Tab/Shift+Tab按卡片顺序阅读，首尾可退出到浏览器正常焦点顺序；Command/Control加方向键选择最近的对应方向卡片，读屏同时播报卡片世界位置。树模式Tab创建子节点保持不变。导航只平移显露目标，不改变缩放倍率，详见[键盘与可读选择](./src/renderer/features/accessibility/README.md)。

Agent几何动效只消费正式增量中每张卡最后一次来源；用户提交、初次读取和日志缺口的全量快照不猜测动画。会话原子保存当前快照与有界的卡片来源事实，不为显示动效长期保留delta的旧正文。超过200张受影响Agent卡采用整批动效，连线不计入卡数。定位使用共享纯相机拟合与320ms飞行，用户按下指针立即停在当前相机。

动画中开始拖动在真正越过3屏幕像素后冻结视觉起点，显示预览和最终绝对位置使用同一基准；松手按最新正式修订提交，不把delta再次叠到动画终点。Alt复制同样沿用视觉起点、保留最新内容。正文编辑、只读详情、缩放框及定位先完成目标卡的几何过渡，活DOM不会漂离纸面；单卡控制条跟随显示位置，多选不引入逐帧的大型DOM投影。

## 制品闭包

`pnpm run smoke:plugin:canvas:artifact`先构建schemas和Canvas独立制品，再用临时隔离根验证checksum/content BOM、正式disk Backend加载、Skill/worker/migration发现、无数据库的CLI help、编译CLI真实只读SQLite与写入拒绝、编译Node计算worker及正式Host HiddenWorker的PNG/JPEG/取消/字体/标签/图片路径。临时制品根与数据库测试后删除；Canvas不进入默认官方发行目标。

三个Node entry各有独立esbuild元数据，main/CLI/compute初始预算分别3/3.2/5 MiB。ELK只进入计算worker；main/CLI拒绝Pixi、Renderer和Host业务装配。CLI仅内联两个公开只读SDK入口，虚拟Host specifier不得留到独立进程；native模块保留懒加载并通过正式CJS Host白名单解析。公开barrel产生的空初始化闭包可保留，但输出AST必须证明未保留可执行写函数体。Renderer、HTML worker、CSS与字体引用均验证实际zip闭包，不把开发探针、元数据或源码混进制品。独立读取使用产品提供的Electron Node ABI，help也可由普通Node运行。

交互显示与提交保持分离：吸附只在不超过3000个其他可见候选时开启，8屏幕像素阈值同时给出非持久参考线，Alt/取消/结束清除。连线卡身落点保存auto，16屏幕像素圆点保存固定边；开始抓手只影响临时新卡朝向，起点仍自动。上下文创建在打开选择器前冻结世界位置；文档选择和图片准备不会改成新的视口中心。对齐和等距分布跳过锁定卡，线菜单支持反转和端点导航。

进入文字编辑时，低于30%先定位长卡顶部并放大到100%，随后等待正文当前倍率的精确位图接纳，再开启唯一DOM编辑器；切换选择或关闭会取消迟到的进入请求。精确位图能力失败时明确说明并继续正文编辑。线工具条按中点四方向和三档间距避让卡片、线与标签。

正文编辑层通过embedded Markdown的通用onNavigate消费捏合与空格/中键平移，复用kernel同一相机纯函数；普通滚动仅滚正文。浏览器无法确定鼠标或触控板，连续离散滚轮仅触发一次本机提示，不自动改偏好，捏合永远缩放；明确接受后才启用普通滚轮缩放。[WheelEvent单位](https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent/deltaMode)不能作为可靠设备身份。连线拖动在目标卡显示同一kernel描边及四个圆点，右键属性共用正式线patch入口。
