# Linnya 构建与测试指南

本文面向公开仓贡献者，说明从全新 clone 到本地开发、定向验证和非发布构建的稳定入口。发布签名、公证、上传凭据与受保护环境由维护者流水线拥有，不是普通开发前置条件。

返回[开发指南总览](./README.md)。本地环境变量见 [`.env.local` 开发配置](./env-local.md)；平台切换与原生依赖问题分别见[跨平台开发](./cross-platform.md)和[原生模块 ABI 与测试](./native-modules.md)。

## 1. 前置环境

- Node.js 24；精确版本见根目录 `.nvmrc`，支持范围见 `package.json#engines`。
- Corepack 与仓库锁定的 pnpm 版本。
- Rust 工具链和 `wasm-pack`，用于构建 `packages/parser-wasm`。
- macOS 或 Windows。涉及签名、安装器和平台原生能力的最终验收必须在对应真实平台完成。

```bash
corepack enable
cargo install wasm-pack
```

## 2. 安装与启动

```bash
git clone https://github.com/linnlabs/linnya.git
cd linnya
pnpm install --frozen-lockfile
pnpm run dev:electron
```

`pnpm-lock.yaml` 是根工作区唯一依赖锁文件。不要在根目录或 workspace package 中运行 `npm install`，也不要提交 `node_modules`、WASM 生成目录、构建产物或本地凭据文件。

安全依赖升级需要覆盖根应用、插件和独立 E2E fixture 的实际消费者，以及仍引用旧版本的
间接依赖；检查 lock diff，避免同时刷新无关 peer 依赖。原生图像依赖升级后，除冻结安装、
类型和业务测试外，还需执行 Slides 的 `smoke:raster-worker`，验证真实 Electron 像素链路。
同步使用 `release:lock:production:update` 更新发行专用 `production-package-lock.json`，
通过 `release:lock:production:verify` 与 `release:lock:production:install-smoke` 验证；
重新生成第三方 NOTICE，并核对原生包的许可证补充证据版本。源码 lock 更新不代表发行锁、
独立 fixture 或 NOTICE 已自动同步，macOS 冒烟也不能代替 Windows 真机验收。

如果安全修复使用了 pnpm 的 transitive override，且该依赖会进入 Desktop 发行树，必须同时维护
根 `package.json` 的 npm `overrides` 并重新生成发行锁；pnpm 工作区锁和 npm 发行锁是两个独立的
解析边界。升级原生模块后还要执行一次真实安装脚本和最小加载冒烟，确认 override 没有只修复审计
结果却破坏 ABI 或运行时加载。

URL tarball（如 SheetJS）也必须保留 `resolution.integrity`。更新锁文件后核对下载内容的
SHA-512 与发行锁一致，再生成 Source BOM；不能因为来源不是 npm registry 而放过缺失 hash。

SRT 0.0.81 的配置 schema 已显式使用 `zod/v3`，可复用 Zod 4 包内的官方兼容入口。
当前两个安装边界均仅对 SRT 的依赖范围覆盖为 4.6.7；这不把其 schema 强行改成 v4 API。
上游放宽依赖范围后可移除此定向覆盖。升级 SRT 必须回归 macOS pipe/PTY 的真实文件权限与进程回收。

Windows 受限 Shell 的完整 CLI 回归使用 `test:shell-tool:windows-current-host-cli-corpus`。除 SSH host/user/key 外，须指定 `LINNYA_WINDOWS_INTERACTIVE_USER`：专用 VM 中已经登录桌面的普通测试用户。SSH 管理员只安装和回收测试账户组件；实际打包 Electron、PowerShell、插件 CLI 与审批链路通过该普通用户的交互式任务运行。不能把 SSH 的 Session 0 当作桌面登录环境；回归拒绝覆盖用户已有的隔离服务，结束后回收本次任务、服务、账户和文件。

macOS 的 `test:shell-tool:production-command-approval-dom` 使用真实 Renderer/Preload，覆盖内部存储的三档权限、本次批准与保存规则。两类 E2E 都会重建 command runner，须顺序运行，不能共享 `dist/main/commands` 并发构建。

产品及官方插件使用正式 npm Linnkit 0.41.0 与 Zod 4.6.7。Zod 主版本升级必须同时检查
模型列表的缺省字段、工具错误路径、图表诊断与递归 JSON 输入类型，并重建 schemas 的 CJS/ESM
产物和生产锁。不能只通过依赖覆盖声明兼容；运行合同与独立打包消费门禁都必须通过。

