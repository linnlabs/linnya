# Client notice history

负责没有 Runtime fact 的客户端错误：发送、控制、HTTP/网络、显示及本地请求校验。调用方传安全类别与操作，不提交错误原文。运行内错误/重试由 execution-notice owner 投影，本 feature 不再复制一份。

`clientNoticeStore` 仅持有状态；outbox orchestration 先以 UUID 保存到 Renderer 持久存储，再通过幂等 Conversation API 发送。没有 Conversation 时按 Workspace 草稿身份保留，创建真实 Conversation 后显式绑定。Host 不可达时消息明确显示“本地保留，尚未同步到历史”。重新进入对话、网络恢复及每 15 秒的 pending 核对仅重送同一产品事实，绝不重发用户消息、启动 Agent 或接管模型重试。

接纳成功不等于窗口已取得该行：回执先保留，现有 message-window 确认显示后才删除本地副本。确认读取失败不再次产生 notice。未确认回执会继续核对同一 UUID；Host 返回 removed 后清除本地条目，覆盖“提交成功、回执丢失、随后截断”的交错。Conversation 删除成功后清理该对话 outbox。

UI 仅呈现消息列表中的无背景文字，客户端报告标明来源，pending 明示尚未同步。错误不进入对话内容/模型上下文，不据此宣称 Agent 已暂停或恢复。原始 Provider body、凭据、stack 不进入 API 或本地持久 outbox。

组件样式由 Conversation 的 `styles/features/client-notices/ClientNoticeMessage.css` 持有，经 `styles/features/index.css` 聚合加载；颜色使用全局语义 token，Vue 内不定义样式块。
