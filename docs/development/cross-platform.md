# 跨平台开发指南（Mac ⇄ Windows）

> 注意：本文讲的是 **Mac ⇄ Windows 平台**二进制重建。 `better-sqlite3@13` 使用 N-API 10 平台制品；Node 与 Electron 是否都能加载由 `pnpm run verify:better:runtimes` 真实查询验证。完整合同见[原生模块 ABI 与测试](./native-modules.md)。
>
> 本仓库使用 **pnpm**（见 `pnpm-workspace.yaml`）。下文命令统一使用 pnpm，请不要混用 npm。

常规安装、构建与测试见[构建与测试指南](./build-and-test.md)；返回[开发指南总览](./README.md)。

## 新电脑首次初始化

根工作区统一使用 `.nvmrc` 固定的 Node 22 开发版本，并使用 `package.json#packageManager`
固定 pnpm。Electron 开发还依赖 Rust/WASM 工具链，不能只安装 Node 依赖。

```bash
# 1. 启用 package.json 固定的 pnpm
corepack enable

# 2. 安装 Rust 后，安装 WASM 打包工具
cargo install wasm-pack

# 3. 安装工作区依赖；postinstall 会检查 Electron 二进制并验收目标平台原生制品
pnpm install --frozen-lockfile

# 4. 启动 Electron 开发环境
pnpm run dev:electron
```

依赖安装不要求 `packages/parser-wasm/pkg` 预先存在；该目录是 `dev:electron`
在安装完成后生成的构建产物。若全新 checkout 在 `pnpm install` 阶段要求先运行 `build:wasm`，说明 workspace
依赖合同发生了回归，不应通过提交生成目录解决。

验证工具链：

```bash
node --version
pnpm --version
rustc --version
wasm-pack --version
pnpm exec electron --version
```

同一次安装和开发会话中不要切换 Node 版本。确实切换后，运行 `pnpm run verify:better:runtimes`，重新验证 `better-sqlite3` 的 N-API 制品。

Electron 版本只由根 `package.json` 精确声明。平台 E2E 从这里读取版本，Windows controller 由 macOS orchestrator 显式传入预期值；fixture 不拥有第二份版本真相源。Windows 生产 fixture 直接验证 better-sqlite3 随包的 `prebuilds/win32-x64.node`，禁止重新下载历史 Electron ABI 压缩包。

## 开发数据断代与重置

默认 Electron 开发运行态统一保存在仓库根目录 `_dev_data`。目录根部的 `.linnya-development-data.json` 是应用级开发数据合同：启动会在数据库、插件 lifecycle、Model Catalog 和任务队列之前校验其中的 epoch。

持久化根目录由 Electron Desktop Host 在启动时解析并冻结，再以纯数据传给 Backend 与 Queue Worker。Worker 不根据自己的 `cwd` 推断仓库根，Backend 也不加载 Electron 或回退到用户 Home 下的另一套目录；正式运行态缺少路径事实会直接中止启动，避免 Main、App Server 和 Worker 写入不同数据根。

当前 epoch 是 2，对应桌面 Host Schema v61 当前事实基线。epoch 1 及更早目录不再进入运行时兼容链。

当持久化文件 envelope、SQLite baseline、跨领域标识或目录布局发生不兼容变化时，变更提交必须提升 `CURRENT_DEVELOPMENT_DATA_EPOCH`。旧目录不会被自动迁移或自动删除；启动会明确失败并只提示一个处理入口：

```bash
pnpm run dev:data:reset
```

执行前先停止所有开发进程。命令不接受自定义目标，只会把仓库根的 `_dev_data` 整体移入同盘 `.linnya-development-data-retired` 隔离目录，并输出原体积、顶层内容和可恢复位置。下次 `pnpm run dev:electron` 会先创建当前 epoch，再由各 domain 建立当前数据。

不要手工修改 `user_models.json` 版本、SQLite `user_version`、插件 migration 账本或单独删除插件表；这些操作会掩盖真实的持久化合同漂移。`LINNYA_WORKSPACE_DIR` 指向的外部 Workspace 不属于这个默认重置目标，做破坏式开发时应避免把它指向需要保留的数据。

持久化合同变更的评审清单固定为：提交说明必须明确写出“是否需要提升开发数据 epoch”；如果答案为是，同一提交必须更新 `CURRENT_DEVELOPMENT_DATA_EPOCH`、受影响 owner 文档，并验证旧 marker 在任何 domain 初始化前被拒绝。是否破坏兼容属于业务合同判断，不能靠扫描 migration 文件名的自动守卫猜测。

## 问题原因

当在 Mac 和 Windows 之间切换开发时，某些包含原生代码的 npm 包需要针对不同平台重新编译：

- `better-sqlite3` - SQLite 数据库绑定
- `canvas` - Canvas 图形库
- `electron` - Electron 二进制文件
- `@esbuild/win32-x64` / `@esbuild/darwin-arm64` - esbuild 平台二进制
- `@rollup/rollup-win32-x64-msvc` / `@rollup/rollup-darwin-arm64` - rollup 平台二进制

## 🚀 最快的切换方案

### 方案 1: 只重建原生模块（推荐）