开发入口按依赖图并行准备 runtime、WASM、资源和 workspace package。每个长期 watcher 只执行一次首次构建；
收到本轮成功事件、完成资源复制和 Backend/原生依赖门禁后才启动 Electron。Vite 在自己的依赖就绪后提前启动并预热入口。
开发会话退出或首次构建失败时，统一关闭本次创建的进程和 Vite。只验证准备阶段、不打开应用可运行
`pnpm run dev:electron --build-only`；多 worktree 可同时运行相同命令，隔离规则见[开发配置](./env-local.md)。具体职责见 [build-session](../../scripts/development/features/build-session/README.md)。

Qdrant 与 Headless Node 按各自锁定目录准备。已安装 Node 的 manifest、目标平台、归档身份与可执行文件 hash
通过正式 runtime resolver 校验后直接复用；宿主目标还验证实际 Node 版本。损坏或版本变化才重新准备，不能仅凭文件存在跳过校验。
这些准备只发生在源码开发或打包阶段；Desktop 安装包通过 `extraResources` 携带已经校验的独立 runtime，最终用户启动应用时不再下载。

App Server ready 仍要求本地数据库、目录恢复和正式路由可用；账号的远端模型目录刷新在此后由 Backend owner
后台执行，完成后通知 Renderer 重读目录。上游网络慢不会阻塞开窗。设置页面按实际进入的 Tab 加载；Vite 不监听运行数据与隐藏窗口生成物，避免写日志或 worker 构建触发主页面重载。

生成的 Qdrant 文件不进入源码版本控制。PDF 文本提取和转图统一使用 `pnpm-lock.yaml` 锁定的 `pdfjs-dist` 与 `@napi-rs/canvas`，不从 Homebrew、系统 `PATH` 或相邻仓库寻找实现，也没有额外 runtime 下载步骤。PDF 的多页内存与事件循环验证见 [`src/features/parsers/pdfParser/README.md`](../../src/features/parsers/pdfParser/README.md)。

启动失败时先修复最早失败的 owner gate；不要通过删除用户数据、增加 fallback 或绕过合同校验掩盖构建问题。

Renderer 业务代码由 Rollup 按依赖图和动态 import 分块；不要按 Editor、Conversation 等目录强制切割互相引用的模块。
这种切割曾使正式包在常量初始化前访问它而白屏，开发服务器并不能复现。构建将 `CIRCULAR_CHUNK`
视为错误；第三方 vendor 缓存块和独立的图表动态入口仍保留。修改分块必须验证编译后的成品首次开窗，不能只看 Vite 构建退出码。

## 3. 按改动范围验证

先运行最小而真实的 owner gate，再按影响范围扩大。常用入口：

| 改动范围 | 验证入口 |
| --- | --- |
| Renderer TypeScript | `pnpm run typecheck:renderer` |
| Linnya CLI TypeScript | `pnpm run typecheck:linnya-cli` |
| 无 Electron CLI Runtime | `pnpm run test:linnya-runtime:e2e` |
| 单个测试或业务链路 | `pnpm exec vitest run <test-file> [<test-file>...]` |
| Renderer UI package | `pnpm --dir packages/renderer-ui run gate` |
| Schemas package | `pnpm run test:schemas-package-gate` |
| Provider catalog | `pnpm run test:provider-catalog-package-gate` |
| Slides plugin | `pnpm --filter @plugin/slides typecheck` 与 `pnpm --filter @plugin/slides test` |
| 全仓 TypeScript 存量债务 | `pnpm run guard:tsc-baseline` |
| 代码边界与格式 | 对修改文件运行 ESLint，并执行 `pnpm run lint:style`、`git diff --check` |

凭据持久化变更需覆盖 App Server 的 `credentialPersistence.integration.test.ts` 与
Backend Worker 的 `workerModelCredentials.integration.test.ts`：前者验证模型、OAuth、插件的
保存/重启、损坏保护、并发进程和写入中断，后者验证独立线程的模型 Key、OAuth 与环境变量。
Web Search/Read 的配置持久化测试覆盖各自 namespace 与脱敏视图。执行 Main、Backend、Worker
构建后，继续跑 Shell 的真实 macOS 审批 DOM 和 Windows 普通用户 CLI corpus，验证实际
`credentials.json` 在三档权限下的访问结果。记录实际测试的 Windows 版本和架构；兼容目标不能表述为已完成实机验证。

Sandbox 的跨平台打包验收入口是 `test:shell-tool:formal-electron-sandbox`（macOS）和
`test:shell-tool:windows-formal-electron-sandbox`（macOS 经 SSH 控制 Windows）。两者共用
`scripts/e2e/shell-tool/harness/buildFormalSandboxFixture.mjs`，将 Slides profile 打成独立 CJS
制品，并用插件正式构建入口携带最小 TypeScript runtime，避免源码内联或本机依赖掩盖安装态缺失。
这组 fixture 验证 Sandbox 运行合同，不代替完整 Desktop 安装包验收。

