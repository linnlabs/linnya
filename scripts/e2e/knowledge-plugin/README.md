# 知识库插件的真实 Desktop 验收

验收使用真实 Main、Preload、Backend、插件 artifact 和受管 Worker；模型请求只发送合成资料到本机回环协议 fixture，不需要服务商密钥。它验证协议和产品数据流，不验证上游模型质量。

## Windows 安装目录布局

从 macOS 设置 `LINNYA_WINDOWS_SSH_HOST`、`LINNYA_WINDOWS_SSH_USER`、`LINNYA_WINDOWS_SSH_KEY` 和 `LINNYA_WINDOWS_INTERACTIVE_USER`，执行 `node scripts/e2e/knowledge-plugin/windows.acceptance.mjs`。目标普通用户必须已经登录 Windows 桌面。源码必须已提交；候选绑定 Git commit/tree、生产依赖锁、插件 ZIP 和运行时哈希。

还需显式提供 `LINNYA_WINDOWS_VC_RUNTIME_DIR`，指向有逐文件来源证据的 Visual Studio x64 CRT 目录。脚本复用正式 `prepareWindowsAppLocalRuntime` 拷贝三处 app-local CRT，并在 Windows 普通用户下执行原版 `after-sign-runtime-assets.cjs` 的 `release_unsigned` 收尾；App 未签名、微软 CRT 和 Node 真验签、原生模块哈希均通过后才启动业务。不会从系统目录或其他应用借 DLL，也不注入验签替身。候选记录原版收尾脚本和 CRT 哈希，回执保存正式生成的运行时清单。

脚本按公共生产构建入口生成 Host JS、Renderer、官方插件、Node、Qdrant 和 Windows 原生依赖，再用 electron-builder 的正式目录布局装配。验收入口是实际 `dist/main/main.cjs`，身份为 community。该流程不制作 NSIS、不生成发行清单或字节码、不签名、不上传，不能作为正式发布或安装卸载的通过证据。

若已有同版本 Windows Electron ZIP，可显式设置 `LINNYA_WINDOWS_ELECTRON_ZIP`。脚本会从 GitHub 官方发布回读 SHASUMS256、验证完整 ZIP 哈希后才交给 electron-builder 的 `electronDist`，并将来源和哈希写入候选。不会关闭校验或修改全局下载配置。

通过普通用户的限权交互任务启动真实 App，用 CDP 操作用户界面，业务只经正式 Preload/plugin IPC 与受管 HTTP 上传。覆盖文档摄入、图谱两类 Worker、检索重排、已保存内容预览、插件停启和正常删除；图像/PDF 场景同时检查安装目录外插件的原生依赖及 PDF ESM 加载。SSH 控制账号应具备计划任务和 CIM 访问权限，交互用户仍是已登录的普通测试用户；生产验收复用这两个账号的分工。安装树、profile、Workspace、任务、归属进程均在唯一 token 范围内，成功或失败都先取回日志/截图/回执再清理，不接触用户 App 数据。

同一场景从商店走默认保留与卸载删除两条分支，核对入口、运行产物、原文、Qdrant 集合、SQLite 状态和迁移账本。保留后重装要使用原索引、默认启用，且不能为旧资料重发嵌入请求；删除后重装必须是空库。保留和删除之后从普通用户端用 Win32 `FileStandardInfo.AllocationSize` 直接读取 NTFS 的实际分配量。原值留在证据里；按每个条目的完整 512 字节块转换后，与商店字节数和分类展示对照。不能用文件逻辑长度，或把另一次 `stat.blocks` 当成独立证据。

需要永久回执时通过工作台 `wb verify --require-evidence` 执行；默认 `createEvidence` 也会保留本机证据目录。失败场景不会自动置绿，清理时发现需要强制终止的残留进程也会失败。

## 索引重建回归

