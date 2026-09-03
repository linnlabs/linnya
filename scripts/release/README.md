# Release Scripts

本目录集中管理 Linnya 主应用发布脚本，以及官方 runtime 插件的 artifact、上传、catalog 与公网 smoke 脚本。

这里的核心原则是：**发布目标集中登记，生命周期同形执行，脚本只编排发布流程，不反向改业务代码。**

## 边界

- Linnya 主应用发布：管理
  `package.json#version`、`release-notes.md`、关于页 release 数据和安装包上传检查。
- 官方插件发布：管理公开官方 runtime 插件，以及当前私有 monorepo 中由 package 自主加入内部发行的额外插件；覆盖打包、artifact 校验、R2 上传、随包 seed、公网安装 smoke 和 catalog。
- 插件运行时生命周期、manifest 字段、商店展示规范，详见
  [`docs/plugins`](../../docs/plugins/README.md)。

主应用版本和插件版本是两条独立发布线。主应用 bump 不自动 bump 插件；插件发布也不自动修改主应用版本。

每个插件之间也互相独立：发布一个插件不要求其他插件 bump。源码是否公开只影响 canonical
repo 和源码可见性；开放与闭源官方插件都通过受保护流程发布到 Cloudflare
R2。“Linnya
Cloud 发布插件”是这条 R2 分发能力的产品统称，不是另一个常驻发布服务。

通用 package、verify、smoke 和上传客户端可以留在源码仓；真正的权限边界是 Git 之外的正式 R2 写入凭据、签名材料和发布审批。公开脚本本身不是安全问题，任何长期生产凭据进入仓库才是阻断项。

## 目录地图

```text
scripts/release/
  README.md                              # 本目录导航与开发规范
  definitions/                           # 主应用发布数据契约
  functions/                             # 主应用发布纯函数
  orchestration/                         # 主应用发布编排入口
  plugin-release-targets.mjs             # 公共静态目标 + workspace package 自声明发现
  plugin-release-targets.d.mts           # 发布目标清单的 TS 消费契约
  package-plugin-artifact.mjs            # 插件 artifact 打包
  create-poppler-runtime-release-archives.cjs # 生成并校验固定 Poppler runtime release 资产
  verify-plugin-artifact.mjs             # 本地 artifact / 显式 bundled root 校验
  smoke-plugin-artifact.mjs              # 隔离 bundled root 的本地 artifact smoke 编排
  functions/pluginBundledRootContract.mjs # bundled root 与目标插件集合的一致性合同
  orchestration/verifyPluginArtifactRuntime.ts # 从隔离 root 加载真实 backend entry
  upload-plugin-artifact.mjs             # 插件 R2 上传与公网回读校验
  generate-plugin-catalog.mjs            # 官方插件 catalog 草稿生成
  smoke-official-plugins-r2.test.ts      # 官方插件公网安装/迁移 smoke
  definitions/dependencyLegalPolicy.ts  # 跨 pnpm/npm 图共用的精确许可证与来源策略
  definitions/packageLegalEvidence.ts   # 安装 package 法律 evidence 公共合同
  definitions/reviewedPackageLegalEvidence.ts # 精确版本的上游/registry 复核映射
  evidence/reviewed-upstream-licenses/  # 经 hash 锁定的上游法律文本或精确片段
  functions/packageLegalEvidence.ts     # manifest/source/LICENSE/NOTICE 共用证据内核
  definitions/sourceDependencyBom.ts    # Source BOM 专属补充数据 NOTICE
  functions/sourceDependencyBom.ts      # pnpm Source 图到确定性 BOM/NOTICE 的适配
  orchestration/generateSourceDependencyBom.ts # 当前平台 Source dependency BOM 编排
  definitions/artifactContentBom.ts     # Desktop / plugin 内容 BOM 的稳定数据合同
  functions/artifactContentBom.ts       # 路径分类、tree hash 与确定性汇总
  definitions/artifactPackageMap.ts     # Desktop 真实 npm package occurrence 合同
  functions/artifactPackageMap.ts       # package identity、lock 与 ASAR 位置的确定性映射
  definitions/artifactPackageLegalEvidence.ts # Desktop npm component 法律 evidence 合同
  functions/artifactPackageLegalEvidence.ts # package map 与冻结 npm 安装树的归因
  definitions/artifactBundleComponentMap.ts # Desktop bundle 输出与 npm component 合同
  functions/artifactBundleComponentMap.ts # build trace 到真实 artifact occurrence 的确定性映射
  ../build/bundle-trace/                 # Vite/esbuild/tsup/派生输出的外置构建 trace
  ../build/functions/productionPackageManifest.mjs # Desktop 最小生产 manifest 投影
  ../build/functions/productionPackageLock.mjs # npm v3 生产 lock 合同
  ../build/orchestration/updateProductionPackageLock.mjs # 生产 lock 更新/复核编排
  orchestration/generatePluginArtifactContentBom.ts # 从正式插件 ZIP 生成/复核内容 BOM
  orchestration/generateDesktopArtifactContentBom.ts # 从签名应用、app.asar 与安装文件生成/复核内容 BOM
  orchestration/generateDesktopArtifactPackageMap.ts # 从内容 BOM 与 production lock 生成 package map
  orchestration/generateDesktopArtifactBundleComponentMap.ts # 从 trace set 与内容 BOM 生成 bundle component map
  orchestration/generateDesktopArtifactPackageLegalEvidence.ts # 生成成品 npm component 法律 evidence/NOTICE
```