定向运行时直接把测试文件或目录交给 Vitest，也可以使用 `pnpm test <test-file>`。不要在
`pnpm test` 后添加 `--`：pnpm 会把它原样传给 `vitest run`，后面的路径不再成为文件过滤条件，
从而运行整个测试发现范围。需要预览命中文件时使用 `pnpm exec vitest list <test-file> --filesOnly`，
该命令只列出文件，不执行测试。

根 Vitest 配置只从 `src/`、`apps/`、`packages/` 和 `scripts/` 发现测试，并排除依赖、
构建输出、运行数据和临时目录；`_dev_data/` 中的冻结源码与 benchmark 产物不属于当前测试集。
Vitest 不自动沿用 `.gitignore`，新增源码根或生成目录时必须同时检查发现边界。正式源码内的
`fixtures/`、`testkit/` 等测试支持目录仍可被发现，不能通过统一排除夹具目录来消除失败。
排除规则应指向生成物 owner；`storage`、`logs`、`temp` 也可以是合法业务目录名，不能全局排除。
开发运行时的这些目录由 `_dev_data/` 边界覆盖，仓库根的历史临时构建目录则在源码发现范围之外。

公共源码净化门禁使用 `pnpm run guard:public-source-sanitization`。它扫描 Git 已跟踪和未忽略的候选文本文件，拒绝开发者用户目录、机器卷、盘符根开发 checkout、父级个人工作区路径、macOS 用户临时目录、绝对符号链接和已退役产品身份；文档与测试只能使用 `name`、`example`、`${变量}` 或 `<用户名>` 一类明确占位符，门禁本身不得记录真实用户名、本机路径或旧名称字面量。

全仓仍有来自渐进式 JavaScript/TypeScript 迁移的存量类型错误。`guard:tsc-baseline` 将错误总数与 `.baseline/typescript-errors.txt` 对比，只允许减少、不允许增加，并在公共 CI 执行；错误减少后运行 `pnpm run guard:tsc-baseline:update` 收紧基线。这个债务门禁不能代替改动 owner 的严格 typecheck，新代码不得以“总数没有增加”为理由引入新的类型问题。

依赖升级后若大量错误集中在命名空间类型、公开导出或推断链上，应先验证实际 npm 包的声明产物，
不能直接调高或重建基线把依赖回归记成存量债。Linnkit 只使用已发布的精确版本；声明问题在独立
Linnkit 仓修复并通过不含源码 alias 的产物类型门禁后发布，Linnya 再升级、复测并收紧原有基线。
禁止修改 `node_modules`、回连相邻源码或扩大类型断言来绕过这条验收链。

测试应覆盖真实业务流程、合同和失败语义。不要用 README snapshot、CSS 数值快照或无业务意义的覆盖率测试代替行为验收。

## 4. 构建

```bash
pnpm run build:wasm
pnpm run build:frontend
pnpm run build:main
```

源码开发可用 `pnpm run build:linnya-runtime` 同时构建 Backend、固定 runtime 辅助产物和 CLI bundle，再用 `pnpm linnya:runtime --workspace <绝对路径>` 启动前台 Host。这个入口不启动 Electron，也不代表安装器已经把 CLI 发布到系统 `PATH`。完整使用与能力限制见 [`apps/linnya-cli/README.md`](../../apps/linnya-cli/README.md)。

正式 Desktop 安装器还涉及原生资源、签名、公证、SBOM、NOTICE 和三平台验收。普通贡献者不需要发布凭据；本地构建通过不等于产物可以发布。