切换平台后，运行：

```bash
pnpm run rebuild-native
```

这个命令会自动：

1. **构建 `@app/schemas` 包** - 确保前后端共享的类型定义是最新的
2. 重建所有原生模块 (better-sqlite3, canvas)
3. 重建 Electron 应用依赖
4. 下载 Electron 二进制文件（如果缺失）

### 方案 2: 手动重建

如果方案 1 有问题，可以手动执行：

```bash
# 1. 构建 schemas 包
cd packages/schemas
pnpm run build
cd ../..

# 2. 重建原生模块
pnpm rebuild

# 3. 重建 Electron 依赖
pnpm exec electron-builder install-app-deps

# 4. 如果 Electron 仍有问题
pnpm run setup:electron

# 5. 验收 better-sqlite3 的 Node / Electron N-API 制品
pnpm run verify:better:runtimes
```

### 方案 3: 完全重装（最慢但最可靠）

如果上述方案都不行：

```bash
# Windows PowerShell
Remove-Item -Recurse -Force node_modules
pnpm store prune
pnpm install --frozen-lockfile

# Mac/Linux
rm -rf node_modules
pnpm store prune
pnpm install --frozen-lockfile
```

## 📝 最佳实践

### ✅ 应该做的

1. **依赖锁定与包管理器**
   - 本仓库实际使用 **pnpm**：已提交 `pnpm-workspace.yaml`（定义 monorepo workspaces 与 `onlyBuiltDependencies` 原生包编译白名单），`node_modules` 为 pnpm 布局（`.pnpm/`）。
   - 请用 `pnpm install` 安装依赖，并提交 `pnpm-lock.yaml` 锁定版本，保证团队一致。
   - `package.json` 的 `packageManager` 字段固定了 pnpm 版本，配合 Corepack 可自动使用正确版本。

2. **配置国内镜像**
   - 项目已配置 `.npmrc`，包含 npm/pnpm 通用 registry 与 Electron 镜像
   - 避免网络问题

3. **切换平台后的标准流程**
   ```bash
   git pull
   pnpm install            # 安装/同步依赖（含原生模块按平台重建）
   pnpm run rebuild-native # 如仍有原生模块未对齐，再手动重建
   pnpm run dev:electron
   ```

### ❌ 不应该做的

1. **不要混用包管理器**
   - ❌ 不要用 `npm install` / `npm ci`：会写回已废弃的 `package-lock.json`，与 pnpm 的安装结果漂移。
   - ❌ 不要把 `pnpm-lock.yaml` 加入 `.gitignore`——它是 pnpm 的版本锁定来源，必须提交。
   - ✅ 统一用 **pnpm**；原生包的编译白名单见 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies`（已含 `better-sqlite3`、`electron`、`sharp` 等）。

2. **不要每次都删除 node_modules**
   - 太慢了！
   - 大多数情况下 `pnpm rebuild` 就够了

## 🔧 已配置的镜像

项目的 `.npmrc` 已配置：

```ini
registry=https://registry.npmmirror.com
```

说明：

- 依赖下载继续使用 `npmmirror`。
- Electron 二进制资源使用镜像：
  - `https://npmmirror.com/mirrors/electron/`
- electron-builder 辅助二进制（如 `dmg-builder`）默认使用官方源。
- 根因：当前 `npmmirror` 缺少 `dmg-builder@1.2.0` 资源，会导致 mac 打包 404。
- 避免使用旧路径 `registry.npmmirror.com/-/binary/...`。
- 如需临时覆盖，可在执行打包命令前设置：
  - `ELECTRON_MIRROR`
  - `ELECTRON_BUILDER_BINARIES_MIRROR`

## 📦 已添加到 .gitignore 的文件

- `temp/` - 临时文件
- `temp_tsup/` - tsup 临时构建文件
- `dump.rdb` - Redis 数据文件
- `packages/parser-wasm/target/` - Rust 编译产物
- `$null` - Windows 特殊文件

## 🛠️ Windows 开发环境要求

在 Windows 上编译原生模块（如 `better-sqlite3`）需要安装 Visual Studio 构建工具。

### 安装 Visual Studio Build Tools

**方法 1: 安装 Visual Studio Build Tools（推荐）**

1. 下载 [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)
2. 运行安装程序，选择 **"使用 C++ 的桌面开发"** 工作负载
3. 确保勾选以下组件：
   - MSVC v143 - VS 2022 C++ x64/x86 生成工具
   - Windows 10/11 SDK
   - C++ CMake 工具（可选但推荐）

**方法 2: 安装完整版 Visual Studio**

如果已安装 Visual Studio，确保包含 **"使用 C++ 的桌面开发"** 工作负载。

**验证安装：**

```powershell
# 检查是否安装了 Visual Studio
& "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe" -latest
```

安装完成后，重新运行 `pnpm run rebuild-native`。

## 🐛 常见问题

### 问题 0: `Could not find any Visual Studio installation to use`

**现象:**

```
Error: Could not find any Visual Studio installation to use
```

**原因:** Windows 上缺少 Visual Studio 构建工具，无法编译原生模块

**解决方案:**

