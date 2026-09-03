# 原生模块 ABI 与测试运行方式

本文定义 Node、Electron 与平台原生制品的验证合同。常规安装与构建入口见[构建与测试](./build-and-test.md)，操作系统切换流程见[跨平台开发](./cross-platform.md)。

## 1. 正式运行时

当前桌面基线为 Electron `43.4.0`：

| Runtime | Node | Chromium / V8 | Module ABI | N-API |
|---|---:|---:|---:|---:|
| Electron 43.4.0 | 24.18.1 | 150 / 15.0 | 148 | 10 |
| 开发 Node | 22.19+ | 由本机 Node 决定 | 由本机 Node 决定 | 10 |

Electron 的 Module ABI 仍与普通 Node 不同，绑定 V8 ABI 的模块必须针对 Electron 重建；N-API 模块则按 N-API 版本、平台和架构复用制品。

## 2. better-sqlite3 的 N-API 合同

`better-sqlite3@13.0.3` 已使用 N-API 10，并在 `prebuilds/` 提供受支持平台制品。仓库不再生成或维护 `better_sqlite3-node-<abi>.node` 双二进制，也不再通过 Vitest shim 注入测试专用 binding。

安装门禁 `scripts/native/verify-better-sqlite3-runtimes.cjs` 会：

1. 根据当前平台、libc 和架构定位唯一制品；
2. 检查二进制文件头的目标平台和 CPU；
3. 用当前开发 Node 打开内存数据库并查询；
4. 用正式 Electron runtime 再执行同一查询。

任一步失败都会让 `postinstall` 失败。不能跳过该模块、复制其他平台制品或退回旧 ABI。

常用命令：

```bash
pnpm run verify:better:runtimes
pnpm run guard:better:electron
```

切换 Node、Electron、操作系统或 CPU 架构后，重新执行 `pnpm install --frozen-lockfile`；需要重建全部原生能力时执行 `pnpm run rebuild-native`。

## 3. 其他原生模块

- `@discordjs/opus` 使用 N-API v3。安装流程按当前 Electron ABI 生成唯一发布目录，并验证平台/架构。
- `node-pty` 使用 N-API，但还包含 macOS `spawn-helper`；发布前必须同时验证 `.node`、helper 权限、签名和打包路径。
- `sharp`、`@img/*`、`@node-rs/*` 使用平台制品；生产包只允许包含目标平台和架构。
- 任何仍直接绑定 V8 ABI 的模块都必须由 `@electron/rebuild` 的公共 API针对精确 Electron 版本重建。

`scripts/native/run-electron-rebuild.cjs` 是仓库唯一的 electron-rebuild 调用入口。业务脚本不能依赖 `@electron/rebuild/lib/*` 内部路径，也不能用 `npx` 临时下载另一版本。

## 4. 测试边界

- 普通业务测试：`pnpm test`，直接加载 N-API 制品。
- Electron 行为或打包边界：使用对应 `test:*:electron` / packaged E2E。
- 需要 Electron runtime 运行某个脚本：`node scripts/test-runner/run-test-with-electron.cjs <脚本>`。
- 不要把普通 Node 单测当成原生模块的最终验收；正式包仍要在安装态执行数据库查询。

## 5. 生产打包

`dist_build` 使用 `npm install --ignore-scripts` 生成扁平依赖后，构建脚本会：

1. 确认 `better-sqlite3/prebuilds/<platform>-<arch>.node` 存在且目标正确；
2. 删除其他平台和架构的 better-sqlite3 制品；
3. 验证根工作区 Node/Electron 双 runtime 查询；
4. 由安装态 E2E 再验证 asar.unpacked 中的真实制品。

`asarUnpack` 只解决原生文件不能在 asar 内直接加载的问题，不证明 ABI、N-API、平台或签名正确。

## 6. 排错

- Electron 包壳存在但二进制缺失：`pnpm run setup:electron`。
- better-sqlite3 任一 runtime 加载失败：重新执行 `pnpm install --frozen-lockfile`，再运行 `pnpm run verify:better:runtimes`。
- 平台切换后 Sharp、Opus、node-pty 失败：`pnpm run rebuild-native`。
- `node-abi` 无法解析 Electron：升级正式锁定的工具链；禁止退出 0 或改用旧 Electron。

CI / 离线环境需要同步维护 `pnpm-workspace.yaml` 的构建脚本白名单，并缓存精确 Electron 二进制与头文件。缓存命中不能替代真实 runtime smoke。
