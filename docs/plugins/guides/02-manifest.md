# 02 · Manifest 与插件摘要

> 适用场景：写或改 `plugin.json`；派生 package meta；处理版本号。

## plugin.json

`plugin.json` 是插件身份证。schema 真源是 `packages/schemas/src/plugins/manifest.ts` 的 `PluginManifestSchema`。

### 必填字段

| 字段 | 用途 |
|---|---|
| `id` | 插件唯一 ID（小写、kebab-case），运行时入口、表归属、IPC 命名空间都以它为准。 |
| `version` | 插件自己的版本，不等于主应用版本。 |
| `name` | 插件商店和诊断展示名。 |
| `description` | 用户可见短介绍。 |
| `developer` | 开发者或维护方。 |
| `details` | 用户可见详细介绍，字符串数组，不支持 Markdown。 |
| `entry` | 运行时入口，至少声明一个。官方 runtime 插件通常同时有 `backend` 和 `renderer`。 |

`entry` 的键按运行宿主区分：

- `backend`：插件后端 contribution bundle；
- `renderer`：插件前端 contribution bundle；
- `command`：可选的独立插件领域 CLI entry，供人、开发脚本和 CI 的 command mode 启动。

`entry.command` 只声明当前插件 artifact 内的相对入口，不代表插件获得任意进程执行权限，也不进入
`PluginBackendContribution`。发布环境必须从当前 `active.json` 对应版本读取该 entry；插件停用、entry
缺失或文件缺失时 standalone CLI 不可用。Agent 不直接调用该 entry；App 为 Agent Shell 安装的是独立的
`linnya-<plugin>` 薄 client facade。

官方内置插件如需向 Agent 暴露 CLI，应通过 backend contribution 的 `pluginCli` 注册 opaque argv 能力。
该能力不写进 manifest、不允许第三方插件贡献，并受父 Shell 权限、execution-scoped bridge 和 draining
合同约束。
完整边界见 [21 插件 CLI 与宿主受控执行](./21-plugin-cli.md)。

### 常用可选字段

| 字段 | 用途 |
|---|---|
| `releaseNotes` | 插件详情页展示的版本更新记录。 |
| `screenshots` | 插件包内截图资源路径。 |
| `homepage` | 插件主页 URL。 |
| `skills` | 插件真正提供给用户使用的 Skill。没有就不要写；详见 [09 Skill 与资源](./09-skills.md)。 |
| `agents` | 插件带来的用户可感知 agent 能力说明（仅展示，非运行时注入）。 |
| `dependsOn` | 依赖插件 ID 列表，例如依赖 `platform`。 |
| `permissions` | 未来第三方安全模型字段，当前不执行权限隔离。 |
| `compat.minApp` | 最低主应用版本。安装和加载都会校验。 |
| `ownedFileTypes` | 插件拥有的文件类型归属，用于缺失态识别和安装引导。 |
| `ownedTables` | 插件拥有的数据表，用于升级备份和数据归属。 |
| `migrations` | 对外声明的插件迁移编号和说明，版本必须严格递增。 |

### 注意

- 插件商店图标不从 manifest 静态路径读取；renderer 插件应通过 document type / renderer contribution 暴露图标能力。
- `README.md` 是给开发者看的，不参与插件商店展示；用户详情必须放 `details`。
- manifest 展示字段不能偷偷改变运行时行为。agent prompt、tool schema、IPC 和数据迁移必须通过 contribution 注册。
- `entry.command` 是 standalone 运行文件定位事实，不是模型参数 schema。Agent facade 的 argv 仍由同一个
  插件 parser 拥有，但执行接入来自 `pluginCli` contribution并继承父 Shell 权限/生命周期；manifest 不复制业务字段。

## 插件摘要与发行身份

官方插件的 `PluginMeta` 由包内 `src/shared/pluginMeta.ts` 从 `plugin.json` 派生，派生函数真源是 `@app/schemas` 的 `pluginMetaFromManifest`。backend contribution 注册时把这份 meta 交给 `BackendPluginRegistry`；商店、启停、依赖判断和文件归属统一读取 registry，不在 Host 复制名称、版本、依赖或文件类型。

Core 不维护第二份官方 ID policy。当前发行要随包哪些插件，由 `scripts/release/plugin-release-targets.mjs` 与下游组合根决定；Plugin CLI 等高信任能力由明确的 backend direct dir 或已解析 bundled artifact 来源授予，不能按插件名字特判。

当前 registry 能覆盖平台 contribution，以及从 direct/active/bundled artifact 装配的插件。未来“未安装且未随包”的官方插件必须由验签后的 catalog 提供 discoverable meta，禁止为了 missing 展示重新 import 插件源码。

## 版本一致性（强制）

插件身份、展示、依赖、兼容范围和文件类型以 `plugin.json` 为唯一真源。`package.json.version` 仍是 npm/electron-builder 需要的结构化字段，必须与 `plugin.json.version` 保持一致。

- 必须在插件 owner 内有一致性测试防止跨文件契约漂移；公共发行组合可在 `packages/plugins/__tests__` 补跨插件验收。
- 一致性测试必须覆盖：`package.json.version === plugin.json.version`、`ownedTables === plugin.json.ownedTables`、`migrations` 列表、插件文档类型常量与 `ownedFileTypes` 一致。
- `ownedTables` 可以在包内保留 const 元组，用来提供字面量联合类型；但它必须与 `plugin.json.ownedTables` 完全一致。
- 新插件不要在 Host 文件里手写第二份 meta；随包身份与高信任来源都由发行组合输入决定，不在 Core 登记稳定插件 ID。
