# Linnya Localization 地基说明

> 日期：2026-06-21  
> 状态：已开始落地  
> 范围：Linnya 本体优先，插件后续接入。

## 1. 当前落地点

统一语言真源落在：

```text
apps/renderer/app/localization/
```

它只负责跨模块稳定基础能力：

- locale 类型与支持语言列表。
- 当前语言持久化。
- message catalog 注册和注销。
- `LocalizedText` 解析。
- fallback 与参数插值。
- `<html lang>` 同步。
- Vue 使用入口 `useLocalization()`。

已经接入的模块：

```text
apps/renderer/domains/settings/definitions/settingsMessageCatalog.ts
apps/renderer/domains/settings/orchestration/ensureSettingsLocalizationRegistered.ts
apps/renderer/app/layout/definitions/layoutMessageCatalog.ts
apps/renderer/app/layout/orchestration/ensureLayoutLocalizationRegistered.ts
apps/renderer/app/update/definitions/updateMessageCatalog.ts
apps/renderer/app/update/orchestration/ensureUpdateLocalizationRegistered.ts
apps/renderer/app/system/definitions/systemMessageCatalog.ts
apps/renderer/app/system/orchestration/ensureSystemLocalizationRegistered.ts
apps/renderer/domains/plugin-store/definitions/pluginStoreMessageCatalog.ts
apps/renderer/domains/plugin-store/orchestration/ensurePluginStoreLocalizationRegistered.ts
apps/renderer/domains/workspace/definitions/workspaceMessageCatalog.ts
apps/renderer/domains/workspace/orchestration/ensureWorkspaceLocalizationRegistered.ts
apps/renderer/domains/knowledgebase/definitions/knowledgeBaseMessageCatalog.ts
apps/renderer/domains/knowledgebase/orchestration/ensureKnowledgeBaseLocalizationRegistered.ts
apps/renderer/domains/conversation/definitions/conversationMessageCatalog.ts
apps/renderer/domains/conversation/orchestration/ensureConversationLocalizationRegistered.ts
apps/renderer/domains/editor/definitions/editorMessageCatalog.ts
apps/renderer/domains/editor/orchestration/ensureEditorLocalizationRegistered.ts
packages/renderer-ui/src/localization/definitions/sharedComponentMessageCatalog.ts
apps/renderer/app/localization/orchestration/provideSharedComponentLocalization.ts
apps/renderer/domains/sheet/definitions/sheetMessageCatalog.ts
apps/renderer/domains/sheet/orchestration/ensureSheetLocalizationRegistered.ts
apps/renderer/app/plugins/definitions/pluginContributionMessageCatalog.ts
apps/renderer/app/plugins/orchestration/ensurePluginContributionLocalizationRegistered.ts
```

Settings、app layout、app update、app system、Plugin Store、Workspace、KnowledgeBase、Conversation、Editor、Sheet 自建 UI、app plugin contribution 和 shared 基础控件分别维护自己的文案，app localization 只负责统一注册和解析。

## 2. 目录边界

`apps/renderer/app/localization` 是 app-level localization domain，不是全局文案仓库。

后续模块接入时应优先按模块放 catalog：

- Settings 文案放 `domains/settings`。
- app shell / layout 外壳文案放 `app/layout`。
- 更新弹窗这类 app-level 能力文案放 `app/update`，不要放进 shared。
- 系统 IPC 能力的窄错误文案放 `app/system`，例如 media 文件/对话框失败、导出保存/目录选择/PDF 生成失败；业务操作提示仍放调用它的 domain catalog。
- 插件商店本体 UI 文案放 `domains/plugin-store`。
- Workspace 文案放 `domains/workspace`。
- KnowledgeBase 文案放 `domains/knowledgebase`。
- shared 基础控件默认文案由 `@linnya/renderer-ui/localization` 拥有，只允许放真正跨业务控件自身的默认标题、placeholder、tooltip、aria-label；Host adapter 负责接入当前 app locale。
- Conversation 文案放 `domains/conversation`。
- Editor 文案放 `domains/editor`。Editor 内部的 Review、Annotation、AudioBlock、TableBlock、Citation 等子 feature 后续可继续用 Editor catalog，但应按 feature 分批接入。
- Sheet 自建 UI 文案放 `domains/sheet`。
- app 内置插件 contribution 文案放 `app/plugins`，例如内置文档类型和内置 workflow。展示层通过 contribution presentation 函数解析，不把翻译结果写回 registry。
- 插件文案后续放插件包内部，通过 host SDK 注册。

禁止把所有业务文案都堆进 `app/localization` 或全局 `shared/locales`。

## 3. 第一阶段能力

当前已支持：

