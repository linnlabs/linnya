# Renderer UI 版本与装配检查表

此清单用于 Renderer UI 版本变更和 Host/插件 cutover。Linnya 开源前后，本包都保持 workspace-only、`private: true`，
不通过私有 GitHub Packages、个人 scope、额外组织或临时脚本远程发布。`Linnya` 是产品名，当前 `@linnya` 是
workspace/runtime 的逻辑 namespace，不是 GitHub 或 npm 身份声明。

首次开源时，本包的源码、文档和构建门禁随 `linnlabs/linnya` 公开，但不改名、不解除 `private: true`、不发布公共 npm。公开边界必须同时遵循
[文档治理规则](../../../docs/documentation-governance.md) 与仓库根构建说明。

## 1. 判断版本级别

- patch：修正实现且不改变公开 props、事件、slot、类型、DOM/CSS 扩展面、token 语义或交互结果。
- minor：向后兼容地新增公开组件、入口、可选 prop、token 或能力；既有插件 range 必须继续满足。
- major：删除或重命名公开能力，收紧必填项，改变事件 payload、slot、交互语义、主题 selector、公开 token
  语义，或使既有 `compat.rendererUi` range 不再满足。
- 内部文件移动和私有函数重构不单独构成版本变化；不能用 fallback 或旧 API 双写把 breaking change 伪装成 minor。

## 2. 同步唯一版本事实

1. 同步 `package.json.version` 与 `src/version.ts` 的 `RENDERER_UI_VERSION`。
2. 在 `CHANGELOG.md` 顶部增加同版本条目，说明对 Host 和插件的实际影响。
3. 若 exports、公开 token/theme/overlay 或 extension surface 改变，同步 package README、使用指南与对应行为测试。
4. 运行 `pnpm run test:renderer-ui-package-gate`，确认真实 tarball 含 README、CHANGELOG、docs 和全部公开入口。

## 3. 插件兼容合同

- 每个含 renderer entry 的插件必须同时声明：
  - `package.json.peerDependencies['@linnya/renderer-ui']`；
  - `plugin.json.compat.rendererUi`；
  - 开发依赖 `@linnya/renderer-ui: workspace:*`。
- peer range 与 manifest range 必须逐字一致；源码只 import 显式 JS 入口，插件不得 import package CSS。
- 组件、图标、本地化、scroll、theme 等 runtime 入口必须继续映射为 `plugin://host/renderer-ui/*`，由 Host 提供
  新单例；只有 runtime catalog 明确标记为 `pluginRuntimeExternal: false` 的纯叶子入口才可进入插件 artifact。
- `/font-stack` 必须保持无 Vue、DOM、CSS、Electron、Node 和 Host 状态依赖，并在 renderer 与 hidden worker artifact
  中被实际 bundle，不能留下 bare import 或错误改成 `plugin://` external。
- patch/minor 版本 cutover 不得要求仅消费 Host external 的兼容插件重建；改变已 bundle 纯叶子实现时，必须重建并验证受影响 artifact。
- major 版本 cutover 必须在同一受控变更中更新 Host、全部启用中官方插件 range 与 artifact；商店检查、远程安装和运行时
  加载三条链都必须对旧 range fail-fast。

## 4. 必跑验证

```bash
pnpm run test:renderer-ui-package-gate
pnpm run build:frontend
pnpm run guard:plugin:official
pnpm run smoke:plugins:official:artifact
```

改动某个插件公开消费面时，再运行该插件 `typecheck`、`build` 与 `smoke:plugin:<id>:artifact`。正式上传官方插件 artifact 或产品装配前运行
启用联网的 R2 smoke，确认 `latest.json.rendererUi`、artifact manifest、catalog 和 checksum 一致。

## 5. 版本切换、装配与回滚

- Host、官方插件、manifest、artifact 与 workspace package 的版本 cutover 不解除 `private: true`，不产生远程 package。
- 源码公开前必须通过开源提案的公开边界、secret/历史、许可证、第三方材料、clean-room、治理与公共仓 gate。
- tarball 必须包含预期 DTS/CSS/README/docs 并通过独立 consumer 与无私有依赖检查；它只是 CI/官方装配验证产物，不上传公共 registry 或 GitHub Release。
- 只影响 Host external 入口的 compatible patch/minor：先切换 Host package/产品装配，再验证既有插件 artifact 无需重建即可加载；若改变已 bundle 纯叶子实现，必须重建受影响 artifact。
- breaking major：Host 与官方插件从同一 cutover commit 构建；不得先装配会让现有插件 range 失配的一侧。
- 回滚必须回到同一组 Host version、plugin range 与 artifact，不单独回滚其中一层。
- 本提案不允许解除 `private: true`；未来若要发布 registry package，必须由新 proposal 重新评审并更新此清单。
