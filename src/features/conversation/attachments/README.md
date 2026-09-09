# 会话附件：生命周期与端到端读取

本文是 Linnya 会话附件的稳定总领文档。它统一说明用户导入文件后如何存储、如何随消息持久化和回放、Agent 如何读取、前端如何预览，以及删除和损坏时的行为。Phase 实施文档只记录阶段计划，不是长期合同。

跨来源 asset 的身份、项目/会话归属、本地图片登记和回收边界见 [`src/domains/assets/README.md`](../../../domains/assets/README.md)。本文只拥有会话导入附件的生命周期，不重复定义全局 asset 账本。

本模块管理用户通过粘贴、拖拽或“添加附件”导入到会话的文件。它负责附件副本的持久化身份、物理存储、完整性校验、会话引用和回收，不负责项目资源库展示，也不把用户输入中的普通路径文本解释成附件。

当前产品入口只开放图片，校验和 provider 物化也只实现图片合同。未来增加普通文件时，应扩展本 domain 的媒体类型、预览和 Agent 工具读取能力，继续复用同一套“draft → durable ref → event link → sidecar bytes → GC”生命周期，不能另建一套上传目录或回放协议。

当前单条用户消息最多接收 100 张图片。单图 10 MiB、单消息图片总计 100 MiB 与解码像素上限保持独立生效；
100 MiB 是产品入口上限，具体 provider/transport profile 可以进一步收窄。“100 张”只是数量边界，不会绕过字节、像素或模型上下文 token 门禁。第 101 张继续由现有入口校验明确拒绝，
不做自动淘汰、抽样或缩略图替换。

## 三种不同语义

同一个本地文件可以因用户动作不同而进入三条不同链路：

| 用户动作 | 系统语义 | 是否复制 | 是否进入项目资源库 |
| --- | --- | --- | --- |
| 粘贴、拖拽、点击“添加附件” | 导入会话附件 | 是，复制到应用持有的内容寻址存储 | 否 |
| 在消息中输入文件路径 | 外部路径文本 | 否，未来由 Bash 等工具按原路径读取 | 否 |
| 显式执行“加入资源库” | 项目资源 | 由资源库自己的导入流程决定 | 是 |

系统不能因为拿到了绝对路径，就把路径文本自动提升为附件；也不能因为会话属于某个项目，就把会话附件自动提升为项目资源。

## 持久化模型

导入附件采用“稳定身份 + 应用持有副本”的模型：

1. 上传中的草稿只存在于 host 进程内，并写入应用附件目录的 staging。
2. 发送时重新校验同一份字节，按 SHA-256 发布到内容寻址目录。
3. `assets` 保存 durable asset 身份、内容事实和 host-only 的真实物理路径。
4. immutable event 只保存 `resourceId`、MIME、长度、hash 和展示名，不保存绝对路径或字节。
5. `conversation_event_asset_links` 保存 event 与 asset 的有序引用。
6. `project_asset_links` 只由显式资源库动作写入，EventStore 不自动创建项目归属。

生产目录结构如下；开发环境使用同一 AppData 规则指向 `_dev_data`：

```text
<AppData>/ConversationAttachments/v2/stores/<store-id>/
  staging/
  pending/
  content/<sha256 前两位>/<sha256>.<ext>
  quarantine/
```

`store-id` 由 asset domain 生成并持久化在当前 Workspace 数据库中。它把数据库账本与自己的可写 sidecar 目录绑定起来：切换、恢复或误连另一份数据库时，维护流程不会把当前数据库不认识的图片当成可删除孤儿。该身份只用于 host 存储边界，不进入 event、Renderer 或 provider 请求。

`/Resources/Attachments/...` 仍是无路径语义的 durable URI。真实路径只在 host 内部解析，供完整性校验、预览、模型输入物化和未来本地工具使用。

附件存储独立于项目 Workspace Root。移动项目目录或切换项目不会改变附件位置；用户删除原文件也不会影响会话。若用户手动删除应用持有副本，账本仍保留，但预览和模型读取必须明确报告附件不可用，不能回退读取原文件。

跨设备备份或迁移必须把数据库与 `ConversationAttachments` 一起作为应用数据导出。只复制单个 `workspace.sqlite` 不是完整会话备份；后续若提供导出功能，应由导出编排收集实际被引用的内容对象，而不是把二进制塞进事件 JSON。

### 四种身份不能混用

| 身份 | 生命周期 | 可见范围 | 用途 |
| --- | --- | --- | --- |
| draft ID | 从上传到发送成功或释放 | Renderer 与 host 的上传合同 | 关联尚未提交的草稿 |
| asset ID / resource ID | durable | event、projection、Runtime、工具合同 | 跨回放稳定引用同一个附件 |
| durable URI | durable、无本机路径语义 | 资源账本 | 表达内容寻址身份 |
| `assets.local_path` | host-only、本机真实路径 | SQLite adapter、verified-content loader | 打开受管副本并复核字节 |