## 脚本职责

| 文件                                                           | 职责                                                                                                                           | 主要入口                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `orchestration/bumpRelease.ts`                                 | bump 主应用版本                                                                                                                | `pnpm run release:bump <version>`                                                                             |
| `orchestration/generateCurrentRelease.ts`                      | 从 `release-notes.md` 生成前端 release 数据                                                                                    | `pnpm run release:generate`                                                                                   |
| `orchestration/verifyRelease.ts`                               | 校验主应用 release 数据一致性                                                                                                  | `pnpm run release:verify`                                                                                     |
| `orchestration/generateAiSdkThirdPartyNotice.ts`               | 兼容旧命令名，委托完整 Source dependency BOM 生成根发行 NOTICE，禁止再用 AI SDK 子集覆盖完整清单                              | `pnpm run generate:ai-sdk-third-party-notice`                                                                 |
| `orchestration/verifyAiSdkThirdPartyNotice.ts`                 | 校验 AI SDK 版本、许可证、models.dev 署名、NOTICE 与安装包资源声明                                                             | `pnpm run guard:ai-sdk-third-party-notice`                                                                    |
| `orchestration/verifyDependencyLicenseEvidence.ts`             | 校验根应用 Unknown license 的精确版本、integrity、随包许可证 hash 和公开阻断项                                                 | `pnpm run guard:dependency-license-evidence`                                                                  |
| `orchestration/generateSourceDependencyBom.ts`                 | 从安装后的生产依赖图生成无本机路径的版本、integrity、source、license 与 evidence hash 清单                                     | `pnpm run release:bom:source-dependencies`                                                                    |
| `../build/orchestration/updateProductionPackageLock.mjs`       | 从最小 Desktop manifest 生成或复核独立 npm v3 lock，隔离用户 npm 配置与私有 registry，并可运行 frozen install smoke            | `release:lock:production:update` / `release:lock:production:verify` / `release:lock:production:install-smoke` |
| `orchestration/generateDesktopArtifactContentBom.ts`           | 展开签名应用目录与 `app.asar`，关联最终安装器/更新包 hash 和生产 lock hash，生成无本机路径的逐文件内容 BOM                     | 正式 Desktop build 自动执行；也可用 `release:bom:desktop` 复核                                                |
| `orchestration/generateDesktopArtifactPackageMap.ts`           | 从真实 `app.asar` manifest 按 package identity 对齐 production lock，并覆盖 `asar.unpacked` 物理 occurrence                    | 正式 Desktop build 在 content BOM 后自动执行；也可用 `release:map:desktop-packages` 复核                      |
| `orchestration/generateDesktopArtifactBundleComponentMap.ts`   | 把 Vite/esbuild/tsup/Bytenode trace set 按逻辑路径与 hash 连接到最终 artifact occurrence，并汇总实际 bundle npm identity       | 正式 Desktop build 在 package map 后自动执行；也可用 `release:evidence:desktop-bundle-map` 复核              |
| `orchestration/generateDesktopArtifactPackageLegalEvidence.ts` | 只为 package map 中真实出现的第三方 npm component 收集 source、integrity、许可证结论与随包法律文本；first-party workspace 单列 | 正式 Desktop build 在 package map 后自动执行；也可用 `release:evidence:desktop-package-licenses` 复核         |
| `orchestration/printUploadChecklist.ts`                        | 打印 Cloudflare 上传检查清单                                                                                                   | `pnpm run release:checklist`                                                                                  |
| `definitions/releaseManifest.ts`                               | 主应用 release 数据结构                                                                                                        | 被 orchestration 引用                                                                                         |
| `functions/*`                                                  | 主应用发布纯函数：artifact 名称、notes 解析、版本读取、状态校验                                                                | 被 orchestration 引用                                                                                         |
| `plugin-release-targets.mjs`                                   | 组合公共静态目标与 workspace package 自声明目标：id、包目录、R2 前缀、下载地址                                                 | 被插件打包、上传、catalog、smoke、seed 间接消费                                                               |
| `plugin-release-targets.d.mts`                                 | `.mjs` 清单的 TypeScript 契约                                                                                                  | 被 TS 测试/守卫消费                                                                                           |
| `package-plugin-artifact.mjs`                                  | 打 zip、写 `SHA512SUMS`、生成本地 `latest.json` 与外置逐文件内容 BOM                                                           | `pnpm run package:plugin:<id>`                                                                                |
| `verify-plugin-artifact.mjs`                                   | 校验 zip、manifest、entry、skills、renderer assets、显式 bundled root、browser bundle 风险                                     | 被隔离 artifact smoke 调用                                                                                    |
| `smoke-plugin-artifact.mjs`                                    | 创建一次性 bundled root，准备目标插件，串联静态 verifier 与真实磁盘 backend loader，最后整体清理                               | `pnpm run smoke:plugin:<id>:artifact`                                                                         |
| `functions/pluginBundledRootContract.mjs`                      | 校验 bundled root 目录、manifest id 与预期 release target 集合完全一致                                                         | 正式随包准备与隔离 artifact smoke                                                                             |
| `orchestration/verifyPluginArtifactRuntime.ts`                 | 用显式 bundled root 加载本次 artifact 的真实 backend contribution                                                              | 被隔离 artifact smoke 调用                                                                                    |
| `upload-plugin-artifact.mjs`                                   | schema 校验、immutable zip 检查、上传 R2、从公网回读校验                                                                       | `pnpm run release:plugin:<id>:upload`                                                                         |
| `generate-plugin-catalog.mjs`                                  | 从官方插件 artifact 生成 catalog 草稿                                                                                          | `pnpm run release:plugin:catalog:generate`                                                                    |
| `packages/schemas/src/plugins/catalog.ts`                      | catalog 公共结构与解析合同                                                                                                     | 发布生成器与后续 Host catalog runtime 共用                                                                    |
| `smoke-official-plugins-r2.test.ts`                            | 从公网下载所有官方插件，安装、激活、执行 migration、校验 owned tables                                                          | `LINNYA_R2_SMOKE=1 pnpm run smoke:plugins:official:r2`                                                        |
| `create-poppler-runtime-release-archives.cjs`                  | 从已通过 catalog 校验的运行时生成确定性 ZIP，并复核大小与 SHA-256                                                              | `pnpm run release:poppler-runtime:prepare`                                                                    |