- `zh-CN`
- `en-US`
- 设置页语言切换。
- 当前语言持久化到 renderer persisted storage。
- 切换语言后同步 `<html lang>`。
- Settings 模块主要文案实时响应切换。
- App Header、左侧栏导航、项目态顶部导航、侧栏预览状态和全局保存快捷键通知实时响应切换；这些入口的失败主提示不展示底层动态错误详情。
- 文档区域缺少或禁用文档类型插件时的占位提示实时响应切换。
- 更新弹窗壳层、按钮、状态标题和默认错误实时响应切换。
- System media IPC 的图片/音频/文件信息失败通过 `system.media.*` catalog key 收束；Editor 图片插入对话框标题和过滤器名由 Editor catalog 注入主进程系统对话框。
- System export IPC 的保存文件、选择目录、PDF 生成和批量写入失败通过 `system.export.*` catalog key 收束；Workspace 导出服务向主进程注入系统保存对话框标题、按钮和过滤器名，并继续用 Workspace catalog 展示操作级失败提示。
- System shell/quota IPC 的外部链接打开、文件管理器定位和配额读写失败通过 `system.shell.*` / `system.quota.*` catalog key 收束；业务层是否展示这些系统失败仍由调用方 domain 决定。
- System transcription HTTP 的模型缺失、服务不可用、上传音频缺失和未知转录失败通过 `system.transcription.*` catalog key 收束；Editor AudioBlock 只解析结构化 `userMessage`，不展示后端诊断 `error` 作为主文案。
- 插件商店本体页面壳层、tab、详情页固定分区标题、状态标签、按钮、toast、confirm 和本地默认错误实时响应切换。
- 插件运行态固定错误：`app/plugins` 只抛稳定 `PluginRuntimeErrorCode`，`domains/plugin-store` 展示层通过 `pluginRuntimeErrorPresentation` 解析当前语言；后端/远程源返回的动态错误详情仍原样展示。
- 内置 platform 文档类型 `label/createLabel/defaultName` 与内置 conversation workflow `menuText/pillText/ariaLabel` 支持 `LocalizedText` contribution；侧栏新建入口、文件树右键菜单、创建默认名、文档不可用占位、Conversation workflow 菜单和 pill 实时响应切换。
- Workspace 侧栏项目/文件树、项目弹窗、菜单、confirm/toast 外层文案实时响应切换。
- Workspace ToDo、导出设置/批量导出、项目概览、项目知识库关联面板实时响应切换。
- KnowledgeBase 页面、弹窗、上传/管理/设置、解析设置、添加模型页和图谱进度提示实时响应切换。
- Conversation 对话壳层、输入区、历史列表、基础消息控件、项目对话空态、数学公式复制按钮、引用 popover、引用节点点击定位提示、工具调用外层错误/Raw 兜底渲染和 common/workspace/knowledge base 工具标题实时响应切换。
- Editor 第一批壳层、常用命令入口、SlashMenu、Find/Replace、Outline、块操作菜单、块转换通知、块历史入口、调试面板、文档设置、文档加载失败通知、保存快捷键通知、AI 写作输入框与流式错误、FloatingToolbar、CodeBlock、ImageBlock、LaTeX Block、Review 主工作流、Annotation 面板第一批、AudioBlock 第一批、TableBlock 第一批、Citation 第一批和 Revision 第一批实时响应切换。
- shared 基础控件默认文案、日期选择器默认 placeholder / 月份 / 星期 / 年份格式实时响应切换。

Settings 当前已接入范围：

- 设置弹窗标题。
- 设置页左侧 tab 标题。
- 外观页的主题、语言、字体区块。
- 模型配置页的模型选择、空状态、加载状态、删除确认和本地错误提示。
- 添加模型页的 API / Ollama 表单、按钮状态、本地校验错误和 Ollama 本地刷新提示。
- 模型详情弹窗的字段、协议选择、能力标签、保存/删除操作和本地校验错误。
- 关于页的当前版本标题、发布说明展示、联系说明与联系信息标签。
- Settings 内部通用密码输入的默认 placeholder。
- 语言选择器已从禁用改为可切换。

App layout / Workspace 当前已接入范围：

- 更新弹窗壳层、按钮、状态标题和本地默认错误文案。
- AppHeader 左侧全局按钮、workspace pane 工具按钮、窗口控制 title、文档/Sheet 更多菜单、时间轴和右侧栏 tooltip。
- 对话/文档面板拖拽调整宽度的辅助 title。
- 全局保存快捷键的无打开文件、保存中和意外错误通知。
- 左侧栏固定入口：新对话、新项目、知识库、插件。
- 项目态顶部：返回、对话/文件切换、新对话、新建、搜索占位。
- 项目列表分区、空态、项目菜单、打开/更多 tooltip。
- 项目文件分区、AI 项目初始化空态、文件搜索空态、文件加载状态。
- 项目初始化页：完成/跳过/生成中按钮，以及本地错误 banner。
- 文件树新建菜单、更多菜单、节点右键菜单和新建文件徽标。
- 项目创建/编辑弹窗表单、按钮状态和本地校验。
- 项目/文件删除确认、拖拽移动错误、添加到知识库 toast、资源预览状态；侧栏与项目操作失败只展示操作级文案，不把底层 `Error.message` 拼进主提示。
- ToDo 创建卡、任务项、分组标题、优先级和日期标签。
- 导出设置弹窗、TXT/Markdown/PDF/Word 设置页、批量导出弹窗、导出 service 的用户可见 alert/PDF 标题和批量导出错误。
- Markdown 导出 serializer 的参考文献、图片占位和音频占位标签由 Workspace catalog 注入；serializer 默认中文仅作为非 UI 调用方兼容兜底。
- App-level 对话另存导出端口：无活动项目、编辑器不可用和自动保存失败错误使用 Layout catalog 解析；端口仍只负责 app-level 编排，不依赖 Conversation 内部实现。
- 项目知识库关联面板的标题、列表空态、关联/解除按钮、保存状态和通知。
- 项目概览弹窗的标题、项目名 fallback、加载状态、统计项和本地错误。
- 文档区域缺少或禁用文档类型插件时的占位标题与说明；内置文档类型名通过 `app/plugins` contribution catalog 解析，第三方插件暂使用 contribution fallback。
- Markdown / Sheet 文档生命周期中的打开失败、保存成功、保存失败和保存异常通知；打开/保存失败主提示只展示操作级文案，底层动态错误详情只进入日志。
- 项目侧栏创建的“项目规划”会话标题按当前语言生成一次并写入会话；这是用户可见持久数据，不随之后语言切换重写历史标题。
- Markdown 文档生命周期中的默认未命名文档名由 Workspace catalog 解析，不由 file-manager handler 硬编码。

KnowledgeBase 当前已接入范围：

