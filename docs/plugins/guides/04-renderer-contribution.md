# 04 · 前端 Contribution 与页面

> 适用场景：实现插件 renderer 入口、页面/surface、工具卡、图标；理解前端加载机制。

## 入口与类型

前端入口应导出 `rendererPlugin`，类型是 `RendererPluginContribution`。

可贡献能力：

- `meta`：插件摘要。
- `activate` / `deactivate`：启用态挂载和卸载 renderer port、watcher、全局监听等运行时副作用。
- `documentTypes`：文档类型 surface、file handler、create action、图标、实体引用、外壳样式和 workspace read 展示声明（详见 [05 文档类型](./05-document-types.md)）。
- `toolCards`：对话工具卡 UI；subrun 只负责展示、不负责执行，详见 [20 Subrun 过程展示](./20-subrun-process-ui.md)。
- `conversationWorkflows`：对话 workflow 菜单/pill 元数据；注册与回滚由 renderer registry 处理。
- `conversationInput`：运行期可热装卸的 Reference kind/provider/accessory；当前不开放 Input Extension 或 `editorExtensions`，详见 [19 对话输入贡献](./19-conversation-input.md)。
- `documentActionMenus` / `documentRuntimeLoaders`：文档 header 动作和 surface 挂载后的运行时加载逻辑。复杂副作用应放在插件自己的 feature/orchestration 内，入口只装配 contribution。

## 运行时加载流程

1. 后端 IPC 返回 enabled 插件 renderer entries；生产/磁盘态 `entryUrl` 是 `plugin://<pluginId>/<entry.renderer>`，开发源码态经同一 IPC 解析包 `package.json` 的 `./renderer`，但 `entryUrl` 是 Vite 的 `/@fs/<绝对路径>`（`toViteFsUrl`），不是 `plugin://`；开发态 CSS 走 contribution 的 `stylesheets` 而非 artifact assets。
2. renderer loader 安装宿主模块表。
3. `plugin://host/...` shim 把 `vue`、`pinia`、`@plugin/renderer/*` 解析到宿主同一份单例；官方插件的 renderer Vite 配置必须复用 `packages/plugins/rendererHostExternalMap.mjs` 把 external 改写为 `plugin://host/...`，不能让 dist 保留 bare specifier。
4. 动态 import `plugin://<pluginId>/<entry.renderer>`，读取并登记 `rendererPlugin` contribution。
5. 注入插件 CSS，调用 contribution 的 `activate()` 挂载 renderer port。
6. 任一步失败时，loader 只回滚本次新登记的 contribution（document type / tool card / workflow）与 CSS；它**不**自动扫 port registry。port 必须由插件在 `activate()` 内用 try/finally/disposer 自清，或在 `deactivate()` 对称注销——不要依赖 loader 保证「无 port 残影」。
7. 下一次同步发现插件不再 enabled 时，调用 `deactivate()`，随后移除该插件 CSS。

## 入口纪律

- **入口模块不要有注册副作用**：port 注册、store 初始化应放在显式 `activate()` 流程，不要在模块顶层 import 时执行（import 副作用导致禁用后无法回收，参见审计 F-02）。
- `activate()` 注册的 page context provider、structured context requirement、toolRefresh handler、document creation handler、document reference runtime handler、全局事件监听、定时器和 watcher，必须在 `deactivate()` 里对称注销。
- `activate()` 必须是事务友好的：一旦抛错，loader 会撤回本次贡献和 CSS；插件内部已注册的 port 也应由自己的 `deactivate()` 或局部 disposer 清理，避免半激活。
- CSS 注入只走 loader：插件入口用 `import styleUrl from './style.css?url'` 收集 URL，并在 contribution 的 `stylesheets` 明确声明顺序；不要顶层 `import './style.css'` 触发 bundle 副作用注入。构建会从同一个 contribution tuple 生成 `dist/renderer/renderer-stylesheets.json`，磁盘/zip loader 只按该清单加载，不扫描目录猜顺序；源码态继续使用 contribution 数组。两种模式最终都通过 loader 插入和移除 `<link data-linnya-plugin-css>`。
- 插件工具卡 CSS 必须随工具卡组件放在插件包内，并通过同一个 `stylesheets` 生命周期注入。Host conversation 全局样式不得 import 具体插件卡片 CSS；禁用/卸载插件后，插件卡片样式也应随 CSS link 一起消失。
- ActionButtons、CharacterCount、CustomCheckbox、CustomRadio、Switch、TagChip、SegmentedTabs、PageSectionHeader、ScrollToBottomButton、CustomTextInput、SecretInput、CustomTextarea、CustomNumberInput、CustomSelect、BaseDropdown、TextPopover、Modal、AlertDialog、ImagePreviewModal、HoverTooltip、NotificationBar 与 `applyTextareaAutoResize` 等基础能力必须直接从 `@linnya/renderer-ui` 包根导入。旧 `@plugin/renderer/toolUi` runtime facade 已删除；工具 presentation 类型使用 type-only `@linnya/plugin-host-contract/renderer/toolUi`，工具 payload 由插件自己的 feature decoder 解释。不要 deep import `apps/renderer/shared/**` 或 package 内部 `src/**`，也不要在插件里复制控件样式。文本输入的原生控件扩展使用 `controlClass`，数字输入使用 `inputClass`；选择菜单与图片预览通过各自 `classNames`、option class 或 `DROPDOWN_SURFACE_CLASSES` 扩展，传入值都必须使用插件自己的命名空间，禁止覆盖 package 内部 selector。插件需要触发 Host 全局通知时继续调用 workspace runtime 的 `showNotification`，不要自行创建第二个全局 store 或 timer。
- 前端插件把复杂业务逻辑放在自己的 domain/functions/orchestration/store 内，Vue 组件保持薄；状态管理遵守仓库 feature/domain 分层规则。
- `Document Surface` 是所有文档类型共用的挂载贡献名，不等于平台 `domains/editor`。后者只实现 Markdown 的 Tiptap/ProseMirror 富文本 runtime；插件 surface 不应 import `UiEditorInstance`、`uiStore.getEditor()` 或 `markdownDocumentEditorRuntimePort`。
- host renderer 不得 import 具体插件 renderer 入口，也不得 deep import 插件内部（store/CSS/icon/组件）。具体插件 contribution 只能由 `plugins:renderer-entries` + runtime loader 动态加载；`apps/renderer/app/plugins/builtin/` 只保留 platform contribution 和宿主 port 装配。