## 主应用发布

主应用发布只认这些真源：

- `package.json#version`
- `pnpm-lock.yaml`（锁源码 workspace 安装，不重复存储主应用版本）
- `production-package-lock.json`（只锁 Desktop 扁平生产依赖；公开 clean
  root 必须重新生成）
- `release-notes.md`
- `apps/renderer/domains/settings/definitions/currentRelease.generated.ts`

常用流程：

```bash
pnpm run release:bump 0.0.39
pnpm run release:generate
pnpm run release:lock:production:verify
pnpm run release:verify
pnpm run release:checklist
```

根生产依赖或 Electron 版本发生变化时，先运行
`pnpm run release:lock:production:update` 并审阅 lock
diff。正式构建不会重新解析依赖，而是把经过合同校验的 lock 投影为
`dist_build/package-lock.json`，再执行
`npm ci --omit=dev`。公开候选不能复用私有组合根的 lock：clean-root 编排会在公共 workspace 删除私有 owner 后重新生成，并把其 SHA-256 写入演练证据；Desktop 内容 BOM 也记录本次生产 lock 的 SHA-256。

生产依赖、移植源码和随产品分发的第三方目录数据都是发布合同的一部分。升级
依赖、修改 supplemental notice 或更新 bundled catalog 来源后，必须重新运行
`pnpm run generate:ai-sdk-third-party-notice` 并提交根目录
`THIRD_PARTY_NOTICES.txt`。这个兼容命令使用完整 Source dependency BOM 生成链，不能只输出 AI SDK 子集。`release:verify` 与 `build:electron:prepare`
都会执行同一份检查：AI SDK 依赖必须使用精确 semver、安装版本必须一致，外部目录数据和移植源码署名必须进入 NOTICE，并作为安装包
`Resources/THIRD_PARTY_NOTICES.txt`
发布。门禁不从网络猜测 license，也不接受手工维护的漂移版本表。