- 知识库列表页：标题、副标题、计数、卡片空描述、默认标记、创建入口、空态。
- 知识库详情页：返回按钮、tab、文档数量、最近更新日期、默认标记。
- 全局上传弹窗和添加到知识库弹窗：标题、选择器、提示、按钮。
- 创建知识库弹窗：表单标签、placeholder、项目选择、按钮状态、本地校验和本地失败提示。
- 文件上传页：拖拽区、支持文件类型、表头、空态、操作按钮、PDF 视觉增强提示、重复文件 toast。
- 上传任务状态：store 中已有本地状态文案通过 UI resolver 映射；上传队列本地错误（缺少当前知识库配置、未选择嵌入模型、上传失败 fallback）通过 KnowledgeBase catalog 解析。后端传来的动态任务消息仍原样展示。
- KnowledgeBase service 的 API 基础 URL、IPC fallback、上传网络/服务器/请求设置错误外壳通过 KnowledgeBase catalog 解析；后端 `detail/error` 等动态错误详情仍原样展示。
- 文件管理页：表头、空态、清空确认、删除确认、错误弹窗、日期格式跟随当前语言。
- 知识库设置页：基础信息、标签、项目关联、危险操作、删除确认、保存/删除 toast。
- 解析设置页：模型选择、模型分组、自定义模型列表、解析开关说明、confirm/alert 和设置 toast。
- 添加模型页：API/Ollama 表单、协议与能力选项、按钮状态、本地校验、Ollama 刷新错误。
- 知识图谱进度图标：aria-label、tooltip、popover 状态与进度文案。
- 添加当前文档到知识库：目标缺失、编辑器不可用、文档为空和未命名文档 fallback 由 KnowledgeBase catalog 解析；Header 与 Workspace 侧栏调用方注入 resolver，服务层不直接依赖 Vue。
- KnowledgeBase 管理类 IPC 错误：创建、删除、更新设置、获取列表、获取文档列表和读取图谱进度的高频失败通过 `UserFacingMessage` 返回；renderer 只解析 `knowledgeBase.*` catalog key，不展示后端自然语言诊断作为主文案。

Shared 基础控件当前已接入范围：

- `AlertDialog` 默认标题、确认/取消按钮。
- `Modal` 默认标题与关闭按钮辅助提示。
- `CustomSelect` 默认 placeholder 和触发器 title，继续使用 `ChevronIcon.vue` 的箭头图标。
- `TextPopover` 默认触发器 tooltip 和关闭按钮辅助提示。
- `SegmentedTabs` 默认 aria-label。
- `CharacterCount` 默认字数标签。
- `ScrollToBottomButton` 默认 title / aria-label。
- `DraggablePanel` 默认标题与关闭按钮辅助提示。
- `NumberSpinButtons` 默认 step up / step down aria-label。
- `SimpleDatePicker` 默认 placeholder、月份、星期和年份格式。
- `TimePicker` 默认 placeholder、取消/确认按钮。
- `ColorPickerPanel` 默认背景/文字标题和清除按钮；颜色 tooltip 由 option fallback 或业务 `labelResolver` 解析。Editor 与 Sheet 都显式注入各自标题、清除文案和 message resolver，不把业务文案键并入 shared catalog。

业务语义明确的组件不进入 Renderer UI 基础控件 catalog。`AiGeneratingIndicator` 经生产者审计确认没有可达展示入口，
组件、store 和专属 Conversation message key 已一并删除；FloatingToolbar 已归入 Editor `floating-toolbar` feature，
文案继续归 Editor catalog。

暂未接入范围：

- `currentRelease.generated.ts` 仍由单语言 `release-notes.md` 生成；当前 About 页不直接渲染其中的中文标题/正文，而是通过 Settings catalog 展示当前版本的多语言文案。后续发布流程应升级为多语言 release notes 源，避免每次发布后手工同步 catalog。
- Sheet 引擎 / Univer 原始 locale 包和 `react-ref` 参考实现，本体阶段只迁移当前 Vue 自建 UI、右键菜单、工具栏和浏览器确认框。
- 后端直接返回的错误消息和低层服务动态异常详情，统一通过 `UserFacingMessage` / 错误码契约逐步接入，而不是散落在 UI catalog。当前 `@app/schemas` 已提供 `UserFacingMessage` 与兼容旧 `error: string` 的 `OperationResult`，Workspace 项目创建/更新/删除、文件夹/文档创建、节点重命名/删除/复制/移动的高频业务失败已经按“后端业务错误类 → IPC userMessage key → Workspace resolver”闭环；KnowledgeBase 创建/删除/更新设置、列表、文档列表和图谱进度读取的 IPC 高频失败也已接入同一契约；system/media 的图片、音频和文件信息 IPC 失败通过 `system.media.*` key 收束，system/export 的保存文件、PDF 生成和批量写入失败通过 `system.export.*` key 收束，system/shell 的外链打开和文件管理器定位失败通过 `system.shell.*` key 收束，system/quota 的配额读写失败通过 `system.quota.*` key 收束，system/transcription 的 AudioBlock 转录失败通过 `system.transcription.*` key 收束，`error` 只作为诊断字段保留。
- Editor Review 的 prompt、后端内置审阅角色提示词、控制台日志和旧 mock 调试内容不属于用户可见 UI，本轮不迁移。Review store 只保存系统角色 ID 与结构化进度状态，展示名和进度文案由 Review presentation 函数在 UI 层解析。
- AI 自动补全设置中的滑杆展示标签归 Editor 文案管理；`aiSettings` store 和 AutoComplete 配置只保留数值策略和用于 prompt 的 `completionLengthPromptHint`，不承担 UI 翻译职责。
- `apps/renderer/domains/knowledgebase/ui/KnowledgeBaseModal.vue` 是已从全局布局注释掉的旧入口，仍引用不存在的 `ModelConfigTab.vue`，后续应删除或重新归位后再纳入迁移。
- 插件 manifest 文案、插件商店中的插件名称/描述/详情/release notes，后续在插件阶段通过 host SDK / manifest projection 的 `LocalizedText` 注册。Settings contribution 标题已经支持可选 `titleMessageKey`，插件阶段应优先注册插件自己的 catalog 并通过该字段接入，而不是让 Settings 兼容每个插件。
- 官方插件的 document type / conversation workflow contribution 仍待接入插件包内部 catalog；本体已支持 `labelText/createLabelText/defaultNameText` 和 `menuLocalizedText/pillLocalizedText/ariaLocalizedText`，旧 string 字段继续作为兼容 fallback。

## 4. Workspace 迁移约定

Workspace 文案入口：

```text
apps/renderer/domains/workspace/definitions/workspaceMessageCatalog.ts
apps/renderer/domains/workspace/definitions/workspaceMessages.ts
apps/renderer/domains/workspace/functions/resolveWorkspaceMessage.ts
apps/renderer/domains/workspace/functions/resolveCurrentWorkspaceMessage.ts
apps/renderer/domains/workspace/ui/useWorkspaceLocalization.ts
```

Workspace UI 使用 `useWorkspaceLocalization()`，需要日期格式跟随语言时从同一个 hook 读取 `currentLocale`。

