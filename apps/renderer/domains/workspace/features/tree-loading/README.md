# Workspace Tree Loading

本 feature 负责项目树的 VFS 加载、展开状态恢复、局部刷新和并发请求协调。

Store 只提供响应式状态；异步请求和加载顺序由 `createWorkspaceTreeLoader` 编排。清空树时会同步使旧请求失效，避免项目切换后旧响应回写。
