# Asset 身份、归属与本地图片登记

本文是 Linnya asset domain 的稳定总领文档。它说明 `assets`
账本表达什么、项目/文档/会话引用如何分离、不同来源的本地图片如何登记，以及 Agent 读取前为什么仍需重新验证内容。

Asset
domain 只管理资源身份与可验证内容事实，不拥有项目侧栏、会话消息、Slides 或 provider 协议。跨 domain 的归属关系由调用方通过明确 workflow 建立，不能塞进一个“顺便登记”的通用函数。

## 身份与归属是两层事实

文档版本清理由插件判断自身历史可达性，通过 `@plugin/backend/documentAssetOwnership` 精确释放文档与资产的关联。
Host 实现位于 `application/document-assets`，只删除指定 `document_asset_links`，不删除资产账本或物理文件，
其他文档、项目和会话引用不受影响。插件须串行协调新资产接管、提交前复核和持久重试；
详见 [文档历史](../document-history/README.md)。

`assets` 是全局资源事实账本，一行只回答：

- 资源 ID 与无路径语义 URI；
- 真实媒体类型、字节数、尺寸和 SHA-256；
- 当前是否为本地内容以及 host-only 的物理路径；
- 首次登记时间。

它不回答“资源属于哪个项目或哪条消息”。归属由独立关系表达：

| 关系                             | 语义                                              | 写入方                                |
| -------------------------------- | ------------------------------------------------- | ------------------------------------- |
| `project_asset_links`            | 历史项目级 asset membership；本身不是项目文档身份 | 历史迁移或未来明确建模的项目 workflow |
| `conversation_event_asset_links` | immutable user/tool event 引用的附件              | EventStore 事务                       |
| `document_asset_links`           | 文档正文引用的资源                                | 对应文档 workflow                     |

因此，会话属于某个项目不代表会话附件自动进入项目资源库；工具生成了一张图也不代表它必须出现在侧栏。相反，同一个 asset 可以同时被项目、会话和文档引用，删除时必须检查所有引用面。

## 当前三类本地图片

| 来源                           | 物理生命周期                                                                          | asset 登记                                                                       | 默认项目归属                               |
| ------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------ |
| 用户粘贴、拖拽或选择的会话图片 | 复制到当前数据库绑定的 AppData `ConversationAttachments/v2/stores/<store-id>/content` | 随 user event 短事务登记                                                         | 无                                         |
| `generate_image` 生成图        | 写入当前 conversation 工作区 `generated-images/`；仅视觉模型回图时另存受管副本        | 仅 ToolNode 准入 `tool_result_image` 后经 managed image ingress 登记并签发 claim | 无；不自动写项目关系                       |
| Shell/CLI 工具派生图           | `read_file` 读取时复制到 AppData 受管内容存储                                         | host 在本次 tool call 中登记并签发 claim                                         | 无，随后由 tool event 建 conversation link |

会话附件的完整导入、回放和预览合同见
[`src/features/conversation/attachments/README.md`](../../features/conversation/attachments/README.md)。这里不重复拥有 draft、message
projection 或前端交互。

conversation 工作区只是生成过程的物理落点，不直接成为 durable
asset 读取边界。`generate_image` 只有在当前聊天模型支持工具结果图片时，才经
`managed-image-ingress`
复制受管副本、登记内容事实并签发 claim；非视觉模型的生成主结果仍由 conversation
locator 与 Renderer
media 表达。通用命令产物必须在显式读取图片时走同一受管入口。任意用户路径不能因为被写进
`assets.local_path` 就自动获得权限。

`features/generated-image-publication`
拥有生成图片首次暴露 conversation 路径前的发布动作：它从真实字节完成 magic
bytes 检查、完整解码、尺寸/hash/MIME 建立，再按正式媒体类型选择 `.jpg`、`.png`
或 `.webp` 扩展名并写入同名元数据。来源 URL、HTTP
`Content-Type`、provider 文件名和历史固定 `.png`
约定都不是媒体事实。该动作保留 provider 原始编码，不为了文件名一致而转码；多图生成使用独立发布身份，禁止同一毫秒结果互相覆盖。

Shell/CLI 产物把 `conversation:` locator 交给
`read_file`。JSON report 与图片 locator 都不声明媒体类型；App
Host 负责 locator 分派、work-directory 准入和真实内容识别，再把图片交给 managed-image
ingress，并按当前 conversation/tool call 签发一次性 claim。asset
domain 不解析文件 locator，也不认识 Slides 的目录名。该动作不写
`project_asset_links`；只有成功 tool event 会建立 conversation link。旧
`conversation_file://` 只存在于历史 replay。