非 Vue 组件的用户交互逻辑有两种接入方式：

- 可由 UI 调用方控制的流程，通过参数注入 `WorkspaceMessageResolver`，例如批量导出 service。
- 无自然调用方注入点、但会直接触发用户可见 alert/title 的运行逻辑，使用 `resolveCurrentWorkspaceMessage()`，例如导出 service。

Store 不承担翻译职责。用户可见的持久标题在创建时按当前语言生成一次；展示层动态标题、tooltip、toast 等运行态文案应继续通过 resolver 解析。

Workspace 侧栏、项目操作、文件生命周期、资源预览、项目列表加载状态、app-level 保存快捷键和批量导出的失败提示只展示操作级本地化文案，文件名、项目名、数量等用户数据可以进入文案，底层 `Error.message` / IPC `error` 只保留在日志或结构化状态中。如果需要向用户展示具体失败原因，应先收敛为稳定错误码或 `UserFacingMessage`，不要在 UI 中重新拼接动态技术详情。

错误契约边界：

- `error` 保留为诊断字符串和旧调用兼容，不作为 UI 主文案真源。
- `userMessage.key` 必须属于对应业务 domain catalog，例如 Workspace 只能解析 `workspace.*`。
- `userMessage.params` 只允许字符串和数字，避免把后端对象结构泄漏到 UI。
- 后端用业务错误类表达真实规则，再在 IPC 边界映射成 `UserFacingMessage`；不要在 renderer 解析自然语言错误。
- Workspace 业务错误定义放在 `src/features/workspace/definitions/workspaceErrors.ts`，IPC 映射放在 `src/electron-main/ipc/handlers/workspace/workspace-operation-failure.ts`。服务层只表达业务规则，IPC 只做边界翻译，renderer 只解析 Workspace catalog。
- 插件 SDK 的 renderer `OperationResult` 已兼容 `userMessage` 字段，方便插件后续纳入统一错误契约；插件自己的 catalog 与错误码接入仍属于插件阶段，不在 Linnya 本体当前批次内硬兼容。

按子模块组织 key：

- `workspace.sidebar.*`
- `workspace.project.*`
- `workspace.fileManager.*`
- `workspace.projectOverview.*`
- `workspace.todo.*`
- `workspace.export.*`
- `workspace.projectKb.*`

## 5. Sheet 迁移约定

Sheet 文案入口：

```text
apps/renderer/domains/sheet/definitions/sheetMessageCatalog.ts
apps/renderer/domains/sheet/definitions/sheetMessages.ts
apps/renderer/domains/sheet/functions/resolveSheetMessage.ts
apps/renderer/domains/sheet/functions/resolveCurrentSheetMessage.ts
apps/renderer/domains/sheet/ui/useSheetLocalization.ts
```

Sheet 自建 Vue UI 使用 `useSheetLocalization()`；非组件运行逻辑如果会触发浏览器确认框、tab 菜单或操作级提示，使用 Sheet resolver 或由调用方注入 resolver。

菜单和工具栏 schema 只保存业务结构、命令、状态字段和 `SheetMessageKey`，不保存英文/中文展示 `label`。展示层必须通过 `sheetMenuPresentation.ts` 解析当前语言后再生成 `label`、行内输入前后缀和 selector 选项文案。字号数字这类语言无关值可以作为 selector option 的 `label` 保留；任何用户语义文案必须使用 `labelKey`。

当前已接入范围：

- FormulaBar、Sheet Tabs、缩放按钮、浏览器确认框。
- Sheet tab 右键菜单、网格/行列头右键菜单、行列尺寸弹窗。
- Sheet toolbar 的格式刷、字号、文字样式、颜色、边框、对齐、换行和合并菜单。
- Sheet workbook 默认名、首个工作表默认名和 tab 重命名校验错误。
- Sheet 引擎 locale 由当前 Linnya locale 派生：`SheetCanvas` 会把当前语言传给 `engineHolder`，`engineHolder` 映射为 Univer `LocaleType` 并加载 sheets / sheets-formula 的中英文 locale pack；语言切换时会带当前 workbook snapshot 重建 runtime，避免 Vue 自建 UI 和引擎内置文案分裂。

暂未接入范围：

- `domains/sheet/engine` 和 `domains/sheet/react-ref` 中的 Univer 原始 locale / 参考实现本身不迁移到 Linnya catalog；本体阶段只维护当前 Vue 自建 UI、adapter 边界和 engine locale 映射。
- Sheet 持久化、sync、engine holder 中只进入 console 或结构化错误的诊断文本。用户可见打开/保存失败由 Workspace file-manager catalog 展示操作级文案。

## 6. Settings 迁移约定

Settings 文案入口：

```text
apps/renderer/domains/settings/definitions/settingsMessageCatalog.ts
apps/renderer/domains/settings/definitions/settingsMessages.ts
apps/renderer/domains/settings/functions/resolveSettingsMessage.ts
apps/renderer/domains/settings/ui/useSettingsLocalization.ts
```

Settings UI 使用 `useSettingsLocalization()`，不要直接在组件里重复写 `message(key, fallback)`。

Settings contribution 标题解析支持两类来源：

- Linnya 本体核心 tab 继续由 Settings 自己维护 `settings.tabs.*` key。
- 跨 domain 或插件注册的 tab 应在 contribution 上声明 `titleMessageKey`，由贡献方自己的 catalog 提供文案。Settings 只通过 app-level localization 解析这个窄契约，不直接依赖其他 domain 的内部 catalog。

按子模块组织 key：

- `settings.appearance.*`
- `settings.modelConfig.*`
- `settings.addModel.*`
- `settings.modelDetails.*`
- `settings.about.*`

模型选择选项构造落在 Settings 纯函数：

```text
apps/renderer/domains/settings/functions/buildModelSelectOptions.ts
```

它只服务 Settings。会话输入、知识库解析设置中仍有类似模型分组选项逻辑；后续如果要统一，应提升到模型相关 public contract，而不是继续复制到各 domain。

## 7. KnowledgeBase 迁移约定

KnowledgeBase 文案入口：