依赖聚合器报告 `Unknown` 时，使用 `pnpm run guard:dependency-license-evidence`
校验开源准备期精确基线；它允许已登记的公开阻断项继续存在，但拒绝新增 Unknown、版本/integrity 漂移和许可证文件 hash 漂移。生成公开 clean-root 候选时改用
`pnpm run guard:dependency-license-evidence:public`，任何阻断项都会失败。evidence 只处理依赖 manifest 漏标，不登记 Linnya 自有 workspace 的根许可证问题，也不能替代 installer/plugin
artifact 的完整 NOTICE 与 SBOM。

`pnpm run release:bom:source-dependencies` 不依赖网络查询许可证，也不会把
`node_modules` 绝对路径写进产物。它读取当前平台真实安装的 production
graph，输出到 `dist_release/bom/`：JSON 保存 package/version/registry
integrity/source/license/evidence
hash，文本文件汇总 package 与随包 LICENSE/NOTICE。缺少独立许可证文件但 manifest 声明明确的 package 会被透明标记为
`manifest-only`，而不是伪造文件；Unknown、未登记的复合许可证或缺少来源/integrity 会直接失败。该结果是 Source/当前平台依赖 BOM 输入，不能冒充最终 Desktop
installer 或开放插件 artifact 的实际内容清单。

发布 tarball 未携带正文时，可以登记人工复核 evidence，但不能只复制一段通用许可证模板。Git 证据必须锁完整 commit、上游路径、源文件 hash 和本地副本 hash；registry
README 证据必须锁 package
identity、integrity、源文件 hash 与精确行范围。生成器离线复核这些字段，并把 manifest 声明与人工结论的差异、理由和证据来源写入输出。当前 Desktop 的 55 个初始 manifest-only
package 已按此规则关闭 49 个，剩余 6 个继续作为 limitation，不能用 allowlist 伪装完成。

