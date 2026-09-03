# Command Approval Host

## 1. 作用

审批 host 位于 App Host，维护 pending approval 的真实状态，并把当前有效 Renderer 页面当作一个可替换的显示终端。它不解析风险规则、不读取权限文件，也不相信 Renderer 传来的 conversation 或 sender 字段；Electron Main 只验证真实 sender 并转发页面操作。

把 pending 放在 App Server owner 而不是 Main 或 Vue store 的原因是页面会 reload、切换对话、被销毁或暂时不可用；这些都不应该让一个已经需要用户确认的命令自动运行。

## 2. 代码树和对象

```text
approval-host/
├── definitions/
│   └── commandApprovalHost.ts
├── functions/
│   ├── isCommandApprovalChoiceAvailable.ts
│   └── projectCommandApprovalPending.ts
├── orchestration/
│   └── createCommandApprovalHost.ts
└── __tests__/
```

host 内部至少维护：

```text
pending approvals: approval_request_id → immutable request + resolver
active page: page ticket + sender.id + conversation projection
owner bindings: execution identity → pending request
```

resolver 只结算一次。`allow_once`、`allow_for_conversation`、`deny` 是业务选择，不是 UI 自己改变状态的字符串。

## 3. 请求到结算

```text
runtime submits immutable request
  → host verifies proposal/execution binding
  → pending enters App Server owner
  → current page receives projected snapshot
  → page reply includes request id + page ticket
  → Main verifies event.sender.id; host verifies owner id and ticket
  → optional conversation approval is persisted first
  → resolver returns approved / denied / unavailable
  → pending removed after terminal settlement
```

如果批准记忆写入失败，host 不得返回“已记住”。可以按产品合同把本次批准降级为 `allow_once`，或保持拒绝；不能静默扩大后续权限。

## 4. 页面通行证和安全校验

- page ticket 由 App Server host 为 Main 已验证的页面 owner 生成，Renderer 不能自带。
- IPC handler 使用 `event.sender.id` 识别实际发送页面，不信任 payload 中的 window id。
- reply 的 `approval_request_id`、`conversation_id`、`execution_id`、proposal hash/binding 必须与 pending 逐项一致。
- reload 后旧 ticket 失效；新页面只能拉取仍 pending 的投影，不能代替旧页面提交已经结算的请求。
- owner end、conversation cleanup、App end 都会拒绝并清空相关 pending。

## 5. 用户体验和边界

审批 UI 是对话中的简洁非全局提示，展示命令摘要、cwd、风险原因和允许/拒绝选项。权限档位的全局切换和风险说明属于设置页，不在每个 command card 里重复管理。

Renderer 只拿到安全投影：不包含 PID、完整环境、内部路径和原始保护输入。审批原因来自 schema 的固定类别，不能让模型把任意文字伪装成系统风险提示。

## 6. 长时间 pending

页面短暂离线时保持 pending 是正确的 fail-closed 行为；如果产品增加“页面长期缺席”提示，应由 host 提供状态，而不是在组件里猜测。任何超时都必须有明确产品合同，不能随意用固定 timer 把用户未操作解释成允许。

## 7. 测试门禁

`commandApprovalHost.integration.test.ts` 至少覆盖：单次允许、对话记忆、拒绝、重复 reply、两个页面竞争、reload 旧 ticket、owner end、持久化失败和 App drain。Electron IPC 测试另行覆盖 `sender.id` 伪造。测试应验证 resolver 只结算一次，不测试颜色、布局和弹窗宽度。
