# Conversation Title Feature

本 feature 是 conversation 标题的唯一业务所有者，负责首问 fallback、新会话自动标题、手动改名、取消与同会话标题写入串行化。Host 只存储标题字段和默认占位值，不得从消息内容推导标题。

## 业务边界

自动标题只服务于本次运行期内正式创建的默认新会话：

- 默认草稿通过统一 materialize 编排创建时，登记一次性候选；
- 历史恢复会话、旧会话和创建时已有显式标题的会话不登记候选；
- 不扫描历史消息，不根据当前消息数量、窗口内容、默认标题文案或 `titleOrigin` 推断资格；
- 候选不持久化，应用退出后未完成任务自然失效，不迁移、不回填、不补生成。

`conversation_title` PromptKey 是后端 single-turn 标题能力的稳定标识，不承担前端资格判断。

标题输入只来自 `user_input_committed.raw_content`，也就是用户实际提交的 `message`：

- 不读取模型实际收到的 `content`，因为其中可能包含 Host 注入的时间、上下文或包装；
- 不读取 `user_quote`、composer references、附件、图片文件名或其它 metadata；
- 文本加图片时只使用文本；图片-only 的 `raw_content` 为空，不生成文本标题。

## 目录职责

- `definitions/`：候选状态、标题来源和 coordinator 依赖契约；
- `functions/`：标题文本归一化、首问 fallback 和模型输入构建；
- `store/`：运行期候选和自动标题设置，只提供同步 action；
- `orchestration/`：模型请求、请求取消、持久化顺序和本地状态提交；
- `index.ts`：feature 唯一公开入口。

外部模块只能从 feature 根出口调用公开动作，不能读取 candidate store 或调用内部 orchestration 文件。

## 生命周期

1. 默认新会话 materialize，状态进入 `eligible`。
2. Host 完成 conversation 与首问的同一 durable transaction 后发出 `user_input_committed`；该 ack 是标题流程唯一的持久化门禁。
3. 首问原子认领候选并进入 `generating`。确定性 fallback 先通过标题 API 持久化，成功后才提交到运行期 conversation 和历史列表。
4. 自动标题辅助模型可以立即并行生成，但同一 conversation 的写队列保证模型标题只能排在 fallback 写入之后。
5. 新会话等待 fallback 写入结束后再同步进历史列表，避免存储默认占位标题短暂闪现；fallback 写入失败时仍同步历史，不能让 durable 会话不可见。
6. 模型标题持久化成功且当前 generation 仍拥有资格后，才提交到两个前端读取面。
7. 成功、失败、删除、手动改名、编辑重发或第二次用户动作都会终结候选，终结后不重试。

自动标题设置关闭时仍提交首问 fallback，但不调用标题模型。

标题模型请求使用真实 `conversationId`，让辅助 run 与审计事实归属到已经建库的会话；`persist: false` 只阻止标题 prompt 和模型回答进入聊天历史。禁止省略该 ID 后退到临时 `conv_*`，否则 SQLite run registry 会因会话外键不存在而拒绝注册。

## 写入与并发

- 自动标题和手动改名共享同一 conversation 级写入队列；
- 手动改名取消自动资格，并排在已经开始的写入之后，保证用户标题最终获胜；
- 第二次用户动作会取消未完成生成；若自动标题持久化已经开始，队列末尾会恢复首问 fallback，避免后端留下迟到标题；
- MessageProjection 不拥有标题，只能提交消息、消息派生 metadata 和消息活动时间；
- Host `ensureConversation()` 不拥有标题规则，只创建聚合根并沿用数据库默认占位值；
- 标题持久化成功后才更新两个前端读取面，禁止乐观写入造成后端与 UI 分叉。

## 接入约定

所有默认新会话必须经过 `ensureMaterializedConversation`。直接聊天、持久化 annotation、subrun、表格填充和插件 run 都把 durable ack 交给 domain-level `orchestrateCommittedConversationTitle`；入口不得自行从 prompt、附件或引用拼装标题输入，也不得复制“标题完成后再展示历史”的时序。

显式标题会话直接走显式创建入口，不参与本 feature 的自动候选生命周期。手动改名和删除分别调用 coordinator 的 `renameConversation` 与 `discardConversation`。

## 失败与可观察性

- 模型失败：保留首问 fallback，记录包含 `conversationId` 的 warning；
- fallback 持久化失败：记录包含 `conversationId` 的 warning，继续历史同步与自动标题尝试；
- 历史同步失败：不改变标题 generation；history 模块按自己的重试与后续同步策略处理；
- 用户取消或后续动作：属于正常生命周期，不记录错误；
- 不切换其他模型，不扫描消息补偿，不在第二轮重试。

## 回归门禁

业务测试必须覆盖：

- 新会话只生成一次，旧历史 live 槽为空也不生成；
- workflow 先 materialize、首次发送后再生成；
- `user_input_committed` 前不接纳标题，ack 后不再等待 history metadata 轮询；
- fallback 必须持久化成功后才更新读取面，且历史入口不得先展示默认占位标题；
- 自动标题设置关闭时只保留 fallback；
- 第二次动作取消等待中或生成中的任务；
- 自动持久化竞态下恢复 fallback；
- 手动改名与自动写入并发时用户标题最终获胜；
- 延迟 MessageProjection 快照不能回滚标题；
- 默认 Agent、PPT Agent、Deep Research 等选择不改变标题生命周期；
- 文本加图片只消费 durable `raw_content`，引用、附件与 Host 包装不能进入标题；
- Host 与 Testkit 不复制空白归一化或 50 字符截断规则。