正式 Desktop build 会在代码签名、更新 ZIP 和 DMG 全部完成后生成
`dist_build/dist_electron/linnya-desktop-<version>.<platform>-<arch>.content-bom.json`。它逐项记录签名应用目录、合法符号链接、`app.asar`
逻辑文件、预置插件、原生/runtime 文件和最终 DMG/ZIP/blockmap/update
metadata 的 SHA-256/SHA-512，并记录 source
commit、dirty 状态与构建环境。BOM 必须位于签名产物旁，不能写回 `.app`
或安装器形成自引用并破坏签名。

内容 BOM 证明“最终字节里有什么”，不自动完成“这些字节按什么许可证分发”。Source
dependency BOM、vendored/runtime
catalog 与 NOTICE 仍需按实际文件关联到内容 BOM；未完成该关联前，不得把
`content-bom.json` 对外描述成完整法律 SBOM 或 provenance attestation。

内容 BOM 后会生成同名前缀的
`.package-map.json`。它不假定 electron-builder 保留 npm 的物理安装位置，而是从最终
`app.asar` 读取 canonical `package.json`，按 `name@version` 对齐 production
lock，再记录 ASAR 与 `asar.unpacked`
occurrence。打包器重排目录不构成漂移；成品出现 lock 外 package
identity 才会失败。随后生成同名前缀的 `.package-legal-evidence.json` 与
`.package-third-party-notices.txt`：它们从冻结 npm 安装树连接真实 package
component，并区分 Linnya first-party
workspace 与第三方分发义务。

正式代码构建同时在外置 `dist_release/bundle-traces/<platform>-<arch>` 生成每个
Vite/esbuild/tsup/Bytenode target 的输入/输出证据；trace set 会拒绝缺失或重复的 Core
和正式插件 target。成品完成后，`.bundle-component-map.json` 用路径 + SHA-256 连接
`app.asar`、`app.asar.unpacked`、插件资源和经过 electron-builder 重定位的唯一输出。
当前 macOS 实测为 21 个 target、195 个 trace 输出、203 个成品 occurrence 和 352 个
实际 bundle npm identity，未分发 trace 输出为 0。esbuild/Vite chunk、tsup、静态 asset
与 Bytenode 分别保留不同归因强度，不把 build graph 冒充精确最终字节贡献；trace
不进入签名应用或插件 ZIP，也不得包含本机绝对路径。

缺少随包法律文本且没有通过上述复核的 package 会明确保留 `manifest-only`
limitation；bundle identity 虽已闭合，其法律 evidence、9 个 bundler 外复制/生成代码文件和非 npm
runtime 仍未闭合。因此这组文件仍是法律 SBOM 的中间证据，不得改名或宣传为完整 SBOM。