## 本地生成图片登记

`features/asset-ledger` 拥有 `assets` 与稳定归属关系的核心 schema
contribution；这些表历史上误放在 Markdown
schema 中，现已按真实生命周期归回 Asset
domain。该迁移不修改表名、数据或物理数据库。

`features/local-image-registration` 是 asset 登记的 vertical slice：

```text
src/domains/assets/features/local-image-registration/
├── definitions/       # asset facts、ledger port、稳定错误
├── functions/         # content-addressed URI 纯规则
├── orchestration/     # 文件读取、真实解码与登记顺序
└── infrastructure/    # SQLite ledger adapter
```

登记分成两个明确阶段。文件系统 I/O 和图片解码不能占用数据库事务：

1. `lstat` 确认来源是普通文件，拒绝目录与符号链接。
2. 一次读取完整 bytes。
3. 通过共享 image inspection 依据 magic bytes + Sharp 完整解码 JPEG/PNG/WebP。
4. 从同一 buffer 计算字节数、像素尺寸和 SHA-256。
5. 构造不包含绝对路径的内容 URI。
6. 编排层把上述结果固化为不可变 asset facts。
7. SQLite adapter 在短事务内登记或复用 canonical
   asset，并验证已存在账本与本次事实完全一致。

文件名和扩展名不参与媒体事实。合法 PNG 即使错误命名为 `.jpg`，账本仍记录
`image/png`；伪造扩展名的非图片会在写 ledger 前失败。

相同内容再次由生成器产出时复用同一 asset ID，并把 `local_path`
更新到最新有效的 host 生成文件。这里允许更新路径，是因为内容 URI、长度、尺寸和 hash 已证明字节身份相同；不能用该行为替任意外部路径做“路径修复”。

## 受管图片副本

`shared/managed-image-storage`
是历史命名的 AppData 内容寻址存储边界，当前由会话图片、工具派生图片与 admission 后的
文档 SVG 共同使用。该层只发布已由上游 owner 验证的 bytes；raster image 与 SVG 的
媒体准入仍是两个独立 feature。当前可写布局是：

```text
<AppData>/ConversationAttachments/v2/stores/<store-id>/
├── staging/
├── pending/
├── content/<sha256 前两位>/<sha256>.<ext>
└── quarantine/
```

`features/managed-image-store-binding` 在当前 Workspace 数据库的
`asset_storage_bindings` 中持久化一次生成的
`store-id`。带绑定的数据库始终恢复自己的身份；没有绑定的新库或旧库会生成新身份。启动维护不能遍历、认领或删除其他 store 的内容。数据库与 AppData 副本一起迁移时，原 store 身份保持不变。只恢复数据库、不恢复对应 AppData 内容时，历史引用会明确显示不可用，不会猜测另一个目录中的同名文件。

会话模块原有路径 API 只是这组 asset 能力的兼容别名，不拥有第二套路径或发布规则。`ConversationAttachments/v1`
与 Workspace `ManagedAssets/v1`
都是不带 store 身份的历史只读边界；新内容不得再写入其中。

内容发布使用同一文件系统内的 staging hard
link，保证不会覆盖已有内容寻址目标。目标已存在时必须重新读取并核对 SHA-256；已损坏的同名目标会明确失败，不会被新上传静默修复。并发发布相同 bytes 则收敛到同一个最终文件。

发布者在创建正式 content 前先写入严格、版本化的 pending 凭证；凭证只保存当前 store 内的相对内容路径与预期 hash，不保存绝对路径。只有 asset
ledger 或 event/link 事务取得 durable 所有权后，调用方才完成该凭证。进程中断留下的显式 pending 会在下次启动按当前账本裁决：已登记内容只清凭证，未登记内容先移动到
`quarantine/`，隔离满 30 天后再删除。维护不扫描整个 `content/`
猜测孤儿，因此不能把“当前数据库不认识”误当作“任何数据库都不拥有”。

历史图片入口继续使用 `ManagedImage*` 名称；新 consumer 使用窄小的
`createManagedContentIdentity()` / `publishStagedManagedContent()`。这只是共享物理发布协议，
不是任意媒体 admission 或 media manager。