Renderer 不接触 `local_path`，provider 请求也不能收到 asset ID、durable URI、hash 或本地路径。未来 Bash 或本地资源工具若需要读取会话附件，应通过受控解析能力取得已经验证的真实路径，而不是自己把 durable URI 拼成文件路径。

## 全链路总览

### 导入与发送

1. Renderer 通过图片附件 API 上传文件；host 真实解码图片并把字节写入 AppData staging，返回 draft ref。
2. 输入框只持有 draft ref 和用于本地展示的临时预览，不把未提交草稿写入消息历史。
3. 发送时，Flow incoming-event orchestration 以当前 user event ID 为聚合边界，一次性把 draft ref 提交为 durable ref。
4. EventStore 在同一个短事务中登记 asset、immutable event、`conversation_event_asset_links`、UI projection 和统计。
5. 事务成功后 host 才释放 draft；事务失败时消息和附件事实一起回滚。

当前轮给 Agent 的附件和写入 event 的附件必须来自同一次聚合构造。禁止请求侧和持久化侧分别解析草稿，否则当前回答与后续回放可能看到不同附件。

### 前端即时显示与历史回放

发送成功后，host 通过 `user_input_committed` SSE 事件向 Renderer 返回 durable attachment refs。前端用 durable 消息替换输入框草稿状态；live 消息和历史窗口因此共享同一种附件结构。

历史加载不读取原始文件，也不临时回查 event。EventStore 将附件有序投影到 `conversation_ui_messages.attachments_json`，window API 解析并校验该列，再把 durable refs 交给 Renderer。projection 需要重建时，也从 immutable events 生成同样的附件结构。

`ConversationImageAttachmentGallery` 只按 asset ID 请求 `/api/v1/conversation/assets/images/:assetId/content`。host 在返回字节前重新执行账本、受管目录、真实文件和内容完整性校验。前端模态框和缩略图使用这个受控内容响应，不直接打开 `local_path`。因此：

- 刷新、分页回填和 projection rebuild 后仍显示同一附件；
- 用户删除最初上传的原文件，不影响对话图片；
- 受管副本缺失或损坏时，前端进入明确的不可用状态，不回退原文件或只弹出文件名；
- 预览 URL 是短生命周期交互地址，不是消息历史的一部分。

### Agent 读取用户图片

消息历史和 Context Manager 始终传递 durable refs，不传图片字节。只有最终上下文和实际模型 route 已确定、图片能力与预算校验通过后，host 才开始物化：

1. 收集最终消息中的用户图片引用；
2. 通过 asset 账本取得 host-only 的真实路径；
3. 校验允许的存储根、realpath 与符号链接边界；
4. 对同一 buffer 复核长度、SHA-256、真实 MIME、尺寸和可解码性；
5. 整批成功后生成短生命周期的 provider-neutral resolved attachments；
6. 当前 provider adapter 再转换成该 API surface 所需的图片 content parts。

任何一张图片解析失败时，整批物化失败，不向 provider 发送部分输入；本地物化失败不计作模型调用 attempt，也不触发模型 fallback。切换实际 route 后必须用新 route 的 profile 重新做准入和物化。

图片在活动模型上下文中没有独立生命周期。用户图片随所属消息、工具图片随完整工具交互组服从 LinnKit 的统一
tool history、working memory、摘要与 checkpoint 规则。图片退出活动上下文不会删除本节描述的 event link、asset
账本或内容字节，历史 UI 仍可预览，Agent 也可通过正式 locator 再次读取。

### Agent 读取工具结果图片

工具产生的图片先通过现有 `ManagedImageIngressPort` 登记为 durable asset，再由 `ToolResultAssetClaimRegistryPort` 签发 tool-result claim，并通过工具结果的 `modelInput.attachments` 声明明确选择哪些结果进入模型输入。Tool Node 将选中的引用绑定到 tool message；后续与用户图片走同一套能力判断、上下文预算、verified-content 读取和 provider adapter 转换。当前 `generate_image` 已接入这条链路，物理文件直接写入 conversation-scoped 工作区的 `generated-images/`，Agent 结果只返回会话相对路径。

child Agent 复用同一个 Tool Node、模型输入 resolver 和能力准入，因此图片工具结果只进入正在执行的 child 模型上下文。为了让父任务里的 Subrun 详情可见，成功 child `tool_output` 的 durable refs 还会被 parent trace 作为 UI read model 原样投影并写入紧凑历史；完整详情再复用主会话的图片卡和预览端口。这个展示投影不复制图片字节或物理路径，不触发父任务重跑 child 工具，也不会把 child 图片绑定到父模型消息。

“用户上传图片”和“工具结果图片”在来源上不同，在读取安全和物化入口上共用同一合同，但可用性必须逐来源判断。
模型目录的 `image_input` 只表达模型能否理解图片，route 的 `user_image` / `tool_result_image` 分别表达当前 codec
能否保持原角色编码；有效能力是二者相交。Composer 只检查用户图片位置，Tool Node 只检查本次工具实际需要的位置。
业务层不按模型名称猜测格式，也不把工具图片改写成 user message。图片生成采用 `when_supported`：route 不支持工具图片时，
生成、保存和 Renderer 展示仍成功，只省略下一轮模型附件。

