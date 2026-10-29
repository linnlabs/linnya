# Client notice history

负责需要保留在历史中的、没有 Runtime fact 的客户端错误：发送、控制及本地请求校验。调用方传安全类别与操作，不提交错误原文。运行内错误/重试由 execution-notice owner 投影，本 feature 不再复制一份。

`clientNoticeStore` 仅持有状态；outbox orchestration 先以 UUID 保存到 Renderer 持久存储，再通过幂等 Conversation API 发送。没有 Conversation 时按 Workspace 草稿身份保留，创建真实 Conversation 后显式绑定。Host 不可达时保留 pending 状态。重新进入对话、网络恢复及每 15 秒的 pending 核对仅重送同一产品事实，绝不重发用户消息、启动 Agent 或接管模型重试。

接纳成功不等于窗口已取得该行：回执先保留，现有 message-window 确认显示后才删除本地副本。确认读取失败不再次产生 notice。未确认回执会继续核对同一 UUID；Host 返回 removed 后清除本地条目，覆盖“提交成功、回执丢失、随后截断”的交错。Conversation 删除成功后清理该对话 outbox。

UI 仅呈现消息列表中的无背景文字。文案通过 [error-surface](../error-surface/README.md) 的公开函数统一选择：明确的业务原因直接显示操作指引；其余提示说明失败操作，再补充已知原因或重试建议。HTTP 状态用于解释权限、限流、超时等原因，原因未知时不猜测网络或模型故障。

来源和错误记录自身的投递状态只保留在 metadata / outbox 中，不把“客户端报告”“尚未同步”或 HTTP 编号拼进错误正文，避免让用户误认为是消息或任务状态。本地、已接纳和历史重载使用相同文案。错误不进入对话内容/模型上下文，不据此宣称 Agent 已暂停或恢复，也不宣称错误记录已经同步。原始 Provider body、凭据、stack 不进入 API 或本地持久 outbox。

历史窗口读取失败由 message-window 持有当前状态，不创建持久 notice；成功接纳或下一次请求时清除。旧版本已保存的 `operation=load` 记录仍可内部读取，但在统一消息可见性规则和本地 outbox 展示中隐藏，不计入空态内容，不修改数据库或分页游标。

组件样式由 Conversation 的 `styles/features/client-notices/ClientNoticeMessage.css` 持有，经 `styles/features/index.css` 聚合加载；颜色使用全局语义 token，Vue 内不定义样式块。