`features/managed-image-ingress`
面向 host 已选择的本地候选图片，固定执行：`lstat`
拒绝符号链接和超出注入字节预算的来源，再读取 bytes、真实解码、计算内容身份、复制到受管存储、登记 asset。对于调用方已经持有的内存图片，它也提供同一条 bytes
ingress；该入口仍在解码前执行字节预算，不能另建临时文件发布语义。两种入口最终共用同一内容寻址发布与账本合同。它不写
`project_asset_links`、`document_asset_links` 或 conversation
link；归属必须由对应 app-level
workflow 建立。源文件删除后，受管副本和 asset 仍可独立读取。文件入口的字节门禁必须发生在整文件读取前，像素门禁则由同一批 bytes 的真实解码完成。

`src/app-hosts/linnya/application/document-image-assets`
是文档图片接管 workflow：它组合 managed ingress、`document_asset_links`
与 verified-image loader。调用方只能得到 asset 身份、经复核的媒体事实和 data
URI，不能得到受管物理路径。既有 asset 再读取时必须先证明当前文档 ownership；不能因为知道 asset
ID 就绕过关系表。Slides 等文档类型通过通用 `@plugin/backend/documentImageAsset`
窄门面消费该能力，插件自身不读写 Asset domain 表。

## 工具结果 Claim

新工具图片在 tool event 提交前还没有 durable conversation
link。`features/tool-result-claims`
提供进程内、短生命周期、一次性授权：host 为已登记的 asset 签发
`artifact://tool-results/<claim-id>`，并绑定 conversation ID、tool call
ID 与 selection ID。URI 不包含 asset ID、路径或媒体事实。

workspace tool model input resolver 对两类 URI 使用完全分离的授权规则：

- `asset://assets/<asset-id>` 只检查既有 durable
  link：当前项目资源库成员，或当前会话 event 已引用；项目会话不会因此读取同项目其他会话的私有附件；
- `artifact://tool-results/<claim-id>`
  只消费当前进程 claim，不查询项目 link 代替，也不回退到 asset URI。

多图 claim 先整批验证作用域、selection 和有效期，再一次性消费。跨 conversation、跨 tool
call、重复消费、过期和进程重启都失败。resolver 随后仍通过 verified-image
loader 复核受管 bytes；成功产生的 durable ref 由 ToolNode 写入 tool
event，EventStore 的 `conversation_event_asset_links`
从此接管历史授权。ToolNode 在工具执行后的所有成功、拒绝和异常出口统一结束本次 model-input 生命周期，host 按 conversation/tool
call 显式删除未消费 claim；TTL 只处理进程失联，不承担正常回收。claim 本身不进 event、projection、日志或 provider
body。

## 项目成员关系

项目资源库 VFS 技术投影和图片生成工具的自动项目登记已经删除。代码与 Git 演进审计确认：仓库从未存在“用户选择普通文件 → 写入
`project_asset_links`
→ 进入项目资源库”的正式产品流程；该表唯一明确的 live 写入者曾是图片生成工具，现已退役。因此当前没有需要补回的通用项目资产入口，未知历史关系继续保留，不根据
`role/origin` 猜测用户意图。

普通用户内容进入项目树时必须由文档类型接管并创建正式 VFS 节点；Markdown 内嵌图片则属于 Markdown 文档自己的媒体生命周期。未来如果产品确实引入 Image 文档类型或独立“加入项目”动作，再由 workspace/app
workflow 在 asset 身份登记之外显式建立文档或 membership 关系。禁止给通用登记函数增加
`addToProject?: boolean`
一类开关；身份登记和项目 membership 的失败、权限、事务和变更通知不同，应保留两个业务动作。

Slides 的 live 图片解析只接受 conversation 路径或受控绝对路径；coordinator 与引擎归一化层都不再识别已取消的
`/资源库/...`、`/Resources/...` 项目路径或 Markdown 私有图片的 asset-id 假合同。

## Agent 读取

asset row 不是“已经可信的图片 bytes”。每次 preview 或 LLM
materialization 前都必须经过 verified-image loader：

1. asset 必须在当前 project 或 conversation scope 内有合法 link；
2. `local_path` 的 realpath 必须位于显式受管 storage boundary；
3. 路径和 content root 都不能通过符号链接逃逸；
4. 文件必须是普通文件；
5. 从同一 buffer 重新核对长度、hash、magic、尺寸和完整解码；
6. 任一图片失败时整批失败，不返回部分结果或本地路径。

当前受管图片边界包括数据库绑定的 AppData v2 store、历史 AppData
`ConversationAttachments/v1` 和迁移期 Workspace
`ManagedAssets/v1`。新增物理存储根时必须在 app
assembly 显式注入，不能让 loader 接受整个 Workspace Root 或任意绝对路径。