```text
apps/renderer/domains/knowledgebase/definitions/knowledgeBaseMessageCatalog.ts
apps/renderer/domains/knowledgebase/definitions/knowledgeBaseMessages.ts
apps/renderer/domains/knowledgebase/functions/resolveKnowledgeBaseMessage.ts
apps/renderer/domains/knowledgebase/ui/useKnowledgeBaseLocalization.ts
```

KnowledgeBase UI 使用 `useKnowledgeBaseLocalization()`，不要直接在组件里重复写 `message(key, fallback)`。

按子模块组织 key：

- `knowledgeBase.list.*`
- `knowledgeBase.detail.*`
- `knowledgeBase.globalUpload.*`
- `knowledgeBase.addTo.*`
- `knowledgeBase.create.*`
- `knowledgeBase.upload.*`
- `knowledgeBase.service.*`
- `knowledgeBase.manage.*`
- `knowledgeBase.settings.*`
- `knowledgeBase.graph.*`
- `knowledgeBase.parsing.*`
- `knowledgeBase.addModel.*`

上传 store 不承担翻译职责。新增或修改上传任务运行态状态时，优先写入 `createKnowledgeBaseUploadMessage(key, params)`；队列内已有的历史中文状态由 `knowledgeBaseUploadPresentation.ts` 在 UI 层映射到 message key。后端动态消息和错误详情暂时原样展示，等待统一错误码 / `UserFacingMessage` 契约。

KnowledgeBase 错误契约边界：

- 业务错误定义放在 `src/features/knowledge-base/definitions/knowledgeBaseErrors.ts`。
- IPC 映射放在 `src/electron-main/ipc/handlers/knowledge-base/knowledge-base-operation-failure.ts`。
- renderer 解析函数放在 `apps/renderer/domains/knowledgebase/functions/resolveKnowledgeBaseOperationFailure.ts`，只接受 KnowledgeBase catalog key。
- 上传/解析任务中的动态 `message/error` 仍是任务状态数据，暂不在本批次强行翻译；后续应按任务状态码或阶段枚举继续收束。

模型管理相关错误不直接展示 `Error.message` 作为主 UI 文案。`shared/stores/models.js` 只保存结构化 `{ operation, detail }` 供排查；Settings 和 KnowledgeBase 的页面错误条、添加模型表单、模型详情弹窗、删除模型 alert 都按所属 domain catalog 展示操作级失败文案。后端 detail 后续需要展示时，应先收敛为稳定错误码或 `UserFacingMessage`，不要在 UI 中重新拼接动态技术详情。

## 8. Conversation 迁移约定

Conversation 文案入口：

```text
apps/renderer/domains/conversation/definitions/conversationMessageCatalog.ts
apps/renderer/domains/conversation/definitions/conversationMessages.ts
apps/renderer/domains/conversation/functions/resolveConversationMessage.ts
apps/renderer/domains/conversation/functions/resolveCurrentConversationMessage.ts
apps/renderer/domains/conversation/ui/useConversationLocalization.ts
```

Conversation UI 使用 `useConversationLocalization()`，不要直接在组件里重复写 `message(key, fallback)`。非 Vue 但会直接生成用户可见标题/标签的配置或运行逻辑使用 `resolveCurrentConversationMessage()`，例如工具卡配置标题。

当前已接入范围：

- 对话视图：历史加载态、空态标题和描述。
- 输入区：默认 placeholder、Chat/Agent 模式、模型选择 placeholder、模型分组、workflow 添加/关闭按钮。
- 默认对话标题：创建新对话时按当前语言生成一次，同时写入 `titleOrigin: 'default'`；Header 只通过 `titleOrigin` 识别默认草稿标题，避免把默认占位名显示成正式面包屑，不通过“新对话”等文案字符串判断业务语义。
- 空白对话随机副标题：从 shared UI store 的中文字符串改为 Conversation 内部随机 key，切换语言时实时解析。
- 历史列表 / 历史下拉：加载态、空态、未命名会话、更多菜单、置顶/重命名/删除菜单、删除确认、toast 外层、相对日期中的“昨天”。
- 基础消息控件：用户消息按钮、复制状态、引用预览、表格 AI 上下文 fallback、摘要消息、图片消息、轮次/卡片复制和另存为文档按钮状态。
- Conversation 引用对象：默认引用 label 和多引用聚合 displayLabel 由 Conversation catalog 解析；引用文本、来源标题、URL 等事实数据保持原样。
- `ui_card` 卡片标题：表格填充 step 和通用 subrun step 由 `conversationCardPresentation.ts` 在展示层按当前语言解析；store / 历史消息里的 `headerText` 只作为兼容数据，不承担翻译职责。
- 思考消息：运行/完成标题和思考时长单位由 Conversation catalog 解析，语言切换后实时更新。
- 会话错误归一化：HTTP/SSE 的固定用户友好错误由 Conversation catalog 解析；后端已给出的短用户提示原样展示，技术细节仍只落到 rawMessage/details 供排查。
- 会话流程错误：发送/任务执行缺少 projectId、Deep Research 周配额、聊天/任务/流式编排失败、工具继续/恢复失败、表格填充 run 准备错误，以及内置插件 AI invocation port 的固定错误使用 Conversation catalog 解析；前端编排异常的 `Error.message` 只进入日志，不进入主错误 banner。
- 项目对话空态：项目 fallback 名称、输入 placeholder、建议 chip label、管理知识库按钮。
- 工具调用第一批：`ToolCallsMessage` 外层错误标题、工具错误卡片、打开文档失败 toast、Raw/RawText legacy renderer 兜底状态、common/workspace 工具卡标题和标签。
- 工具卡内部第一批：Web Search、Web Read、Knowledge Search、Subrun Trace、知识库文档列表和文档内容卡片内部文案，包含文档内容卡片的页码/段落标签。Knowledge Base 工具配置中的查看/搜索/阅读标题和深度搜索 tag 也归 Conversation catalog。Subrun Trace 保存延迟本地化 descriptor，展示时按当前语言解析；切换语言不重跑工具业务 projector。
- 工具卡内部第二批：TaskState、ToDo、SharedMemory 列表/读取/写入、ToolOutput fallback 卡片内部文案。SharedMemory 列表日期、读取/写入字数和 evidence / citation snapshot 默认标题会跟随当前语言格式化或解析。
- 工具卡内部第三批：Sheet overview/table/mutation 卡片内部文案，包括 loading、空态、错误、统计摘要、截断提示和本地生成的变更详情；工作表名、range、SQL diagnostics 等工具数据仍原样展示。
- 工具卡内部第四批：Ask Questions 问卷 UI 文案，包括 loading/空态、其他选项、输入 placeholder、选择计数、快捷键、提交/跳过状态和本地校验错误；提交给模型/后端的答案汇总文本保持协议原文，不参与 UI 多语言。
- 工具卡内部第五批：WriteToTable、Deep Research 子 agent、Skill learned 和 Task fallback 文案。工具结果、任务描述、技能名等事实数据仍原样展示；Task fallback 纯函数通过调用方注入 Conversation resolver，避免低层函数直接依赖全局语言状态。旧 Context Checkpoint 卡片及其 catalog key 已随工具退役直接删除。
- 工具卡内部第六批：Workspace 创建/阅读文档卡片内部文案，包括创建/读取 loading、未命名文档、空块、节点/段落范围和本地错误 fallback；Workspace 创建文档卡的文档类型标签通过 document type contribution presentation 解析，内置类型可随语言切换，未接入 `LocalizedText` 的插件类型继续显示 fallback。
- 工具卡内部第七批：ImageRenderer 图片工具卡、旧 table 写入模式文案，以及 Sheet 配置标题 fallback/query row count 文案。图片加载与复制相关 console 日志保持内部诊断文本，不纳入用户可见多语言范围。
- 引用渲染：citation popover、数学块复制按钮、raw renderer、workspace reference 链接标签/title/toast 和 citation 节点 aria-label 已接入；引用自身的标题、URL、页码等事实数据仍原样展示。

