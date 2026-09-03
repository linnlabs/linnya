# linnkit Release Runbook

本文只回答一个问题：**现在怎么发布 Linnkit
core**。不要在这里写版本流水账、事故复盘、长篇 release notes 或历史清单。

## 1. 文档职责

| 文件                                         | 职责                                                                                            | 不放什么                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------- |
| [`CHANGELOG.md`](../../CHANGELOG.md)         | 对外版本变化。按版本写 Added / Changed / Fixed / Compatibility。GitHub Release 从这里抽取正文。 | 发布过程、踩坑叙事、内部操作日志。 |
| [`RELEASE-HISTORY.md`](./RELEASE-HISTORY.md) | 发版历史、踩坑、历史决策、事故复盘。                                                            | 当前发布步骤的重复副本。           |
| 本文                                         | 发布流程手册。只保留边界、步骤、检查项和失败处理。                                              | 版本说明、历史版本表、长叙事。     |

更新原则：每次发版只改 `CHANGELOG.md`
的对应版本段；只有发布流程本身变化时才改本文。

## 2. 发布边界

Linnkit core 有三个位置，职责不同：

| 位置                                                                          | 职责                                                                                                             | 发版时怎么处理                                                           |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Linnya monorepo `packages/linnkit`                                            | Linnkit Agent 核心的唯一开发真源，跟随宿主应用一起 review、提交和推送；Linnya 开源后真源迁到 `linnlabs/linnya`。 | 不从宿主应用 workflow 直接发布 npm；发布候选必须从锁定 commit 单向导出。 |
| GitHub 公开仓 [`linnlabs/linnkit`](https://github.com/linnlabs/linnkit)       | 单向生成的发行投影，承接既有 release tag、GitHub Release、独立 package CI 和 npm Trusted Publishing。            | `v*` 发布 core；不在此独立开发或直接合并功能 PR。                        |
| npm 包 [`@linnlabs/linnkit`](https://www.npmjs.com/package/@linnlabs/linnkit) | 外部消费者安装的正式包。                                                                                         | 由公开仓 GitHub Actions 通过 npm Trusted Publishing 发布。               |

也就是说：Linnkit 在 Linnya monorepo 开发，从可追溯的 source
commit 单向生成独立发行投影，再发布到 GitHub 和 npmjs。两个仓库不能同时接受功能开发；独立仓的任何外部改动都必须先进入 monorepo，再重新导出。Provider
adapter 不属于 Linnkit core 的独立 npm 发布流程。

Linnkit 与 Host、其他 package 和插件共置在同一开发工作区，是为了原子修改与联调效率，不表示它们共享版本号、公开状态或发布 workflow。

## 3. 发版前检查

在公开仓根目录执行：

```bash
npm install --no-audit --no-fund
npm run typecheck
npm run build:clean
npm run build
npm run test
npm run test:smoke
npm run test:smoke:dist
npm run publish:dry-run
```

然后检查：

```bash
git status --short
npm view @linnlabs/linnkit version dist-tags.latest versions --json --registry=https://registry.npmjs.org/
```

必须满足：

- 准备发布的 package version 与它自己的 tag 一致。
- `CHANGELOG.md` 有对应版本段。
- `CHANGELOG.md` 中所有看起来像正式版本的段落，要么已经有对应 npm version + Git
  tag，要么在标题中明确标注为 `unpublished milestone` / `pre-npmjs milestone`
  并说明折入或被哪个已发布版本覆盖。
- `git status --short` 为空。
- npm 上还没有同版本；如果已经有同版本，只能按“已发布版本”处理，不能覆盖。

## 4. 常规发布步骤

1. 在 Linnya
   monorepo 完成开发、测试、review、提交和推送，并记录准备发布的 source commit。
2. 在 Linnya 源码仓执行
   `scripts/release/export-linnkit-oss.sh <empty-target> <linnya-root> <full-source-commit> linnlabs/linnya`。导出结果必须包含
   `LINNKIT_SOURCE_PROVENANCE.json`；不得复制
   `dist`、`node_modules`，也不得覆盖独立仓的 `.git`、`.github` 和
   `.gitignore`。
3. 把快照应用到独立仓后，执行
   `manageLinnkitProjection.ts verify`。除独立仓自己的 `.github` 和 `.gitignore`
   外，`package.json`、`CHANGELOG.md`、README、公开集成文档、测试与源码全部由 monorepo 投影，禁止在独立仓手工补改；需要修改时回到 Linnya
   monorepo。校验器会忽略任意深度的 `node_modules`、`dist` 和 `coverage`
   本地产物，因此已安装/构建的干净 checkout 也能重复校验；普通未跟踪源码和文档仍会被判定为漂移。
4. 跑完第 3 节的本地检查，并确认独立仓 workflow 的所有第三方 Actions 已固定到完整 commit
   SHA。
5. 提交并推送独立发布仓 `main`。提交信息引用 provenance 中的 source
   commit、package version 和 projection SHA-256，不另造一份可漂移的来源数据。
6. 为 core 打 tag 并推送：

```bash
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

7. 观察 core 的 `Release` workflow。
8. 发布成功后验证 npm：

```bash
npm view @linnlabs/linnkit@X.Y.Z version --registry=https://registry.npmjs.org/
npm view @linnlabs/linnkit version dist-tags.latest --registry=https://registry.npmjs.org/
```

## 5. Trusted Publishing 前置条件

公开仓 `.github/workflows/release.yml` 使用 npm Trusted Publishing / GitHub
OIDC，不使用长期 npm token。

npm package settings 必须为 core 配置 Trusted Publisher：

| 字段                | 值                  |
| ------------------- | ------------------- |
| Publisher type      | GitHub Actions      |
| Organization / User | `linnlabs`          |
| Repository          | `linnkit`           |
| Workflow filename   | `release.yml`       |
| Package             | `@linnlabs/linnkit` |

注意：

- `npm whoami` 不能验证 OIDC 发布权限，因为 OIDC token 只在 `npm publish`
  时由 npm 颁发。
- 不要把 `NPM_TOKEN` / `LINNLABS_NPM_TOKEN` 加回常规 release
  workflow。token 路线只会重新制造长期凭据维护问题。
- workflow 当前固定 Node 24，并安装 npm 11.x，满足 npm Trusted
  Publishing 对新版 Node/npm 的要求。

## 6. 失败处理

| 现象                                                                          | 通常原因                                                                                    | 处理                                                                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm publish` 报 `E404` / `you do not have permission` / `could not be found` | npm Trusted Publisher 未配置，或 org/repo/workflow 文件名不匹配。                           | 去 npm package settings 修 Trusted Publisher。不要改成 token 发布。                                             |
| workflow 报 tag version mismatch                                              | `vX.Y.Z` 与 `package.json#version` 不一致。                                                 | 修正版本或删除错误 tag 后重打。                                                                                 |
| `npm publish` 报版本已存在                                                    | npm 不允许覆盖已发布版本。                                                                  | 如果 npm 上的同版本就是这次产物，可视为幂等完成；否则 bump 新版本。                                             |
| tarball 缺 CLI bin                                                            | `package.json#files` 没包含 `bin`，或 `bin/linnkit.cjs` 不存在。                            | 修 manifest / bin wrapper，重新 dry-run。                                                                       |
| `pnpm install` 后只有 `bin/linnkit.cjs` 出现权限差异                          | Git 没有把 npm CLI 入口记录为可执行文件，pnpm 建立 workspace bin 链接时修正了真实入口权限。 | 将 `bin/linnkit.cjs` 以 `100755` 提交；不要在安装后用脚本反复还原权限。                                         |
| 外部 import 报 `Missing tiktoken_bg.wasm` 或类似资源缺失                      | 第三方依赖被 tsup inline，资源没进包。                                                      | 确认依赖同时在 `package.json#dependencies` / `peerDependencies` 和 `tsup.config.ts#external`，并跑 dist smoke。 |
| GitHub Release 正文不对                                                       | `CHANGELOG.md` 对应版本段缺失或格式不对。                                                   | 修 `CHANGELOG.md`，重新跑 workflow 或手动更新 GitHub Release。                                                  |

## 7. 应急本地发布

只在 GitHub Actions / npm OIDC 故障且确实必须发包时使用。常规发版不要走这条路。

前置条件：

- maintainer 本地已登录 npm，且有 `@linnlabs/linnkit` publish 权限。
- 本地 `main` 与公开仓 `origin/main` 对齐。
- 第 3 节检查全部通过。

执行：

```bash
npm publish --access public --provenance
```

本地发布完成后仍要：

- 推送公开仓 `main` 和 `vX.Y.Z` tag。
- 确认 GitHub Release 从 `CHANGELOG.md` 补齐。
- 在 [`RELEASE-HISTORY.md`](./RELEASE-HISTORY.md) 记录为什么绕过常规 workflow。

## 8. 维护约束

- `package.json#files` 必须继续排除
  `src`、`docs/framework`、`docs/release`、`docs/99-research-notes` 和开发手册。
- `bin/linnkit.cjs` 是带 shebang 的 npm
  CLI 入口，Git 中必须保持可执行权限（`100755`），避免 workspace 安装修改受版本控制的源文件。
- `package.shell.test.ts`、`package.runtime-import.test.ts`、`package.events-browser-safe.test.ts`
  是发布包边界的守门测试，不能因为“只是文档/打包麻烦”跳过。
- Linnkit core 禁止依赖 Provider adapter 或任何 `@ai-sdk/*`
  package；Host 只通过公开 ports/contracts 接入自己的实现。
- 所有功能变更只在 Linnya monorepo 合并；`linnlabs/linnkit`
  不接受独立功能提交，也不得反向覆盖 `packages/linnkit`。
- 独立仓必须能追溯到唯一 source commit；`LINNKIT_SOURCE_PROVENANCE.json`
  与 projection
  verify 是硬门禁。如果版本或内容漂移，先回到 Linnya 修正并重新导出，禁止在两边分别修补。
- 公开 API 和版本兼容性写进 `CHANGELOG.md`；内部原因和长叙事写进
  `RELEASE-HISTORY.md`；本文只在流程变化时更新。
