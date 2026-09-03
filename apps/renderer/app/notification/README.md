# App Notification

本 feature 是跨 domain 通知的 Host owner。业务 domain 和插件 Host port 只提交通知内容、类型与持续时间；这里统一持有当前通知状态、自动关闭生命周期和全局布局连接器。

## 责任边界

- `store/` 只同步保存当前消息、类型、时长、可见性和请求 revision；`show`/`hide` 不创建 timer，也不访问 DOM。
- `orchestration/` 根据可见性与 revision 管理唯一自动关闭 timer。新通知会替换旧 timer 并重新计时；持续时间为零时不自动关闭。
- `ui/GlobalNotificationBar.vue` 只把 Host store 与 CharacterCount 预留宽度投影给 Renderer UI 的纯展示组件，卸载时不修改通知状态。
- `@linnya/renderer-ui` 拥有 `NotificationBar` 的 props、DOM、类型图标、过渡和 CSS，不依赖 Pinia、Host layout 或 Electron。

通知文案继续由各业务 owner 的 localization resolver 生成。本 feature 不解释业务错误，不拼接底层诊断，也不维护第二份 message catalog。

## 稳定语义

- 默认类型是 info，默认持续时间为 3000ms；
- success、error、info、warning 的图标、class 与颜色保持现有结果；
- 通知位于视口底部，Host 根据 CharacterCount 的真实宽度增加右侧预留；
- 新通知覆盖当前通知并从新请求重新计时；
- 手动隐藏、timer 到期和 app lifecycle 清理分别由明确 owner 负责，展示组件没有反向状态副作用。
