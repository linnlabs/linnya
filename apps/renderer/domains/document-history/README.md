# 文档历史面板

Core 负责通用交互，不理解插件版本载荷。入口在 Header More；操作和插件菜单合并为一个菜单。
版本展示规则、身份与后端合同见 [Core 文档历史](../../../../src/domains/document-history/README.md)。

- `definitions`：面板状态与 IPC port；`store` 仅同步持有状态。
- `orchestration`：加载、选择、恢复及冲突后刷新。关闭使旧请求失效，迟到响应不能重新打开面板。
- `infrastructure`：调用经过 schema 校验的 document-history:list/restore。
- `ui`：复用 Modal、ActionButtons、AlertDialog，滚动由 Modal 管理。
- `locales`：中文/英文注册；显示版本真实提交时间。

插件通过 document type contribution 提供 historyPreviewComponent，接收 documentId/versionId。
切换版本会卸载旧组件；关闭、切换文档、插件停用均卸载面板。插件组件自行释放预览资源，不能更新当前编辑状态。
恢复当前版本禁用；恢复其他版本先确认，携带已看到的 current identity。冲突时只刷新，不自动重试覆盖。
