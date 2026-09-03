# Linnya 开发指南

本目录覆盖从全新 clone 到本地开发、定向验证和跨平台排错的公开流程。发布签名、公证、上传凭据与受保护环境由维护者流水线拥有，不是普通开发前置条件。

## 快速开始

```bash
corepack enable
cargo install wasm-pack
pnpm install --frozen-lockfile
pnpm run dev:electron
```

需要 Node.js 24（精确版本见根目录 `.nvmrc`）、仓库锁定的 pnpm、Rust 和 `wasm-pack`。完整 Desktop 开发与原生能力验收使用 macOS 或 Windows。

`pnpm run dev:electron` 启动的是独立源码开发环境：不加载 Linnya Cloud 模型目录，不请求 Cloud 推理代理，也不自动检查正式版更新。本地体验使用内置目录、用户配置的 BYOK Provider 和本地数据，不需要 Linnya 账号或私有仓库。

## 按问题选择文档

| 场景 | 文档 |
| --- | --- |
| 安装依赖、启动、选择测试、构建和提交前检查 | [构建与测试](./build-and-test.md) |
| 判断什么时候写 README、文档放哪里以及如何避免重复真源 | [文档编写规范](./documentation.md) |
| 在 macOS 与 Windows 之间切换、重建平台依赖或重置开发数据 | [跨平台开发](./cross-platform.md) |
| 配置开发模式、工作区目录、调试开关与本地 API Key | [`.env.local` 开发配置](./env-local.md) |
| 排查 Electron/Node ABI、`better-sqlite3`、`node-pty` 等原生模块 | [原生模块 ABI 与测试](./native-modules.md) |

## 开发方法

1. 先从根目录 [AGENTS.md](../../AGENTS.md) 找到目标 owner，并阅读相邻 README、公开合同和调用链。
2. 先运行最小而真实的 owner gate，小范围通过后再扩大到相关集成测试、构建或全量测试。
3. 架构、目录、合同和开发流程发生变化时，同步更新正式文档。
4. 不提交凭据、开发者绝对路径、生成物、临时调试输出或对私有仓的依赖。

详细贡献要求见根目录 [CONTRIBUTING.md](../../CONTRIBUTING.md)，公共文档边界见[文档治理](../documentation-governance.md)。
