# 开发脚本目录规范

`scripts/` 只承载开发、验证、构建和维护入口，不参与 Agent 工具注册，也不会进入模型可见工具面。

## 分类

- `development/`：本地开发启动与进程编排。只协调开发基础设施，不承载业务规则。
- `diagnostics/`：只读观察当前系统或数据状态。不得初始化数据库、执行迁移或修改业务数据。
- `maintenance/`：显式修改或清理开发数据。命令必须要求精确目标，并在文件头说明影响范围和运行时前提。
- `e2e/`：调用真实模块完成可重复的跨层验证；只有输出日志、没有断言或真实实现参与的手工实验不属于 E2E。
- `test-runner/`：为 Electron ABI 等运行时要求提供启动器，不拥有被执行脚本的业务语义。
- `guards/`：固化架构、合同与公共源码边界；不能承担自动修复业务代码的职责。`public-source-sanitization-guard.ts` 按结构拦截用户 Home、机器卷、盘符根开发 checkout、父级个人工作区路径、macOS 用户临时目录、绝对符号链接和已退役产品身份，不保存真实用户名、本机路径或旧名称字面量；`public-document-boundary-guard.ts` 只按仓库相对路径禁止跟踪内部过程文档，不知道私有仓位置。

Electron 开发入口由 `development/orchestration/startElectronDevelopment.mjs` 统一持有 Vite
dev server，再把实际 renderer URL 传给 Electron。服务只绑定 `127.0.0.1`，默认使用
`5173`，占用时切换到 `5174`；这两个端口与本地 API 的 CORS 安全边界保持一致。

Electron Backend 的公开 build/dev/watch 入口统一先执行
`prepare:backend-workspace-dependencies`。当前顺序是先构建跨端 schema，再构建运行时外置的
`@linnya/provider-catalog`，最后才允许 Backend bundle 启动。`watch:backend:dev` 是
`dev:electron` 完成初始构建后的内部 watcher，不是独立开发入口。不得依赖历史 `dist`、PATH
搜索或运行时 fallback 掩盖 workspace package 未构建；新增外置运行时 package 时必须进入同一
显式准备链，并提供可执行打包 smoke。

开发持久化断代统一执行 `pnpm run dev:data:reset`。入口位于
`maintenance/reset-development-data.ts`，只负责参数和结果展示；epoch、固定路径、准入和整体隔离规则由
app-level `development-data-lifecycle` workflow 持有。命令不接受路径参数，不得扩展成通用删除器。

## 与 `src/tools` 的边界

`src/tools/` 只承载真实 Agent 工具、紧邻 facade 和稳定跨工具合同。数据库检查器、数据重置命令、手工调试 CLI、benchmark 与测试脚本都必须留在 `scripts/`，即使它们会直接调用某个 Agent 工具类。

脚本应复用生产模块的公开入口，不复制业务规则。脚本需要 Electron 原生模块 ABI 时，通过 `scripts/test-runner/run-test-with-electron.cjs` 启动；不要为绕过 ABI 再实现一套数据库访问逻辑。
