# Protected Input

## 目的

Protected input 是用户从命令卡片直接发送到当前 PTY 的通道，例如密码或一次性验证码。它与 Agent 的 `process.write` 分离，避免模型把敏感正文放进普通 tool call、LLM observation 或审计。

## 允许范围

- 仅显式 PTY execution 支持；普通 pipe 没有该通道。
- 请求必须绑定 conversation、execution 和 Main 签发的 control ticket。
- 输入 byte 有上限，必须在 Main/Commands 边界验证。
- 只记录来源、时间、execution 和 byte 数；不记录正文、不回显给模型。
- 输入失败只能返回 control error，不能改写命令已经确定的 exit/timeout/cancel 终因。

## 生命周期

页面打开 protected input → Main 校验 ticket/owner → PTY write → 返回已接受或失败 → owner end 时清理 listener。页面 reload、conversation cleanup、tree-empty 后的输入全部拒绝。

## 测试

覆盖票据失效、execution 不匹配、非 PTY、超长/非法 byte、成功输入、native 失败、页面销毁和 owner end。UI 测试只验证用户动作和状态提示，不断言敏感文本渲染。