## Renderer UI 版本合同

- `package.json.peerDependencies['@linnya/renderer-ui']` 与 `plugin.json.compat.rendererUi` 必须使用同一
  node-semver range；开发依赖固定为 `workspace:*`，不得把 Renderer UI 放入普通 dependencies 后打进插件。
- Host 提供唯一 Renderer UI runtime。兼容 patch/minor 更新不要求重建既有插件 artifact；插件构建必须把公开入口改写为
  `plugin://host/renderer-ui/*`，且不得携带 package CSS/token 副本。
- 不兼容 major 会在商店远程检查、下载/安装和运行时加载三条链被阻止。升级 range 必须同时迁移实际消费者并重新构建
  artifact，不能只改 manifest 让 admission 变绿。
- 版本级别、cutover 和回滚步骤以 Renderer UI 的
  [发布检查表](../../../packages/renderer-ui/docs/release-checklist.md) 为准。

## 图标

- 平台通用图标直接从 `@linnya/renderer-ui/icons` 导入，不再经过 `@plugin/renderer/toolUi`。Slides/Mindmap 这类插件语义图标必须留在各自插件包内，并由 renderer contribution 暴露给 host registry；不得把插件语义图标混入平台图标入口。
- 插件商店的插件图标同样走 renderer registry：已加载 contribution 时使用插件自己的 Vue 图标；未注册或未加载到 contribution 时，只能用宿主通用 Vue 图标占位。
- 文件树里已注册的插件文档使用 document type contribution 的 Vue 图标；未安装、未注册或 renderer 加载失败的遗留文件由宿主统一降级到不可用文档图标。
- `plugin.json` 不声明 `icon`，artifact/R2/catalog 也不发布静态图标文件。图标是 renderer contribution 能力，不是 manifest 静态资源。
- 商店、workflow 等 host UI 取插件图标应走注册表，不要按 pluginId 硬编码映射；官方插件必须用回归测试守住这个约定。

## 启停在前端的语义

- UI 读插件启停一律走 enabled 状态 store 的快照；列表/菜单类 UI 在状态未加载完成（`hasLoaded` 为 false）时不要展示可创建类型（首屏假阳性窗口见审计 F-03）。
- 启停切换后会同步收缩的注册面：file handler、page context provider、toolRefresh handler、document creation handler、document reference runtime handler、conversation input、CSS。插件 contribution 的静态声明可以保留在 registry 里用于缺失/禁用提示，但运行时副作用必须可卸载。
- 动态加载插件的 contribution 注册是事务性的：`registerRendererPlugin()` 中途失败会回滚已注册 document type/tool card/workflow；conversation input 在 active 生命周期内事务挂卸；`activate()` 失败会由 loader 回滚本次新加载 contribution。平台内置 `platform` contribution 是唯一可启动期预注册的 renderer contribution。

## Shell 与工具阅读展示

- 需要整页画布、隐藏滚动、完整高度链路等外壳差异时，在 `DocumentTypeContribution.shellClass` 声明 class；`AppLayout` 只应用 contribution class，不按 `activeDocumentType` 写 `if/else`。
- Host 的 `documentSurfaceRuntimePort` 只表达 `{type,id}` ready 生命周期，不等待插件私有 runtime。插件若需要额外 ready 条件，应由自己的 file handler 与公开 runtime port 管理，不能把类型特判加回通用 port。
- `read_file(view="document")` 的通用展示方式在 `DocumentTypeContribution.workspaceReadPresentation` 声明。目前平台支持：
  - `blocks`：Markdown/块列表式文档。
  - `outline`：插件 backend read hook 必须输出 `data.uiOutline` 的大纲式文档。
- Host 工具卡只消费这些稳定展示结构，不认识具体插件类型名，也不从 observation 反解析插件私有文本协议。插件若需要新的展示结构，先扩展通用 contribution 契约和守卫，再接入自己的文档类型。