1. 按照上面的 **"Windows 开发环境要求"** 安装 Visual Studio Build Tools
2. 安装完成后，重新运行：
   ```bash
   pnpm run rebuild-native
   ```

### 问题 0.5: `Failed to resolve import "parser-wasm"` 或 `'wasm-pack' 不是内部或外部命令`

**现象:**

```
Failed to resolve import "parser-wasm" from "apps/renderer/shared/services/markdownService.js"
或
'wasm-pack' 不是内部或外部命令，也不是可运行的程序或批处理文件。
```

**原因:**

- `parser-wasm` 是一个 Rust 编写的 WebAssembly 模块，需要先构建才能使用
- 构建需要安装 Rust 工具链和 `wasm-pack`

**解决方案:**

**步骤 1: 安装 Rust 工具链**

1. 访问 [Rust 官网](https://www.rust-lang.org/tools/install) 或直接运行：

   ```powershell
   # Windows (PowerShell)
   Invoke-WebRequest https://win.rustup.rs/x86_64 -OutFile rustup-init.exe
   .\rustup-init.exe
   ```

   或者下载并运行 [rustup-init.exe](https://win.rustup.rs/x86_64)

2. 安装完成后，**重新打开 PowerShell** 或运行：
   ```powershell
   $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
   ```

**步骤 2: 安装 wasm-pack**

```powershell
# 使用 cargo（Rust 的包管理器）安装 wasm-pack
cargo install wasm-pack
```

**步骤 3: 构建 parser-wasm**

```bash
pnpm run build:wasm
```

**注意:**

- `pnpm run dev:electron` 会固定先执行 `build:wasm`，因此 Electron 开发不能跳过该工具链
- 单独运行已经具备 WASM 产物的纯前端页面时可以不重复构建，但首次初始化仍应完成本步骤
- Rust 工具链安装大约需要 200-300MB 空间

### 问题 1: `DEFAULT_MAX_STEPS` 是 `undefined` 或其他常量未定义

**现象:**

```
[GraphExecutor] 开始推理循环，最大节点切换步数: undefined
```

**原因:** `@app/schemas` 包没有构建，或使用的是 Mac 构建的旧版本

**解决方案:**

```bash
# Windows PowerShell
cd packages/schemas; pnpm run build; cd ..\..

# Mac/Linux
cd packages/schemas && pnpm run build && cd ../..

# 或者直接运行
pnpm run rebuild-native
```

### 问题 2: `Cannot find module 'better-sqlite3'`

**解决方案:**

```bash
pnpm run verify:better:runtimes
```

### 问题 3: `Electron failed to install correctly`

**原因:** `electron` 的 JavaScript 包已经存在，但对应平台的 Electron 二进制下载被跳过或中断，因此缺少 `node_modules/electron/dist` 或 `path.txt`。

**解决方案:**

```bash
pnpm run setup:electron
pnpm exec electron --version
pnpm run verify:better:runtimes
```

### 问题 4: `Cannot find module @esbuild/win32-x64`

**解决方案:**

```bash
pnpm install --frozen-lockfile
```

### 问题 5: `Cannot find module @rollup/rollup-win32-x64-msvc`

**解决方案:**

```bash
pnpm install --frozen-lockfile
```

### 问题 6: 安装时 `prepare` 脚本失败（husky / yarn 相关错误）

**现象:**

```
husky - install command is DEPRECATED
'yarn' 不是内部或外部命令
```

**原因:**

- `prepare` 脚本会运行 `husky`，但可能缺少 `.git` 目录或 husky 未初始化
- 某些依赖包的脚本需要 `yarn`，但系统未安装

**解决方案:**

**方案 A: 正常恢复安装（推荐）**

```bash
pnpm install --frozen-lockfile
```

不要把 `--ignore-scripts` 当作 Electron 开发环境的常规安装方案。本项目依赖 install/postinstall 下载 Electron 二进制并生成原生模块；跳过后会留下“包存在、平台二进制缺失”的半安装状态。

**方案 B: 初始化 husky（如果使用 git）**

```bash
pnpm exec husky init
```

**方案 C: 安装 yarn（如果依赖需要）**

```bash
pnpm add -g yarn
```

**方案 D: 确实必须跳过依赖脚本时，显式补齐项目构建链**

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run setup:electron
pnpm run rebuild-native
```

## 💡 时间对比

| 方法 | 时间 | 适用场景 |
| --- | --- | --- |
| `pnpm run dev:frontend` | ~5秒 | **只开发前端 UI**（推荐） |
| `pnpm run rebuild-native` | ~1-3分钟 | 平台切换后首选；会重建并验收目标平台原生制品 |
| `pnpm rebuild` | ~10秒 | 快速重建 |
| `pnpm install --frozen-lockfile` | ~1-2分钟 | 有其他问题时 |
| 删除 node_modules 重装 | ~3-5分钟 | 最后手段 |

## 📚 相关资源

- [pnpm CLI 文档](https://pnpm.io/cli/rebuild)
- [Electron 安装文档](https://www.electronjs.org/docs/latest/tutorial/installation)
- [原生模块文档](https://nodejs.org/api/addons.html)
