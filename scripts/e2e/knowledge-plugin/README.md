# 知识库插件的真实 Desktop 验收

验收使用真实 Main、Preload、Backend、插件 artifact 和受管 Worker；模型请求只发送合成资料到本机回环协议 fixture，不需要服务商密钥。它验证协议和产品数据流，不验证上游模型质量。

## Windows 安装目录布局

从 macOS 设置 `LINNYA_WINDOWS_SSH_HOST`、`LINNYA_WINDOWS_SSH_USER`、`LINNYA_WINDOWS_SSH_KEY` 和 `LINNYA_WINDOWS_INTERACTIVE_USER`，执行 `node scripts/e2e/knowledge-plugin/windows.acceptance.mjs`。目标普通用户必须已经登录 Windows 桌面。源码必须已提交；候选绑定 Git commit/tree、生产依赖锁、插件 ZIP 和运行时哈希。

脚本按公共生产构建入口生成 Host JS、Renderer、官方插件、Node、Qdrant 和 Windows 原生依赖，再用 electron-builder 的正式目录布局装配。验收入口是实际 `dist/main/main.cjs`，身份为 community。该流程不制作 NSIS、不生成发行清单或字节码、不签名、不上传，不能作为正式发布或安装卸载的通过证据。

若已有同版本 Windows Electron ZIP，可显式设置 `LINNYA_WINDOWS_ELECTRON_ZIP`。脚本会从 GitHub 官方发布回读 SHASUMS256、验证完整 ZIP 哈希后才交给 electron-builder 的 `electronDist`，并将来源和哈希写入候选。不会关闭校验或修改全局下载配置。

通过普通用户的限权交互任务启动真实 App，用 CDP 操作用户界面，业务只经正式 Preload/plugin IPC 与受管 HTTP 上传。覆盖文档摄入、图谱两类 Worker、检索重排、已保存内容预览、插件停启和正常删除；图像/PDF 场景同时检查安装目录外插件的原生依赖及 PDF ESM 加载。安装树、profile、Workspace、任务、归属进程均在唯一 token 范围内，成功或失败都先取回日志/截图/回执再清理，不接触用户 App 数据。

需要永久回执时通过工作台 `wb verify --require-evidence` 执行；默认 `createEvidence` 也会保留本机证据目录。失败场景不会自动置绿，清理时发现需要强制终止的残留进程也会失败。

## 索引重建回归

现有 `scripts/e2e/knowledge-index/desktop.acceptance.mjs` 保留五个原文保留、身份不匹配、失败、取消及重启恢复场景；其业务入口同样走正式插件 IPC/上传，模型用途从用户可见设置选择，不再导入已移除的 Renderer owner。

## macOS 隔离探针

`KNOWLEDGE_PLUGIN_MODE=bundled pnpm exec tsx scripts/e2e/knowledge-plugin/desktop.acceptance.mjs` 使用同一隔离探针，并显式选择现有磁盘 Renderer 模式；脚本断言 `plugin://knowledge/dist/renderer/index.js`、active 安装来源和真实界面入口，不能仅用 Backend IPC 成功推断 Renderer 已加载。默认 dev 模式仍用于源码界面调试。两种模式都记录实际入口 URL。

这是未打包 Host 上的真实插件产物验收，不等于 macOS 已签名安装包验收。运行前按正式插件构建/预置流程生成知识库 artifact；启动不会绕过 artifact 校验。

两检索工具、深搜、分块读取及组装的项目范围与历史证据由插件的真实 SQLite/SoT/Host runtime 集成回归覆盖。现有产品 CLI 的基础工具白名单不包含知识库工具；本脚本不扩大该白名单，也不将集成回归写成 Desktop 上的工具执行。