工具调用约定：

- `ToolUiConfig.title(args, result)`、`ToolTitleResolver` 与 `ToolTitleContext` 已移除。完整卡片标题只能由 owner `presentation` projector 生成延迟本地化 `ToolTitleDescriptor`；组件不再读取 raw payload。
- Subrun 等紧凑 surface 使用独立 `compactStep` projector 生成延迟本地化标题，与完整 projector 共用 Renderer registry 和 alias 解析，但不能互相调用。
- 插件与 Host 统一从 `plugin-host-contract` / Renderer SDK 门面消费 `ToolUiConfig`，禁止在插件包复制合同；SDK 新字段必须与公共合同同次转发并通过宿主构建类型检查。
- Conversation store 不承担运行时翻译职责；默认标题属于用户可见持久数据，只在创建时解析当前语言。历史已写入的标题不随语言切换重写，缺省展示 fallback 通过 `conversationTitlePresentation.ts` 由调用方注入 resolver。

暂未接入范围：

- Conversation 本体当前精确模板/弹窗扫描未发现新的用户可见静态硬编码；后续继续以真实用户路径窄扫新增工具卡和渲染子 feature。
- Markdown / 代码块等渲染子 feature 当前已覆盖代码复制、纯文本标签、数学块复制按钮、citation popover、raw renderer 和 workspace reference 链接/title/toast；代码语言名、URL、页码等事实数据仍原样展示。
- 插件贡献的 workflow 支持可选 `menuLocalizedText/pillLocalizedText/ariaLocalizedText`；内置 Deep Research 已接入，官方插件 workflow 后续在插件阶段注册插件 catalog 后接入。

## 9. Editor 迁移约定

Editor 文案入口：

```text
apps/renderer/domains/editor/definitions/editorMessageCatalog.ts
apps/renderer/domains/editor/definitions/editorMessages.ts
apps/renderer/domains/editor/functions/resolveEditorMessage.ts
apps/renderer/domains/editor/functions/resolveCurrentEditorMessage.ts
apps/renderer/domains/editor/ui/useEditorLocalization.ts
```

Editor Vue UI 使用 `useEditorLocalization()`，不要直接在组件里重复写 `message(key, fallback)`。

非组件运行逻辑（例如 Tiptap extension、菜单 provider）使用 `resolveCurrentEditorMessage()`。它只在用户交互或运行态 provider 执行时读取当前语言，不用于 store 默认状态，也不用于 prompt 正文。

当前已接入范围：