现有 `scripts/e2e/knowledge-index/desktop.acceptance.mjs` 保留五个原文保留、身份不匹配、失败、取消及重启恢复场景；其业务入口同样走正式插件 IPC/上传，模型用途从用户可见设置选择，不再导入已移除的 Renderer owner。

## macOS 隔离探针

`KNOWLEDGE_PLUGIN_MODE=bundled pnpm exec tsx scripts/e2e/knowledge-plugin/desktop.acceptance.mjs` 使用同一隔离探针，并显式选择现有磁盘 Renderer 模式；脚本断言 `plugin://knowledge/dist/renderer/index.js`、active 安装来源和真实界面入口，不能仅用 Backend IPC 成功推断 Renderer 已加载。默认 dev 模式仍用于源码界面调试。两种模式都记录实际入口 URL。

这是未打包 Host 上的真实插件产物验收，不等于 macOS 已签名安装包验收。运行前按正式插件构建/预置流程生成知识库 artifact；启动不会绕过 artifact 校验。

`pnpm exec tsx scripts/e2e/knowledge-plugin/surfaces.acceptance.mjs` 固定使用磁盘 Renderer：实际创建项目与关联，A 打开时右键 B 并核对摄入原文，检查 Markdown/Slides 原菜单，以及停用后的弹窗/入口撤销与关联保留。它只打开导出选项，不执行系统文件保存对话框。

两检索工具、深搜、分块读取及组装的项目范围与历史证据由插件的真实 SQLite/SoT/Host runtime 集成回归覆盖。现有产品 CLI 的基础工具白名单不包含知识库工具；本脚本不扩大该白名单，也不将集成回归写成 Desktop 上的工具执行。

`pnpm exec tsx scripts/e2e/knowledge-plugin/agent-lifecycle.acceptance.mjs` 在隔离 Desktop 的真实对话里发送消息，从插件商店操作启停、卸载和卸载并删除。合成模型在指定步骤等待，真实检索用随包 Qdrant。已经进入检索时要求阻止变更并显示等待提示；变更后旧响应才发来工具调用时，要求明确返回未执行、原对话完成，且新旧对话后续请求均不再看到被撤下的工具。回执记录工具名、截图、SQLite 运行与工具结果，不把启动、深搜或其它并发场景计为已验收。

`pnpm exec tsx scripts/e2e/knowledge-plugin/cleanup-crash.acceptance.mjs` 点击“卸载并删除”，确认合成目录已部分删除后强制结束自己的 Backend 和 Desktop。重启后把界面状态与安装记录、激活账本和指针、卸载标记、迁移、表和残留目录逐项对账，检查 SQLite 结构，再从界面重试。这只覆盖进程崩溃时的删除目录阶段：操作系统和磁盘缓存仍在；不等同于正常关机、虚拟机强断电或物理掉电，也不代表其他写入断点或平台已验收。

`pnpm exec tsx scripts/e2e/knowledge-plugin/reinstall-crash.acceptance.mjs` 用探针卸载并保留资料；另起隔离进程调用正式重装编排，在子进程已写入安装记录、尚未迁移和激活时强杀。复用同一 profile 真启动 Desktop，要求未提交重装仍可从商店安装，并保留原迁移及数据目录。这是进程崩溃回归，不把单独进程的精确断点写成从安装 IPC 点击触发的强杀。

`pnpm exec tsx scripts/e2e/knowledge-plugin/lifecycle-checkpoint.acceptance.mjs <checkpoint>` 从真实知识库界面创建测试库，停止 Desktop 后在同一隔离 profile 调用正式生命周期，并在精确写入点强杀验收子进程。支持 `uninstall-before-intent`、`uninstall-before-marker`、`cleanup-before-commit`、`cleanup-after-commit`。重新启动后从商店核对界面与 SQLite、激活记录、卸载标记和文件；清理最终事务未提交时，必须能从商店续清，事务已提交时不能出现假的“数据残留”。这些断点不模拟操作系统断电。
