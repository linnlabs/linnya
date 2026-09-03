// 本文件由 scripts/release/orchestration/generateCurrentRelease.ts 生成。
// 请只修改根目录 release-notes.md，然后运行 pnpm run release:generate。

export const currentRelease = {
  "version": "0.0.38",
  "title": "测试版 v0.0.38",
  "notes": [
    "新增插件商店能力，支持插件列表、详情页、远程安装、卸载和自动更新检查。",
    "完善 Mindmap 官方插件运行时发布链路，支持磁盘加载、远程 artifact 分阶段安装、迁移、失败回滚和 R2 上传校验。",
    "优化插件状态与能力注册，插件启用状态改为数据库持久化，并按文件格式归属路由创建工具。",
    "改进插件商店界面，补齐展示元数据、状态标签、缺失插件详情和发布说明折叠。",
    "修复页面滚动、对话滚动控件、Slides 分隔线和部分布局外壳样式问题。",
    "加强默认工作区项目保护，避免关键项目被误操作。",
    "更新插件运行时、发布流程和插件化规划文档。",
    "桌面运行时升级至 Electron 43，并将最低系统要求明确为 macOS 12。",
    "更新原生模块与生产字节码构建链，增加 Node/Electron 双运行时数据库查询和 Electron Main 字节码门禁。",
    "文件、媒体和导出对话框分别记忆最近目录，避免 Electron 43 的 Downloads 默认变化造成交互回归。",
    "Command 与 Sandbox Utility Process 显式收口未处理 Promise rejection，失败不会被误报为成功。"
  ],
  "rawMarkdown": "测试版 v0.0.38\n - 新增插件商店能力，支持插件列表、详情页、远程安装、卸载和自动更新检查。\n - 完善 Mindmap 官方插件运行时发布链路，支持磁盘加载、远程 artifact 分阶段安装、迁移、失败回滚和 R2 上传校验。\n - 优化插件状态与能力注册，插件启用状态改为数据库持久化，并按文件格式归属路由创建工具。\n - 改进插件商店界面，补齐展示元数据、状态标签、缺失插件详情和发布说明折叠。\n - 修复页面滚动、对话滚动控件、Slides 分隔线和部分布局外壳样式问题。\n - 加强默认工作区项目保护，避免关键项目被误操作。\n - 更新插件运行时、发布流程和插件化规划文档。\n - 桌面运行时升级至 Electron 43，并将最低系统要求明确为 macOS 12。\n - 更新原生模块与生产字节码构建链，增加 Node/Electron 双运行时数据库查询和 Electron Main 字节码门禁。\n - 文件、媒体和导出对话框分别记忆最近目录，避免 Electron 43 的 Downloads 默认变化造成交互回归。\n - Command 与 Sandbox Utility Process 显式收口未处理 Promise rejection，失败不会被误报为成功。\n"
} as const;