源码运行、社区安装包和官方发行是三个不同身份。普通 `build:electron*` 或 ad-hoc
签名产物没有 Linnya 发行清单，运行时按 `community` 处理，不连接官方更新和 Cloud。
`official` 必须由受保护环境生成发行 payload、使用受信 Ed25519 私钥签名并与平台代码
签名策略共同进入发布证据（Windows 可显式选择[正式未签名模式](../../src/infra/adapters/local-process-runtime/windows/README.md#7-打包和发布风险)）；普通环境变量、`NODE_ENV=production` 和 `app.isPackaged` 都不能
提升发行身份。生产打包显式使用 `--publish never`，上传由独立发布步骤负责。公开 key ring 位于 `src/electron-main/distribution/registry/`，只含公钥。

## 5. 原生模块与跨平台边界

`better-sqlite3`、Electron、图像与音频原生模块必须匹配当前 Node、Electron、平台和架构。切换 Node 或 Electron 版本后，先重新执行冻结安装，再运行仓库提供的 runtime 验证；不要复制另一台机器的 `node_modules`。

App Server 与后台 Worker 使用独立 Node，只能读取物理文件，不能解析 `app.asar`。生产
`node_modules` 统一解包，包括原生加载器的 JavaScript 依赖与 Worker 的普通 npm 依赖；
不维护只覆盖顶层原生包的零散名单。Tiktoken 按包目录定位 WASM，必须保留 external 包边界。
安装验收必须把完整 App 复制到仓库外再启动；仅在 `dist_build` 内运行可能借用祖先目录的
`node_modules`，掩盖安装包漏依赖。平台源码 CI 同时执行官方插件 artifact 编排，验证
Windows 的批处理入口和 Mac 的直接进程入口均可完成构建与打包。
此入口自行先编译插件依赖的公共 schemas；平台 CI 在其他构建之前运行它，保证干净 checkout
不依赖本机残留的 `packages/schemas/dist`。

平台相关改动至少要区分：

- 可在普通 CI 验证的类型、合同和纯函数；
- 必须在真实 Electron 中验证的 ABI、进程与 IPC；
- 必须在目标操作系统验证的签名、权限、安装器和自动更新。

具体重建流程见[跨平台开发](./cross-platform.md)，ABI 与运行时验证合同见[原生模块 ABI 与测试](./native-modules.md)。

Shell 的 packaged Agent E2E 在独立进程中同时安装 scripted 推理目录与 Host 模型目录，
让持久化 Run 准入读取真实模型事实；夹具账号投影只驻留内存，不访问用户凭据。
Graph 与 AgentRunner 通过 `createProductionE2eGraphRuntime` 绑定同一执行事务，
先持久化工具执行意图，再提交结果 receipt；不能把非持久化 Graph 与可恢复 Run 混装。
Windows 夹具应与产品同步 SQLite N-API 版本，并随包携带后端需要的 HarfBuzz loader。
Sharp 的公开入口可能是 JavaScript loader；PE 架构校验通过共享
`scripts/e2e/shell-tool/harness/resolveWindowsSharpBinary.mjs` 定位包内原生制品，不能把入口脚本当作 DLL。

## 6. 凭据与网络

开发、测试和公共 CI 不应依赖维护者 token、私有 registry 或相邻私有仓。Provider 凭据只放在 Git 忽略的本地配置或用户运行时配置中；禁止写入 fixture、日志、命令行示例和构建产物。

仓库默认使用官方公开 registry。区域镜像只能是开发者自己的可选配置，不能写成项目成功构建的必要条件。

## 7. 提交前检查

- 修改属于正确的 domain、feature 或 package owner。
- 跨边界只使用 public contract、port、registry、event 或 app-level orchestration。
- 已运行与风险相称的 owner gate 和必要集成测试。
- 没有提交 secret、绝对本机路径、生成物、临时调试输出或私有源码依赖。
- 文档和稳定合同与实现保持一致。

## 并行 Desktop 回归

完成 `pnpm run dev:electron --build-only` 后，macOS 可运行 `pnpm run test:development:parallel-desktop`。
该 gate 用当前正式构建产物启动三个临时开发实例，覆盖 Renderer/API/Qdrant 端口、profile、CLI 描述、
向量数据隔离、同目录单实例和独立退出；不读取开发者数据库或调用模型，结束后清理临时进程与文件。
Windows 的 profile 与动态端口逻辑共用同一实现，仍需 Windows 真机验收；该 gate 不代替平台发布验收。

Slides 的源码 ESLint 由 `pnpm --filter @plugin/slides lint` 执行，并纳入公共 package CI。
Sandbox 生成的 ambient DSL 声明是供独立 deck.js 消费的 API，保留公开类型，不按宿主引用数删除。

### Slides 系统编辑身份回归

身份实现与兼容边界见 [owner 文档](../../packages/plugins/slides/src/backend/sandbox/authoringIdentity/README.md)。修改调用追踪、人工值或源码写回时，至少运行该目录集成测试、manual-edit 保存重开与历史集成测试、Slides 全量测试、类型/lint、codegen-first 检查及 backend artifact smoke；选择交互和提示变动还需原生 preview-transitions。实际验收用 Linnya CLI 的 Workspace write/read/edit 回执记录文稿、修订与诊断，再验证预览和导出。CLI 工具调用不使用 LLM，不能记为模型质量实验。

修改 `slides:view-snapshot` 协议后，还必须完全退出对应 Desktop 开发实例，从该工作目录重新启动并打开真实文稿。Vite 热更新、构建成功与独立 CLI 渲染不证明正在运行的 Backend 已使用新协议；版本不一致必须明确报告并保留原文稿，不能通过放宽 codec 或转换版本号掩盖。