领域工具在已经持有合法 durable asset 身份时，可以内部声明
`asset://assets/<assetId>` selection。ToolNode 通过 host
resolver 把它转换成 durable resource
ref；这不是 Agent 可主动调用的资源读取协议。conversation 或 host 图片由 Agent 使用
`read_file(locator=conversation:/...)` /
`read_file(locator=file:///...)`，物理 reader 自动识别后再经既有 managed
ingress 与 claim 进入同一 resolver。真实 bytes 仍要等 active
model、route 和上下文确定后才由 materializer 读取；asset
ID、URI、hash、locator 与宿主路径都不能进入 provider body。

## 删除与损坏

原 Agent run 的恢复继续消费 EventStore 已提交的附件 / 图片引用；这些正式 event links
在暂停期间仍保留所有权，启动 GC 不会将它们当成无引用资源。进程内 tool-result claim
不随 checkpoint 恢复：若工具尚未提交 durable 图片结果就崩溃，不能用过期 claim 或
同名物理文件猜造授权。支持范围见 [Run Resumption](../../app-hosts/linnya/application/run-resumption/README.md)。

- 删除项目 link 只表示移出资源库，不代表可以删除 asset。
- truncate/delete conversation 会删除 event links；只有所有 ownership
  link 都消失后才能回收 asset。
- 物理文件缺失或内容变化时保留 durable 引用，但 preview 和 Agent 读取必须报告不可用或完整性失败。
- 不能静默回退到最初上传路径、CLI 输出路径或另一个同名文件。
- 未引用 asset 的 GC 与 pending 恢复必须在任何上传、工具和会话 ingress 开放前完成；进程启动时间屏障继续保护本次启动创建的事实，不能代替启动时序互斥。

`features/managed-image-maintenance`
统一拥有受管图片的启动维护。应用在数据库初始化后同步等待旧数据迁移、asset
GC 和 pending 恢复结束，完成后才装配插件、路由与 Agent ingress。维护以 asset
ledger 和 project、conversation、document 三类引用为真源，先在事务中清理超出时间屏障的无引用 asset，再在事务提交后回收当前数据库绑定 store 内的内容文件；物理删除前还要复核当前是否仍有 asset
row 占用同一
`local_path`。工具派生图、用户附件和未来同存储布局的图片因此不会形成多套删除纪律。

启动迁移只从当前账本的 `assets.local_path` 出发，把明确位于 AppData
v1 或 Workspace `ManagedAssets/v1` 的健康图片复制到当前 v2
store，并更新当前账本路径。它不反向扫描旧目录，也不删除 v1 字节：v1 没有 store 身份，同一份旧字节仍可能被另一份数据库备份引用。旧目录因此进入兼容读取和保留状态；未来若要物理清理，必须由显式备份/升级产品流程证明所有权，不能恢复旧的目录级推断 GC。

`generate_image`
生成图目前仍使用 conversation 工作区文件作为业务结果的物理来源。若用户手动删除该文件，Renderer 的原始结果会损坏；视觉模型回图时另有受管副本用于模型输入，非视觉模型不会为未消费的增强附件制造受管副本。未来若产品要求生成图展示也独立于会话工作区文件永久回放，应在 asset
storage workflow 中明确统一的受管展示引用，而不是在读取端加路径 fallback。

`features/managed-svg-asset` 是 admitted SVG 的独立垂直链。它只验证 canonical UTF-8 bytes、
预算与 SHA-256，再复用相同物理发布协议和通用 `assets` ledger；它不依赖 image inspector，
也不把 viewBox 写进 `width_px` / `height_px`。SVG 的 XML 安全规则仍由具体文档业务 owner 负责。

## 已知维护债

- `src/features/workspace/assets/shared/verified-image` 和若干 resolver 仍带
  `Workspace` 命名，但已经服务会话附件与全局 asset；后续应迁入 asset
  domain，不能继续扩大 workspace 对全局资源身份的所有权。
- `assets`
  表当前没有独立展示名。未来若某种 asset 获得独立用户可见身份，需要由对应文档类型或产品 workflow 定义稳定 display
  metadata，不能继续从物理路径推导产品名称。
- `generate_image` 已向 Agent 返回 `conversation:` locator，Slides
  host 通过 conversation admission 解析；renderer 的 `presentation.media`
  仍使用受控物理路径服务本地展示，不能把它误当 Agent 合同。
- `pathManager` 同时提供 AppData 和 Workspace 多种业务目录，是存量聚合点。asset
  domain 应只通过窄路径 port 消费已装配根，不继续把生命周期规则写回 pathManager。
