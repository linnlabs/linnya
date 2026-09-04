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

开发入口会先按 `config/qdrant-runtime.json` 准备并校验目标平台 Qdrant，再准备公开 workspace 依赖、Node 原生依赖和 WASM，最后启动 Renderer 与 Electron。这个过程只发生在源码开发或打包阶段；Desktop 安装包通过 `extraResources` 携带已经校验的独立 runtime，最终用户启动应用时不再下载。

生成的 Qdrant 文件不进入源码版本控制。PDF 文本提取和转图统一使用 `pnpm-lock.yaml` 锁定的 `pdfjs-dist` 与 `@napi-rs/canvas`，不从 Homebrew、系统 `PATH` 或相邻仓库寻找实现，也没有额外 runtime 下载步骤。PDF 的多页内存与事件循环验证见 [`src/features/parsers/pdfParser/README.md`](../../src/features/parsers/pdfParser/README.md)。

启动失败时先修复最早失败的 owner gate；不要通过删除用户数据、增加 fallback 或绕过合同校验掩盖构建问题。

## 3. 按改动范围验证

先运行最小而真实的 owner gate，再按影响范围扩大。常用入口：

| 改动范围 | 验证入口 |
| --- | --- |
| Renderer TypeScript | `pnpm run typecheck:renderer` |
| Linnya CLI TypeScript | `pnpm run typecheck:linnya-cli` |
| 单个测试或业务链路 | `pnpm test -- <test-file>` |
| Renderer UI package | `pnpm --dir packages/renderer-ui run gate` |
| Schemas package | `pnpm run test:schemas-package-gate` |
| Provider catalog | `pnpm run test:provider-catalog-package-gate` |
| Slides plugin | `pnpm --filter @plugin/slides typecheck` 与 `pnpm --filter @plugin/slides test` |
| 全仓 TypeScript 存量债务 | `pnpm run guard:tsc-baseline` |
| 代码边界与格式 | 对修改文件运行 ESLint，并执行 `pnpm run lint:style`、`git diff --check` |

公共源码净化门禁使用 `pnpm run guard:public-source-sanitization`。它扫描 Git 已跟踪和未忽略的候选文本文件，拒绝开发者用户目录、机器卷、盘符根开发 checkout、父级个人工作区路径、macOS 用户临时目录、绝对符号链接和已退役产品身份；文档与测试只能使用 `name`、`example`、`${变量}` 或 `<用户名>` 一类明确占位符，门禁本身不得记录真实用户名、本机路径或旧名称字面量。

全仓仍有来自渐进式 JavaScript/TypeScript 迁移的存量类型错误。`guard:tsc-baseline` 将错误总数与 `.baseline/typescript-errors.txt` 对比，只允许减少、不允许增加，并在公共 CI 执行；错误减少后运行 `pnpm run guard:tsc-baseline:update` 收紧基线。这个债务门禁不能代替改动 owner 的严格 typecheck，新代码不得以“总数没有增加”为理由引入新的类型问题。

测试应覆盖真实业务流程、合同和失败语义。不要用 README snapshot、CSS 数值快照或无业务意义的覆盖率测试代替行为验收。

## 4. 构建

```bash
pnpm run build:wasm
pnpm run build:frontend
pnpm run build:main
```

正式 Desktop 安装器还涉及原生资源、签名、公证、SBOM、NOTICE 和三平台验收。普通贡献者不需要发布凭据；本地构建通过不等于产物可以发布。

源码运行、社区安装包和官方发行是三个不同身份。普通 `build:electron*` 或 ad-hoc
签名产物没有 Linnya 发行清单，运行时按 `community` 处理，不连接官方更新和 Cloud。
`official` 必须由受保护环境生成发行 payload、使用受信 Ed25519 私钥签名并与平台代码
签名共同进入发布证据；普通环境变量、`NODE_ENV=production` 和 `app.isPackaged` 都不能
提升发行身份。当前公开 key ring 尚未配置，正式 Desktop 发布仍处于关闭状态。

## 5. 原生模块与跨平台边界

`better-sqlite3`、Electron、图像与音频原生模块必须匹配当前 Node、Electron、平台和架构。切换 Node 或 Electron 版本后，先重新执行冻结安装，再运行仓库提供的 runtime 验证；不要复制另一台机器的 `node_modules`。

平台相关改动至少要区分：

- 可在普通 CI 验证的类型、合同和纯函数；
- 必须在真实 Electron 中验证的 ABI、进程与 IPC；
- 必须在目标操作系统验证的签名、权限、安装器和自动更新。

具体重建流程见[跨平台开发](./cross-platform.md)，ABI 与运行时验证合同见[原生模块 ABI 与测试](./native-modules.md)。

## 6. 凭据与网络

开发、测试和公共 CI 不应依赖维护者 token、私有 registry 或相邻私有仓。Provider 凭据只放在 Git 忽略的本地配置或用户运行时配置中；禁止写入 fixture、日志、命令行示例和构建产物。

仓库默认使用官方公开 registry。区域镜像只能是开发者自己的可选配置，不能写成项目成功构建的必要条件。

## 7. 提交前检查

- 修改属于正确的 domain、feature 或 package owner。
- 跨边界只使用 public contract、port、registry、event 或 app-level orchestration。
- 已运行与风险相称的 owner gate 和必要集成测试。
- 没有提交 secret、绝对本机路径、生成物、临时调试输出或私有源码依赖。
- 文档和稳定合同与实现保持一致。
