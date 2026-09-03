# 15 · 发布与分发

> 适用场景：打 artifact、上传 R2、发版检查、配置发布目标与环境变量。

## 和 Linnya 主应用发版的边界

本章只管 **runtime 插件** 的 artifact、R2 发布、`plugin.json` / 插件
`package.json` 版本、插件迁移与升级 smoke。Linnya 桌面应用本体的 `0.0.x`
版本、`release-notes.md`、关于页发布数据和安装包上传清单，走
[`scripts/release/README.md`](../../../scripts/release/README.md)。

每个插件和主应用都是独立发布线：主应用 bump 不自动 bump 插件；一个插件发布也不自动修改 Linnya 主应用或其他插件版本。桌面安装包可以预置锁定插件版本，安装后仍允许按插件独立升级、回滚或撤回。

源码可见性与生产发布正交：Slides/Mindmap 可以在公共仓发布，SupplyStrata 可以在私有下游发布，但所有正式 artifact 都由受保护流程写入 Cloudflare
R2。“Linnya
Cloud 发布插件”是这条 R2 分发能力的产品统称，并不表示另有一个常驻插件发布服务。通用上传脚本可以跟随源码，正式 R2 凭据和签名材料不能进入 Git。

当前 R2/`latest.json`/SHA512 链路已经能校验下载内容是否与发布清单一致，但未签名清单不能单独证明其由 Linnya 发布方签发。packaged 官方来源、catalog 签名、启动准入与开发直载隔离以
[`生产插件分发与信任策略`](../production-distribution-and-trust.md)
为准；对应门禁完成前，不把现有远程链路描述为完整的生产官方身份验证。

Renderer 插件还受 `@linnya/renderer-ui` 独立 SemVer 合同约束。插件的 peer
range、 `plugin.json.compat.rendererUi` 与 `latest.json.rendererUi`
必须一致；兼容 patch/minor 不要求重建插件 artifact，不兼容 major 必须按 Renderer
UI [发布检查表](../../../packages/renderer-ui/docs/release-checklist.md)
与 Host/官方插件原子 cutover。商店检查、远程安装和运行时加载都会拒绝当前 Host 不满足的 range。

## Artifact

典型官方插件 artifact 内容：

```text
plugin.json
SHA512SUMS
resources/skills/<skill-name>/SKILL.md   # 插件自带 Skill 时
dist/backend/index.cjs
dist/renderer/index.js
dist/renderer/assets/*.css
dist/renderer/chunks/*.js
dist/cli/<plugin-cli>.cjs                 # manifest 声明 entry.command 时；只服务人、开发脚本和 CI 的独立 CLI
dist/cli/<runtime-loader>.cjs             # CLI 确有独立 loader 时
```

- 打包脚本固定 zip 内文件时间，减少 artifact 漂移。
- ZIP 外生成 `<pluginId>-<version>.content-bom.json`，逐文件记录 size、SHA-256、内容分类、ZIP envelope hash、source commit 与构建环境。BOM 不写回 ZIP，避免自引用；它与 ZIP 一样是版本不可变的 R2 对象。
- manifest 声明了 `skills` 时，打包脚本强制要求包内存在 `resources/skills`。
- manifest 声明了 `entry.command`
  时，生产文件白名单、zip、SHA512、`extraResources` 和 artifact
  verify 必须共同覆盖该 CLI 目录；开发 smoke 或探针不能混入正式 artifact。该入口是 standalone
  CLI，不是 Agent facade；Agent Shell thin client 与 standalone
  adapter 的完整边界见 [21](./21-plugin-cli.md)。
- 发布校验（verify）会检查 zip 结构、zip 内 manifest 与源码 manifest 完全一致、`package.json`
  版本、`latest.json` 指向当前 zip、SHA512SUMS 覆盖运行入口，以及 `ownedTables`
  / `migrations` 不能单边声明；迁移 DDL 与 backend
  contribution 的运行时一致性由官方 DB 契约测试覆盖。某个官方插件额外需要 worker、runtime
  loader 或随包编译资源时，在 `plugin-release-targets.mjs` 的
  `artifactVerification`
  声明，由通用 verifier 统一检查 zip、checksum 与 extraResources，禁止在 verifier 内按插件 ID 追加路径分支。