Poppler 是 Desktop 的外部 runtime，不跟随普通源码提交。`config/poppler-runtime.json`
锁定两个平台 release 资产；`pnpm run release:poppler-runtime:prepare`
只会从已经通过完整文件树校验的本地 runtime 生成字节确定的压缩包，并拒绝与 catalog 大小/hash 不一致的输出。首次公开前把两个输出上传到
[Linnya 公开仓](https://github.com/linnlabs/linnya)的 `poppler-runtime-v1` GitHub
Release；后续升级必须使用新 release tag 并同步更新 catalog、NOTICE/source
offer 和 installer BOM。

Cloudflare 上传检查：

- macOS 自动更新必须包含 `latest-mac.yml`、`*-mac.zip`、`*.zip.blockmap`。
- Windows 自动更新必须包含 `latest.yml`、`Linnya-*-win.exe`、`*.exe.blockmap`。
- DMG 只用于用户手动下载安装，不参与 macOS 自动更新。
- 每个平台还必须上传对应的
  `linnya-desktop-<version>.<platform>-<arch>.content-bom.json`。

## 官方插件发布生命周期

官方插件必须进入同一条生命周期，不允许某个插件拥有私有发布路径。

```text
公共 release targets + workspace package 自声明
  -> build:plugin:<id>
  -> package:plugin:<id>
  -> smoke:plugin:<id>:artifact
  -> release:plugin:<id>:upload
  -> prepare:extra-resources / 随包 seed
  -> smoke:plugins:official:r2
  -> store detail / catalog
```

典型命令：

```bash
pnpm run build:plugin:<id>
pnpm run package:plugin:<id>
pnpm run smoke:plugin:<id>:artifact
LINNYA_PLUGIN_UPLOAD_DRY_RUN=1 pnpm run release:plugin:<id>:upload
pnpm run release:plugin:<id>:upload
LINNYA_R2_SMOKE=1 pnpm run smoke:plugins:official:r2
```

跨插件命令：

```bash
pnpm run package:plugins:official
pnpm run smoke:plugins:official:artifact
pnpm run release:plugin:catalog:generate
pnpm run prepare:extra-resources
pnpm run guard:plugin-runtime-dist
```

磁盘插件 backend 从用户插件目录独立加载，不依赖仓库或主应用的
`node_modules`。除 Node 内置模块、`@app/schemas` 和 `@plugin/backend/*`
宿主门面外，backend 使用的第三方包必须由插件构建配置内联；artifact
smoke 会阻断残留的第三方裸依赖。每次 smoke 都使用只含本次目标插件的一次性 bundled
root，并从该 root 真实加载 backend entry；仓库共享 `extraResources/plugins`
不参与单插件验收。暂时停用、未进入官方批量发布枚举的插件，也必须保留并单独执行自己的
`smoke:plugin:<id>:artifact`。

官方插件 artifact 典型结构：

```text
plugin.json
SHA512SUMS
resources/skills/<skill-name>/SKILL.md
dist/backend/index.cjs
dist/renderer/index.js
dist/renderer/assets/*.css
dist/renderer/chunks/*.js
```

ZIP 旁还会生成
`<pluginId>-<version>.content-bom.json`。它不放入 ZIP，避免 BOM 对自身所在 ZIP 产生循环 hash；打包、verifier、上传和公网回读会共同要求它与当前 ZIP 完全一致。

R2 对象布局：

```text
plugins/<pluginId>/latest.json
plugins/<pluginId>/<pluginId>-<version>.zip
plugins/<pluginId>/<pluginId>-<version>.content-bom.json
plugins/<pluginId>/<manifest.screenshots 路径>
```

插件图标不走 R2 静态资源；renderer
contribution 用组件提供图标。商店详情展示字段以 `plugin.json` 为真源，规范见
[`docs/plugins/guides/18-store-presentation.md`](../../docs/plugins/guides/18-store-presentation.md)。

## 新增官方插件时必须改哪里

公开官方插件：

1. 在 `scripts/release/plugin-release-targets.mjs` 添加公共 release target。
2. 同步确认 `plugin-release-targets.d.mts`
   的类型仍覆盖新增字段；新增字段时必须先改类型。
3. 在根 `package.json` 添加同形脚本：
   - `build:plugin:<id>`
   - `package:plugin:<id>`
   - `smoke:plugin:<id>:artifact`
   - `release:plugin:<id>:upload`
4. 插件包内 `package.json` 的 `package:artifact` 必须调用
   `scripts/release/package-plugin-artifact.mjs <id>`。
5. 确认 `prepare:extra-resources`、seed、artifact smoke、R2 smoke 都由 release
   target 清单覆盖。
6. 更新
   [`docs/plugins/guides/15-release.md`](../../docs/plugins/guides/15-release.md)
   或对应插件文档，说明插件发布状态。

不在首期开源范围内、但需要参与当前内部安装包的 workspace 插件，不进入 Core 静态清单，也不在根
`package.json` 增加插件专属脚本；由插件自己的
`package.json#linnya.release.includeInOfficialRelease`
声明加入，并在插件 README 维护单包 build/package/smoke/upload 入口。

这些入口由 `scripts/__tests__/plugin-workspace-packaging.test.ts` 和 runtime
seed 场景测试守住。新增官方插件不能只加 known
meta、源码包或商店字段，必须完整进入 build / package / smoke / upload /
seed 生命周期。

## 开发规范

- **单一真源**：公共官方插件的发行元数据登记在
  `plugin-release-targets.mjs`；私有 workspace 额外插件的参与意图登记在自身
  `package.json#linnya.release`。组合结果只能通过 release target
  helper 消费，其他脚本不得复制清单。
- **同形优先**：新增官方插件时优先扩展 release target 清单和通用脚本，不新增
  `<plugin>-only` 发布脚本。插件专属 worker、loader 或编译资源通过 target 的
  `artifactVerification` 声明，通用 verifier 不按插件 ID 硬编码路径。
- **TS 消费要有契约**：TS 测试或代码引用 `.mjs` 发布脚本时，必须补同名
  `.d.mts`，禁止让 TS 消费隐式 `any`。
- **打包可复现**：zip 内文件时间固定，文件列表排序稳定；发布内容只来自
  `plugin-release-targets.mjs` 登记的生产 `dist` 目录、manifest 展示资源和
  `resources`。本地
  `dist/dev`、旧 artifact 或其他临时文件即使存在，也不得进入 zip、`SHA512SUMS`
  或 `extraResources`。
- **bundled root 可证明**：默认 `prepare:extra-resources`
  结束时，物理插件目录必须与 official release
  targets 完全一致；单插件 smoke 的临时 root 必须只含当前目标插件。目录名、manifest
  id 或集合不一致立即失败。
- **版本内容不可变**：同一 `pluginId@version` 只能对应一个
  `SHA512SUMS`、ZIP 与外置 content
  BOM。本地 seed 或远程安装发现同版本内容冲突必须终止，R2 同版本 ZIP/BOM 任一内容不同都必须拒绝覆盖；这些冲突只能通过 bump 版本解决。
- **上传不可覆盖旧版本**：R2 同版本 zip 如果已存在且 sha512 不同，必须 bump 插件版本，不能覆盖。
- **校验靠 schema 与 artifact 内容**：上传前后都要校验 zip 内
  `plugin.json`、entry、展示资源和 sha512，不靠人工确认。
- **Renderer 样式顺序属于 artifact 合同**：每个 renderer build 必须输出
  `dist/renderer/renderer-stylesheets.json`。其顺序直接来自源码 contribution 的
  `stylesheets` tuple；disk/zip
  loader 只读取这份清单，禁止重新扫描目录猜顺序。artifact
  verifier 会对账清单、实际 CSS 集合、zip 与 checksum。
- **脚本失败要早且明确**：缺 manifest 字段、缺 entry、缺 skills 目录、缺 renderer
  assets、缺 latest 指向时直接失败，不做静默 fallback。
- **脚本不改业务代码**：release 脚本只能读取插件包、生成发布产物、更新发布生成文件；业务迁移、agent、skill、renderer
  contribution 必须在插件源码内完成。
- **文档同步**：发布入口、环境变量、生命周期或 artifact 结构变化时，同时更新本 README 和
  `docs/plugins/guides/*`。

## 验证清单

修改本目录脚本后，按影响面选择验证：

```bash
git diff --check
pnpm exec vitest run scripts/__tests__/plugin-workspace-packaging.test.ts
pnpm exec vitest run scripts/__tests__/prepare-extra-resources.test.ts
pnpm exec vitest run scripts/release/functions/pluginBundledRootContract.test.ts
pnpm exec vitest run src/electron-main/plugins/loader/__tests__/pluginRuntimeScenarios.test.ts
pnpm run test:artifact-content-bom
pnpm run smoke:plugins:official:artifact
pnpm run smoke:plugins:official:r2
```

说明：`smoke:plugins:official:r2`
默认跳过外网测试；需要真实访问公网 artifact 时显式设置 `LINNYA_R2_SMOKE=1`。

单插件本地 artifact 验证：

```bash
pnpm run smoke:plugin:mindmap:artifact
pnpm run smoke:plugin:sheet:artifact
pnpm run smoke:plugin:slides:artifact
```

私有 workspace 插件的单包验证命令由对应插件 README 维护，公共 Core 文档不登记其包路径。

公共 Core 只静态登记公开官方插件。当前私有 monorepo 中需要随内部产品发行的额外插件，由插件自己的
`package.json#linnya.release.includeInOfficialRelease`
选择加入；批量 package、预置资源和 R2
smoke 都消费同一份发现结果。删除私有 package 后，公共 clean
clone 的默认发行集合会自然收缩，不需要在 Core 中维护私有插件 ID、路径或专用脚本。

## 环境变量

| 变量                                                                                                           | 用途                                                                             |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `LINNYA_R2_BUCKET`                                                                                             | R2 bucket，默认 `linny-app-store`；正式发布建议显式设置                          |
| `LINNYA_R2_SMOKE`                                                                                              | `1` 时启用公网 R2 smoke                                                          |
| `LINNYA_PLUGIN_IDS`                                                                                            | catalog、预置资源或批量脚本要处理的插件 id，逗号分隔                             |
| `LINNYA_PLUGIN_ROOT`                                                                                           | 用户插件根目录                                                                   |
| `LINNYA_PLUGIN_DIRECT_DIRS`                                                                                    | 开发直载插件版本目录                                                             |
| `LINNYA_PLUGIN_BACKEND_DIRECT_DIRS`                                                                            | 仅 backend 使用的开发直载 package/版本目录                                       |
| `LINNYA_PLUGIN_BACKEND_LOADING`                                                                                | backend 物理布局提示；生产默认 `disk`，`inline` 不代表把具体插件打进 Core bundle |
| `LINNYA_PLUGIN_RENDERER_BUNDLE`                                                                                | renderer 插件构建模式覆盖                                                        |
| `LINNYA_PLUGIN_SEED_BUNDLED`                                                                                   | `0` 时禁用随包 seed                                                              |
| `LINNYA_BUNDLED_PLUGIN_ROOT`                                                                                   | 显式 bundled 插件根                                                              |
| `LINNYA_PLUGIN_<ID>_PACKAGE_DIR` / `LINNYA_PLUGIN_PACKAGE_DIR`                                                 | 插件包目录覆盖                                                                   |
| `LINNYA_PLUGIN_<ID>_R2_PREFIX` / `LINNYA_PLUGIN_R2_PREFIX`                                                     | R2 对象前缀覆盖                                                                  |
| `LINNYA_PLUGIN_<ID>_DOWNLOAD_BASE_URL` / `LINNYA_PLUGIN_DOWNLOAD_BASE_URL` / `LINNYA_PLUGIN_DOWNLOAD_ROOT_URL` | 下载地址覆盖                                                                     |
| `LINNYA_PLUGIN_<ID>_LATEST_URL`                                                                                | 单插件 latest.json 覆盖                                                          |
| `LINNYA_PLUGIN_CATALOG_OUTPUT`                                                                                 | catalog 输出路径                                                                 |
| `LINNYA_PLUGIN_UPLOAD_DRY_RUN`                                                                                 | `1` 时只打印 Wrangler 命令，不上传                                               |

废弃别名 `LINNYA_MINDMAP_PLUGIN_LATEST_URL`、`LINNYA_SLIDES_PLUGIN_LATEST_URL`
不再读取；新脚本一律使用 `LINNYA_PLUGIN_<ID>_LATEST_URL`。