- 编辑器菜单栏：按钮 title、标题级别下拉、插入图片/录音/表格提示、开发测试文档 toast。
- 编辑器保存快捷键的无打开文件、保存中和意外错误通知。
- 块转换命令在表格内不可用时的 warning 通知。
- SlashMenu：分组、菜单项、空态和插入图片 toast。
- Find/Replace：面板标题、输入 placeholder、导航按钮、替换按钮、选项和无匹配提示。
- Outline：竖条 aria-label、空标题 fallback。
- 块操作菜单：创建副本、颜色、删除、添加批注、创建版本、查看历史版本、历史相关 toast。
- 块历史入口：版本标签、更多菜单、应用/删除版本确认弹窗、版本按钮 tooltip。
- BlockHistory 时间轴/覆盖预览：应用/退出/恢复按钮、历史版本 badge、空态、Esc 提示、来源标签和时间格式。
- Editor 开发调试面板与 LLM 请求调试弹窗，包括 token 计数标签。
- package `ColorPickerPanel` 保留标题/清除 props 并新增泛型 `labelResolver`；Editor 块颜色菜单由 Editor catalog 提供标题、清除按钮和颜色 tooltip，未覆盖的组件默认值才由 shared component catalog 解析。
- 文档加载失败通知：`editorService` 与 app-level `documentLoaderService` 统一使用 Editor catalog 的加载失败文案。
- AI 写作输入框与流式错误：输入 placeholder、取消/生成按钮 title 由 Editor catalog 解析；`useAiWritingController` 由 UI 注入 Editor resolver，流式 Markdown 队列的异常结束和队列处理错误通过 Editor 当前语言 resolver 解析。
- 编辑器块占位符：RootBlock 新建默认占位、块转换标题占位、Pending Revision 标题占位和 `PlaceholderPlugin` 的运行时 `data-placeholder` 统一归 Editor catalog；插件 decoration 在运行时解析当前语言，不把占位文案写进 store。
- FloatingToolbar、CodeBlock、ImageBlock 和 LaTeX Block：工具栏按钮、代码语言选择/复制、图片控件/属性面板、LaTeX 输入面板/错误包装文案/符号分类 tab；图片插入、开发测试文档创建和 LaTeX 渲染失败只展示操作级文案，底层异常详情保留在 console。
- Review 主工作流：设置页、角色选择/创建/编辑、处理进度、结果页、系统角色展示名、删除 tooltip 和卡片日期中的相对日期文案。
- Annotation 面板第一批：作者 fallback、已解决状态、查看/编辑/创建态按钮 title 与 aria-label、输入框 placeholder 和卡片相对日期中的“昨天”；创建失败 toast 只展示操作级文案，底层异常详情保留在 console。
- AudioBlock 第一批：录音控制条、播放器按钮 tooltip、内容面板 tab、笔记/转录/纪要工具栏、转录/翻译/生成纪要 toast、右键属性菜单和本地状态提示。
- AudioBlock 非 NodeView 渲染占位、转录文件大小限制、API 地址缺失和转录服务本地 fallback 错误已接入 Editor catalog；转录 prompt、后端动态错误详情和内部进度日志保持原样。
- AudioBlock 内容面板创建/编辑时间的相对日期标签由 Editor catalog 注入 `shared/utils/dateFormatter.js`；shared 只做日期计算，不保存业务可见文案。
- TableBlock 第一批：简易表格工具栏、AI 批量填充按钮、工具栏下拉菜单、AI 表格上下文标签/tooltip、表格尺寸选择器、AI 操作 alert 和插入表格失败 notification；AI 填充失败 alert 不拼接底层异常详情。
- Citation 第一批：插入引用面板、KB 搜索 tab、网页/手动表单、引用 popover、编辑引用面板、参考文献块、内联触发菜单、固定本地 fallback 与表单校验错误。
- Citation 剪贴板复制：复制 bibliographyBlock 到外部富文本应用时的空参考文献文案使用 Editor 当前语言解析；外部来源标题、作者、URL 等事实数据仍原样输出。
- Editor 剪贴板 Markdown serializer 的参考文献、图片占位和音频占位标签由 Editor catalog 注入；AI context / KnowledgeBase 入库这类非直接 UI 语料继续使用 serializer 默认兼容标签。
- Revision 第一批：块级浮动工具栏、文档级全局工具栏、块修订指示器、单条 mark 操作弹窗、Shell 文档流 header 的 label/title/aria-label 和本地相对时间文案。

Review 约定：

- 系统角色用 `logicCheck / structure / polish` 作为稳定业务 ID；store 不保存这些角色的展示名。
- `reviewStore.progressState` 只保存结构化进度，Vue 层通过 `reviewProgressPresentation` 解析当前语言文案。
- Review 失败进度只展示操作级本地化文案；流式调用、分段导出和批注刷新等底层异常详情只保留在 console，不写进 `progressState` 作为主 UI 文案。
- 历史批注优先用 `annotation.meta.agentId` 解析系统角色展示名；没有 agentId 的旧数据继续展示原 author。

Annotation 约定：

- store 内历史默认作者 `用户` 保持为数据层兼容值；Vue 展示层通过 `annotationPresentation` 解析成当前语言。
- Annotation 当前只迁移面板 UI、按钮辅助文案和本地相对日期。prompt 正文、代码注释、控制台日志和内部命令错误不属于本批迁移范围。

AudioBlock 约定：

- store 和录音服务中已有的短状态文案保持为兼容值，Vue 展示层通过 `audioBlockPresentation` 映射到当前语言；动态系统错误详情不作为主 UI 文案展示。
- 新增或修改 AudioBlock 运行态状态时，优先写入 `createAudioBlockMessage(key, params)`，不要再写固定中文状态字符串；旧中文映射只作为历史兼容层保留。
- `resolveCurrentEditorMessage()` 仅用于用户交互时的 toast、菜单 provider 和运行态 composable，不让 store 反向承担翻译职责。
- AudioBlock AI 内容服务中会被 toast 展示的固定空内容错误、转录前端固定大小限制/API 地址/服务 fallback 错误通过 `resolveCurrentEditorMessage()` 解析；翻译/纪要 prompt 正文和模型输出内容不参与 UI 多语言。
- AudioBlock 的设备检测、音频加载、保存 fallback、录音处理、播放、转录、翻译和纪要生成失败只展示操作级本地化文案；浏览器异常、IPC error 和 AI 服务异常详情只保留在 console 或结构化状态 detail，不拼进 toast/status。
- 翻译目标语言同时保留 UI label 和传给 AI 服务的稳定 service label，避免 UI 语言切换改变业务目标语言。
- 转录 prompt、AI 内容生成 prompt、代码注释、控制台日志和 `transcriptDataConverter` 示例数据不属于本批迁移范围。

TableBlock 约定：

- 工具栏菜单结构由 `blocks/TableBlock/functions/tableBlockPresentation.ts` 统一构造，组件只负责展示和触发动作。
- `toolbarMenuConfig.js` 是历史静态配置出口，当前真实 UI 使用 TableBlock presentation builder；保留默认导出兼容旧调用方，但文案来源改为 Editor catalog fallback。
- 非组件运行逻辑使用 `resolveCurrentEditorMessage()` 解析当前语言的 alert/notification，不把翻译职责放进 table assistant store。
- TableBlock 的 prompt、代码注释、控制台日志、内部调试字符串和测试 fixture 不属于本批迁移范围。

Citation 约定：

- 表单校验从中文错误文案改为稳定错误码，UI 通过 `citationPresentation` 解析当前语言；store 不保存翻译后的展示文案。
- Citation 的来源类型 label、作者列表 “等/et al.”、页码、插入按钮和同源引用提示由 `features/citation/functions/citationPresentation.ts` 统一处理。
- `convertKbResultToCitationAttrs` 保持公共导出兼容，允许调用方传入当前语言下的未知文档 fallback；未传入时只在运行态读取当前 Editor message。
- 插件 runtime port 暴露的 `validateWebManualForm` 当前返回错误码，插件侧展示需要在插件阶段通过 host SDK / `LocalizedText` 解析，主应用不替插件内容硬编码翻译。
- Citation 的 prompt、代码注释、控制台日志、debugLog、内部 invariant 错误和测试 fixture 不属于本批迁移范围。