## 独立 R2 发布

官方插件经 `scripts/release/plugin-release-targets.mjs`
登记发布目标。每插件一条便捷命令：

```bash
pnpm run release:plugin:<id>:upload
```

流程：构建 schemas → 构建打包插件 → 正式 schema 校验 zip 内 plugin.json
→ 确认 entry/展示资源在 zip 内 → 生成并重算 content BOM → 生成 latest.json → 检查 R2 同版本 immutable
ZIP/BOM（任一内容不同都要求 bump 该插件版本）→ 使用受保护凭据上传 → 公网回读校验 sha512/manifest/entry/BOM。发布一个插件不要求其他插件或桌面应用 bump。

dry-run 与公网 smoke：

```bash
LINNYA_PLUGIN_UPLOAD_DRY_RUN=1 pnpm run release:plugin:<id>:upload
LINNYA_R2_SMOKE=1 pnpm run smoke:plugins:official:r2
```

R2 对象布局：`plugins/<pluginId>/latest.json`、`<pluginId>-<version>.zip`、`<pluginId>-<version>.content-bom.json`，以及 manifest
`screenshots` 声明的展示截图资源。插件图标不走 R2 静态资源；renderer
contribution 用 Vue 组件提供图标。

## 常用命令（`<id>` 换成插件 id）

- `pnpm --dir packages/plugins/<id> run typecheck`
- `pnpm run build:plugin:<id>` / `pnpm run package:plugin:<id>`
- `pnpm run smoke:plugin:<id>:artifact`
- `pnpm run release:plugin:<id>:upload`
- 跨插件：`pnpm run package:plugins:official`、`pnpm run smoke:plugins:official:artifact`、`pnpm run prepare:extra-resources`、`pnpm run guard:plugin-runtime-dist`

`smoke:plugin:<id>:artifact` 不复用仓库
`extraResources/plugins`。命令完成 package 后创建一次性临时 bundled
root，从当前插件生产目录生成唯一插件副本，校验 zip、checksum、manifest、renderer/runtime 资源，再把同一个显式 root 交给真实磁盘 backend
loader。无论成功失败都会整体清理临时 root，因此本机旧 artifact 不参与验收。

## 发版检查清单

1. bump `plugin.json` 与插件 `package.json` 版本（一致性测试见
   [02](./02-manifest.md)）。
2. 更新 `details` 和 `releaseNotes`。
3. 数据变化则新增 plugin migration，版本严格递增。
4. 确认包内 `PluginMeta` 仍从 manifest 派生；新增官方插件进入 release
   composition，并跑 manifest、artifact 与产品信任输入一致性测试；不要在 Core 增加插件 ID
   policy。
5. 含 renderer entry 时确认 peer range、manifest range 和生成的
   `latest.json.rendererUi` 一致，且当前 Host 满足。
6. 构建插件并生成 artifact。
7. 确认外置 content BOM 可重算且不含本机绝对路径；它是内容清单，不替代 NOTICE/许可证归因。
8. dry-run 上传 → 真上传 → 跑 R2 smoke。
9. 确认前端插件详情页能看到新版本与更新说明。

## 新插件发布配置入口

- `scripts/release/plugin-release-targets.mjs` 添加 release
  target（id、包目录、R2 前缀、下载根）。
- 根 `package.json`
  添加同形便捷命令：`build:plugin:<id>`、`package:plugin:<id>`、`smoke:plugin:<id>:artifact`、`release:plugin:<id>:upload`。
- 插件 `package.json` 的 `package:artifact` 调用通用打包脚本。
- 随包 seed 与 `prepare-extra-resources.cjs` 默认读取 release
  target 清单；官方插件进入 release target 后必须能被 seed、artifact
  smoke、extraResources 同时覆盖。
- 默认 `prepare:extra-resources`
  会重建插件随包根，并在结束时断言其目录集合与 official release
  targets 完全一致；非目标插件不能进入最终随包输出。
- 日常 inline/source 开发不隐式扫描仓库
  `extraResources/plugins`；artifact 验收必须通过显式 bundled
  root 或 smoke 自己创建的隔离来源进入 loader，不能依赖本机历史构建目录。
