# 18 · 插件商店展示契约

> 适用场景：插件在商店列表、详情页、安装/卸载后市场页展示不完整；修改 `plugin.json` 的用户展示字段；发布或预置 artifact 后核对商店页面。

## 一句话原则

插件商店只展示 **manifest 和运行态**，不读 README，不读 skill 正文，也不从代码注释里拼介绍。`plugin.json` 是用户展示信息的唯一真源；运行时详情页优先读取当前 active/bundled artifact 目录里的 `plugin.json`，不是源码目录那份。

## 页面结构

### 列表页

列表页用于快速识别和管理插件，字段必须来自 `PluginStoreListItem.meta`：

| UI 区域 | 字段 | 真源 |
|---|---|---|
| 图标 | renderer contribution / document type icon | 插件 renderer contribution |
| 名称 | `meta.name` | `plugin.json.name` → package `pluginMeta.ts` → backend registry |
| 状态 | `state` | SQLite 插件启停/安装态 |
| 短介绍 | `meta.description` | `plugin.json.description` |
| 版本 | `meta.version` | `plugin.json.version` |
| 开发者 | `meta.developer` | `plugin.json.developer` |
| 操作 | 启停 / 安装 | 插件 state + required / missing 规则 |

列表页不要展示 `details`、`skills`、`agents`、`releaseNotes` 和 `sizeBytes`。这些字段来自详情 IPC；`sizeBytes` 需要扫插件目录，不能为了列表刷新去做目录体积计算。

### 详情页

详情页用于完整说明插件能力，字段来自 `PluginStoreDetail`：

| UI 区域 | 字段 | 真源 |
|---|---|---|
| Hero | `meta.name`、`meta.description`、`state`、图标 | backend registry/catalog meta + renderer contribution |
| 介绍 | `details[]` | artifact/bundled `plugin.json.details` |
| Skills | `skills[]` | artifact/bundled `plugin.json.skills` |
| Agents | `agents[]` | artifact/bundled `plugin.json.agents` |
| 信息与管理 | `meta.version`、`meta.developer`、`sizeBytes`、`homepage` | meta + artifact/bundled manifest + 插件目录体积 |
| 版本更新 | `releaseNotes[]` | artifact/bundled `plugin.json.releaseNotes` |

`details` 是 manifest 必填字段。`skills` 和 `agents` 是可选字段，但只要插件真实贡献了用户可感知的 skill 或 agent，就必须声明对应展示项；没有真实能力时不要写空壳展示项。

## 数据链路

商店列表：

```text
packages/plugins/<id>/plugin.json
  -> packages/plugins/<id>/src/shared/pluginMeta.ts
  -> BackendPluginContribution.meta
  -> BackendPluginRegistry
  -> listRegisteredBackendPluginMetas() + listStates()
  -> PluginStateView / PluginStoreListItem
  -> PluginStoreView list card
```

这条链路不会扫描 `packages/plugins/*` 全量。插件必须由已加载 contribution 提供 manifest 派生 meta；是否进入官方随包候选由公共 release target 或下游插件 owner 的发行元数据决定，packaged 执行资格还必须由受保护 composition 证明。未来不随包的官方插件由验签 catalog 提供列表 meta，不能靠 Host import 私有源码。完整信任边界见
[`生产插件分发与信任策略`](../production-distribution-and-trust.md)。

商店详情：

```text
active artifact 或 bundled artifact 的 plugin.json
  -> buildPluginStoreDetail()
  -> PluginStoreDetail
  -> PluginStoreView detail page
```

这个差异很重要：源码 `packages/plugins/<id>/plugin.json` 改了以后，如果没有重新打 artifact / 刷 `extraResources/plugins/<id>` / 更新 active artifact，详情页仍可能读取旧 manifest，表现为介绍、skills、agents 或 release notes 消失。

商店详情有一个硬不变式：**列表可见的官方插件，详情页不能退化成只有版本和开发者**。读取顺序必须是：

1. `enabled` / `disabled` 且 active artifact 可读：读 active manifest。
2. `enabled` / `disabled` 但 active artifact 暂不可用：回退 bundled manifest。
3. `missing`：读 bundled manifest，保证用户卸载后仍能查看介绍和重新安装。
4. active 与 bundled 都不可读：静默退回 base meta（详情字段为空）。注意 `buildPluginStoreDetail` 只在**读取目录/manifest 出错**时才经 `reportDiagnostic` 上报，「目录不存在」属正常退回，不发 diagnostic。

这条不变式是平台行为，不是单个插件的 UI 特判；renderer 不得按 `pluginId` 补文案。

## 修改清单

改插件展示信息时必须同时检查：

1. `packages/plugins/<id>/plugin.json`
2. `packages/plugins/<id>/package.json` 的版本是否与 `plugin.json.version` 一致
3. `packages/plugins/<id>/src/shared/pluginMeta.ts` 是否仍从 manifest 派生，而不是手写第二份 meta
4. 插件若声明 `skills`，包内必须存在 `resources/skills`
5. 需要本地预置时，重新执行 `pnpm run package:plugin:<id>` 和 `pnpm run prepare:extra-resources --plugin=<id>`，让 `extraResources/plugins/<id>/plugin.json` 同步
6. 需要远程发布时，重新生成 zip / latest / 校验 artifact，不能只改源码 manifest

## 验收

最小验收：

```bash
./node_modules/.bin/vitest run src/electron-main/plugins/store/__tests__/pluginStoreDetail.test.ts
./node_modules/.bin/vitest run src/app-hosts/linnya/plugin-registry/__tests__/builtin-plugin-manifest.test.ts
```

`pluginStoreDetail.test.ts` 必须覆盖三种来源：active manifest、missing bundled manifest、enabled/disabled 但 active artifact 暂缺时的 bundled fallback。这个测试保护的是商店数据链路，不是为某个展示字段写快照。

发布或预置验收：

```bash
pnpm run smoke:plugin:<id>:artifact
```

该命令会在一次性 bundled root 中完成 package、展示资源校验和真实 backend entry 加载；不要把仓库
`extraResources/plugins` 当作发布 smoke 输入。需要本地查看商店 bundled fallback 时，才单独执行上面的
`prepare:extra-resources --plugin=<id>` 刷新开发预览目录。

如果源码 manifest 有字段但 UI 没显示，先查当前运行时实际读取的是哪个 artifact：

- `LINNYA_PLUGIN_ROOT` 下 `<id>/active.json` 指向的版本目录
- `LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT` 或 `LINNYA_BUNDLED_PLUGIN_ROOT`
- 正式打包态的随包候选 `extraResources/plugins/<id>`；inline/source 开发态不会隐式扫描该目录

## 禁止事项

- 不要从 README 读取商店介绍。README 是开发者文档。
- 不要在 renderer 里按插件 ID 写展示文案分支。
- 不要在 Host 或 catalog 投影层手写 `details`、`skills`、`agents` 第二份副本。
- 不要让列表页为了显示大小扫描插件目录。
- 不要只更新源码 `plugin.json` 却不更新 artifact/extraResources，然后用旧运行态判断商店展示是否正确。
