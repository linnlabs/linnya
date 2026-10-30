// 本文件由 scripts/release/orchestration/generateCurrentRelease.ts 生成。
// 请只修改根目录 release-notes.md，然后运行 pnpm run release:generate。

export const currentRelease = {
  "version": "0.1.0",
  "title": "测试版 v0.1.0",
  "notes": [
    "更新桌面界面、设计语言与图标，完善模型选择器、多级菜单和对话引用展示。",
    "改进 Slides 网页编辑、缩放与编辑状态同步，并完善图片渲染导出链路。",
    "统一 Desktop 与 CLI 的系统钥匙串凭据保护，完善旧凭据迁移和不可用状态提示。",
    "不再预置默认模型；请在设置中添加自己的模型与 API 凭据，当前不提供 Linnya Cloud 模型服务。",
    "升级 Electron 与相关依赖，完善原生进程、安装包身份和发布校验。",
    "新版使用独立更新通道，0.0.35 不会自动升级到本版本；请先备份旧数据，再手动安装，低于支持版本的数据库无法直接打开。"
  ],
  "rawMarkdown": "测试版 v0.1.0\n - 更新桌面界面、设计语言与图标，完善模型选择器、多级菜单和对话引用展示。\n - 改进 Slides 网页编辑、缩放与编辑状态同步，并完善图片渲染导出链路。\n - 统一 Desktop 与 CLI 的系统钥匙串凭据保护，完善旧凭据迁移和不可用状态提示。\n - 不再预置默认模型；请在设置中添加自己的模型与 API 凭据，当前不提供 Linnya Cloud 模型服务。\n - 升级 Electron 与相关依赖，完善原生进程、安装包身份和发布校验。\n - 新版使用独立更新通道，0.0.35 不会自动升级到本版本；请先备份旧数据，再手动安装，低于支持版本的数据库无法直接打开。\n"
} as const;
