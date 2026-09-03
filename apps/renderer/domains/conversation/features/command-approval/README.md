# Command Approval Renderer

## 1. 功能

这个 feature 是对话中的审批显示层。它展示 Main 推送的 pending command approval，并把用户选择提交回 Main。全局权限档位不在这里设置，统一在 Settings 页面管理；这样用户不会在两个位置看到互相冲突的权限状态。

## 2. 文件和数据流

```text
command-approval/
├── definitions/commandApprovalView.ts  # Renderer 安全投影
├── functions/resolveCommandApprovalReasonMessage.ts
├── orchestration/useCommandApproval.ts # 注册页面、拉取 snapshot、reply
├── store/commandApprovalProjectionStore.ts
└── ui/{CommandApprovalPanel,CommandApprovalPageOwner}.vue
```

数据方向固定为：Main host → gateway → projection store → panel；用户点击 → orchestration → IPC → Main host。store 只保存投影和 loading/error，不持有 resolver、不写权限文件、不调用业务规则。

## 3. 展示字段

投影允许展示：命令摘要、工作目录的用户可读摘要、审批原因、可用选择、请求状态和错误提示。完整环境、PID、内部 appData 路径、保护输入和原始 artifact 不进入 Vue。

可用选择来自请求的 `available_choices`：

- `allow_once`：只执行这次。
- `allow_for_conversation`：本对话记住同一简单命令前缀和匹配上下文。
- `deny`：拒绝启动。

read-only 的升级请求必须显示“从只读提升到标准”的原因；固定风险请求显示 rule category 的稳定中文说明，不直接把模型提供的任意描述渲染为可信警告。

## 4. 页面失效和重复点击

页面挂载时注册 page ticket 并读取当前 snapshot；reload 后旧 ticket 失效。按钮提交期间锁定当前请求，重复点击由 Main 再次拒绝。请求已被另一个页面处理、owner 已结束或 conversation 正在清理时，页面显示不可用并重新读取 snapshot，而不是假装成功。

## 5. 组件规范

复用共享 Button、Dialog、ScrollArea 和 typography 组件。文案只表达用户需要做的决定，不在页面重复解释完整沙箱架构。不要为颜色、padding、弹窗宽度写测试；这些属于共享组件和人工验收。

## 6. 测试门禁

`commandApprovalRenderer.integration.test.ts` 覆盖当前 conversation 过滤、三种选择、重复 reply、页面 ticket 失效、reload 恢复和 Main 错误投影。测试 IPC 行为和业务状态，不做大面积 snapshot。