- 公网安装 smoke 走 `smoke:plugins:official:r2`，由 release
  target 清单枚举官方插件并断言每个插件的下载、解包、激活、迁移、owned
  tables 和 active 指针写回。

这些入口由 `scripts/__tests__/plugin-workspace-packaging.test.ts` 和 runtime
seed 场景测试统一守住：新增官方插件不能只加源码包，必须进入同一套 build /
package / smoke / upload /
seed 生命周期；它能否被 packaged 产品执行，仍由受保护 composition 或验签 catalog 证明。

**默认发布面边界**：`plugin-release-targets.mjs` 的公共静态目标只包含随 Linnya
Core 发布的插件；下游组合根可通过插件
`package.json#linnya.release.includeInOfficialRelease`
发现额外目标。`package:plugins:official`、`smoke:plugins:official:artifact`、`prepare-extra-resources.cjs`
默认随包 seed 与 R2 smoke 都从最终目标集合派生。公共 clean
clone 删除下游插件包后，集合必须自然收缩。**进入默认产品面的插件必须进入 release
target**，不要把「单独命令存在」当作已进默认发布面。

本地 seed、远程安装与远程上传遵守同一条不可变版本规则：`pluginId@version`
必须对应唯一内容。预置 seed 或远程安装发现目标版本目录的 `SHA512SUMS`
不一致会直接失败；R2 已存在同版本 zip 且 sha512 不一致也会拒绝上传。内容变化只能提升该插件自己的版本，不要求其他插件或主应用同步 bump。

## 环境变量清单

| 变量                                                                                                           | 用途                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `LINNYA_PLUGIN_ROOT`                                                                                           | 用户插件根目录                                                                                   |
| `LINNYA_PLUGIN_DIRECT_DIRS`                                                                                    | 开发直载插件版本目录                                                                             |
| `LINNYA_PLUGIN_BACKEND_DIRECT_DIRS`                                                                            | 仅 backend 使用的开发直载 package/版本目录；不覆盖 Renderer 源码入口                             |
| `LINNYA_PLUGIN_BACKEND_LOADING`                                                                                | backend 物理布局提示；生产默认 `disk`，`inline` 仅表示源码开发布局，不会让 Core 静态 import 插件 |
| `LINNYA_PLUGIN_RENDERER_BUNDLE`                                                                                | renderer 插件构建模式覆盖（Vite）                                                                |
| `LINNYA_PLUGIN_SEED_BUNDLED`                                                                                   | `0` 禁用随包 seed                                                                                |
| `LINNYA_PLUGIN_IDS`                                                                                            | 预置/发布插件 id 列表                                                                            |
| `LINNYA_BUNDLED_PLUGIN_ROOT`                                                                                   | 显式 bundled 插件根；开发态只有设置此项才会发现 bundled artifact                                 |
| `LINNYA_PLUGIN_<ID>_PACKAGE_DIR` / `LINNYA_PLUGIN_PACKAGE_DIR`                                                 | 插件包目录覆盖                                                                                   |
| `LINNYA_PLUGIN_<ID>_R2_PREFIX` / `LINNYA_PLUGIN_R2_PREFIX`                                                     | R2 前缀                                                                                          |
| `LINNYA_PLUGIN_<ID>_DOWNLOAD_BASE_URL` / `LINNYA_PLUGIN_DOWNLOAD_BASE_URL` / `LINNYA_PLUGIN_DOWNLOAD_ROOT_URL` | 下载地址                                                                                         |
| `LINNYA_PLUGIN_CATALOG_OUTPUT`                                                                                 | catalog 输出路径                                                                                 |
| `LINNYA_PLUGIN_UPLOAD_DRY_RUN`                                                                                 | 上传 dry-run                                                                                     |
| `LINNYA_R2_BUCKET`                                                                                             | R2 bucket（默认 `linny-app-store`，正式发布建议显式设置）                                        |
| `LINNYA_R2_SMOKE`                                                                                              | 启用 R2 公网 smoke                                                                               |

> 本表中的下载地址变量只服务构建、上传和公网 smoke 脚本，不是 Desktop 运行时配置。
> Desktop 只允许 `official` 发行身份访问固定官方插件源，普通环境变量不能改写地址。