Revision 约定：

- Revision 的组合文案由 `features/Revision/functions/revisionPresentation.ts` 统一处理，包括统计标题、mark 操作 title、块数量和相对时间标签。
- Shell 文档流 header 是原生 DOM 渲染，不是 Vue 模板；`useShellBlockRevisionHeader` 会把当前 locale 和 Editor resolver 传入 DOM renderer，并在语言切换时重新同步已渲染 header。
- Revision store、pending 投影、reconciliation 和 toolbar action 逻辑不承担翻译职责；它们只保留结构化状态和业务动作。
- `diffApplier` 的 catch fallback 使用 Editor 当前语言的 `editor.common.unknownError`；具体业务失败原因暂保留原结构化返回，后续确认用户可见后再按 Revision 子 feature 归档。
- Revision store / pending projection / perf 中的 error 字段当前用于内部诊断、聚合统计和 console，不直接作为 toast/banner 展示；后续若要展示给用户，应先归并为 Revision catalog 的稳定操作级文案。
- `shared/utils/dateFormatter.js` 的 `formatTime()` 不保存业务相对日期文案，调用方必须按所属 domain 注入标签；`formatDueDateLabel()` 暂未发现当前 UI 调用方，后续接入 Todo 等真实用户路径时再按调用方 catalog 注入。
- Revision 的代码注释、console/debugLog、内部 invariant 错误、性能诊断和测试 fixture 不属于本批迁移范围。

Shared store 与 Workspace export 约定：

- `shared/stores/models.js` 只保存结构化错误 `{ operation, detail }`，不保存翻译后的文案；Settings 和 KnowledgeBase 分别通过各自的 `modelStoreErrorPresentation` 解析当前语言。
- `shared/stores/file.ts` 只暴露当前文件名事实；没有打开文件时不生成“未命名文档”这类用户可见占位。
- 单文档导出的默认文件名属于 Workspace import-export feature，由 `workspace.export.defaultFileName` 和 `functions/exportFileName.ts` 生成；不要在 shared file store 或 export service 内写固定 `Untitled.*`。

## 10. 本体静态 UI 审计

本体 Vue 静态用户文案使用专门脚本审计：

```bash
npm run audit:i18n:user-visible
```

脚本位置：

```text
scripts/benchmark/i18n-user-visible-audit.ts
```

当前覆盖范围：

- `apps/renderer/app`
- `apps/renderer/domains`
- `apps/renderer/shared`

默认排除：

- `domains/sheet/engine`
- `domains/sheet/react-ref`
- `docs`
- `*.test.*` / `*.spec.*` / `*.stories.*`
- `__tests__` / `__test__`

审计内容：

- Vue template 中会真实渲染的静态文本。
- 常见用户可见静态属性和组件 props，例如 `title`、`placeholder`、`aria-label`、`alt`、`primary-action-text`、`secondary-action-text`、`trigger-title`。
- TS/JS/Vue script 中 `notificationStore.show()`、`useNotificationStore().show()`、`confirm()`、`window.confirm()`、`alert()` 第一参数或确认框对象内 `title/message` 等字段的静态字符串。
- TS/JS/Vue script 中常见展示配置字段的静态字符串，例如 `title`、`label`、`message`、`description`、`placeholder`、`tooltip`、`ariaLabel`。

当前允许保留的命中只限事实数据、技术标签、快捷键片段、URL 示例、单字符图标文本、DOM contract、内部诊断、已由 `LocalizedText/titleMessageKey` 接管的兼容 fallback 和 SVG 元数据，例如 `URL`、`LLM`、`ms`、`Ctrl`、`ESC`、`Enter`、`http://localhost:11434`、`feedback@linnyai.com`、RootBlock DOM attribute 名、内置 platform contribution 旧字符串字段、`currentRelease.generated.ts` 单语言发布源、`LinnyaIcon.vue` 内的 `data-name`。这些不是当前业务 UI 文案真源。

边界：

- 该脚本证明“本体 Vue 静态模板 + 常见运行态提示入口”没有新增静态硬编码，不证明后端错误、插件 manifest、插件 UI 或动态工具结果已完成。
- 后端错误、工具卡动态结果、插件 manifest 和插件 renderer 仍需按真实用户路径窄扫。

## 11. 暂未接入范围

- Review 旧 mock 调试工具、prompt 正文和后端内置角色提示词。
- TableBlock 旧调试工具、内部日志、prompt 和未进入用户界面的诊断字符串。
- Citation 旧调试工具、内部日志、插件端展示接入和未进入用户界面的诊断字符串。
- Revision store / pending projection / perf 中的 error 字段当前用于内部诊断、聚合统计和 console，不直接作为 toast/banner 展示；后续若要展示给用户，应先归并为 Revision catalog 的稳定操作级文案。
- Editor 本体当前精确模板/弹窗扫描未发现新的用户可见静态硬编码；后续继续以真实用户路径窄扫旧调试入口、实验入口和新增渲染子 feature。

这些子 feature 的业务语义不同，应继续按 feature 分批迁移，避免把 Editor catalog 变成无边界的杂物间。

## 12. 后续接入规则

新增模块文案时：

1. 在对应 domain 内新增 message catalog。
2. 在对应 domain orchestration 中注册 catalog。
3. UI 通过 `useLocalization()` 获取 `message()` 或 `t()`。
4. store 不负责翻译，只保存状态。
5. prompt 正文、代码注释、测试 fixture 不进入迁移范围。

如果一个文案来自插件 manifest、插件 contribution 或后端错误，不直接塞进主应用 UI catalog，后续分别通过 manifest projection、`LocalizedText` contribution、`UserFacingMessage` 错误契约接入。

Shared 基础控件是一个例外，但范围必须很窄：只能在 `@linnya/renderer-ui/localization` 登记控件自身不可避免的默认 UI 文案。业务含义明确的文案仍属于调用方所在 domain，不能因为组件可复用就放进 Renderer UI catalog。