## 图片字节策略

首版保存通过真实解码校验的上传字节，不做静默有损压缩或分辨率缩放。原因是附件既是用户历史事实，也是模型输入；修改像素会改变识别结果，且会让用户看到的图片与实际上传内容不一致。

缩略图、低分辨率模型输入或空间优化属于可选衍生物。未来若引入，应保留原始内容身份，并用独立的 derivative 合同记录来源、编码策略和用途，不能覆盖 durable 原件。

## 事务与崩溃一致性

发送顺序保持为：

1. staging 文件复核通过；
2. 原子发布到内容寻址路径；
3. 在 EventStore 短事务中登记 asset、event、event link、projection 和统计；
4. SQLite 事务成功后释放 draft。

文件发布前会先写入当前 store 内的 pending 凭证。数据库事务成功后释放 draft，同时完成凭证；事务失败或进程中断时，凭证保留发布事实。下次启动只检查这些显式凭证：账本已经登记的内容保留并清凭证，未登记内容移入隔离区，满 30 天后删除。启动维护不遍历正式 `content/` 反向猜测所有权。

删除或截断会话时，先在事务中删除引用；只有当内容对象不再被 conversation、project 或 document 引用时，才允许删除 asset 记录。物理文件只允许从当前数据库绑定的 v2 store 回收；无 store 身份的 v1 历史字节不会因当前账本失去引用而被自动删除。

## 模块边界

会话附件 domain 对外只暴露窄能力：

- ingress：创建、解析、提交和释放上传草稿；
- storage paths：从 AppData 根与数据库绑定的 store identity 解析受管路径和 durable URI；
- verified content：从 durable asset 读取并复核字节；
- lifecycle：由 asset domain 迁移旧受管图片、恢复显式 pending、隔离未完成发布并回收当前 store 的孤儿；
- persistence contract：向 EventStore 提供一次提交所需的附件事实。

调用关系应保持为：

```text
Renderer upload
  -> conversation attachment ingress
  -> Flow incoming-event orchestration
  -> EventStore transaction
       -> assets
       -> conversation_event_asset_links

preview / LLM / tool
  -> verified attachment content port
  -> provider-specific materializer or local tool

explicit “add to resource library”
  -> project resource workflow
  -> project_asset_links
```

`pathManager` 只提供 AppData 根目录，不拥有附件规则。全局 asset domain 可以通过公共 verified-content port 读取某个 durable asset，但不能拥有会话附件的导入和生命周期。

关键实现入口：

- Renderer 导入与预览：`apps/renderer/domains/conversation/features/image-attachments/`
- Flow 草稿提交：`src/app-hosts/linnya/adapters/flow/incoming-events/`
- event 与 UI projection：`src/app-hosts/linnya/adapters/persistence/event-store/`
- 会话图片导入：`src/features/conversation/attachments/`
- AppData 共享存储与启动维护：`src/domains/assets/`
- verified-content 读取：`src/features/workspace/assets/shared/verified-image/`
- Agent 图片物化：`src/app-hosts/linnya/adapters/llm-input-materialization/`
- Provider 输入投影：`src/app-hosts/linnya/adapters/inference/capabilities/ai-sdk/`

`verified-image` 和 `createWorkspaceLlmInputMaterializer` 仍带有历史 workspace 命名，但它们已按显式受管存储边界读取 AppData 会话附件。这里是需要后续消除的命名债，不代表会话附件重新归属 workspace domain。

## 旧数据迁移

旧版本曾把上传图片放在 `<WorkspaceRoot>/ManagedAssets/v1/content`，后续版本又使用过 `<AppData>/ConversationAttachments/v1/content`；两种布局都没有数据库绑定的 store identity。旧逻辑还可能因项目会话自动创建 `project_asset_links(role='conversation_attachment')`。

迁移必须幂等执行：

1. 只从当前账本识别 `/Resources/Attachments/` 命名空间，且 `local_path` 明确属于上述两个 v1 root 的图片；
2. 重新校验旧文件的长度、hash、MIME 和尺寸；
3. 发布到当前数据库绑定的 AppData v2 store 后，更新当前 `assets.local_path`；
4. v1 原字节进入只读保留状态，不随当前数据库迁移或失去引用而自动删除；
5. 空账本不扫描、认领或删除旧目录中的未知图片；
6. 缺失或损坏的旧文件保留原账本并报告迁移失败，不能伪造内容或静默标记成功；当前 v2 store 内的文件健康属于读取校验，不得重新进入旧迁移。

迁移期间读取端允许的物理位置必须是显式存储合同：当前 AppData v2 store、旧 AppData v1 和旧 Workspace `ManagedAssets/v1`。迁移结束后，新写入只能进入当前数据库绑定的 v2 store。

旧数据迁移与所有受管图片的通用维护统一属于 asset domain 的 `managed-image-maintenance`。conversation domain 只拥有 draft、用户导入和 event 提交所需事实，避免会话删除规则被工具派生图片等其他来源复制。
