---
title: Linnya 多语言开发规范
status: active
last_updated: 2026-06-23
applies_to: apps/renderer/**, src/electron-main/**, packages/plugins/**
---

# Linnya 多语言开发规范

本文档是 Linnya 多语言开发的长期工程约定。历史调查、迁移计划和阶段记录放在 `docs/i18n/` 其它文件中；日常新增功能、修复 UI、接入插件时，以本文为准。

## 1. 目标

Linnya 当前支持：

- `zh-CN`
- `en-US`

多语言目标是让用户能在设置里切换语言，并立即看到 UI、提示、错误和操作反馈切换。内部开发诊断可以继续使用中文；不要为了“清零中文字符串”去修改不会展示给用户的内容。

## 2. 范围

需要多语言化：

- UI 标题、按钮、菜单、tab、标签、空态、说明文案。
- `placeholder`、`title`、`aria-label`、tooltip、popover。
- toast / notification / confirm / alert / modal 文案。
- 用户会看到的错误、状态、进度、操作结果。
- 系统对话框标题、按钮、过滤器名称等用户可见参数。
- 插件展示文案、插件贡献入口文案和插件 UI 文案。

不需要多语言化：

- 代码注释。
- prompt 正文。
- console / logger / 内部诊断。
- 测试 fixture。
- 内部返回值、内部 reason、内部 error 字段，除非已经确认会进入 UI。
- 用户内容和事实数据，例如文件名、项目名、插件名、URL、代码语言名、版本号、页码、搜索结果正文。

判断标准很简单：用户在正常产品界面里能看到，就要走多语言；只给开发者排查用，就不要迁移。

## 3. 架构边界

统一基础能力在：

```text
apps/renderer/app/localization/
```

这里只放跨模块稳定能力：

- 支持语言定义。
- 当前语言 store 和持久化。
- catalog 注册表。
- `LocalizedText` 解析。
- 参数插值。
- `<html lang>` 同步。
- Vue 使用入口。

它不是全局文案仓库。业务文案必须按归属放回自己的 domain / app module / plugin。

常见归属：

```text
apps/renderer/app/layout/definitions/layoutMessageCatalog.ts
apps/renderer/app/system/definitions/systemMessageCatalog.ts
apps/renderer/app/update/definitions/updateMessageCatalog.ts
apps/renderer/app/plugins/definitions/pluginContributionMessageCatalog.ts
apps/renderer/domains/settings/definitions/settingsMessageCatalog.ts
apps/renderer/domains/workspace/definitions/workspaceMessageCatalog.ts
apps/renderer/domains/knowledgebase/definitions/knowledgeBaseMessageCatalog.ts
apps/renderer/domains/conversation/definitions/conversationMessageCatalog.ts
apps/renderer/domains/editor/definitions/editorMessageCatalog.ts
apps/renderer/domains/plugin-store/definitions/pluginStoreMessageCatalog.ts
apps/renderer/domains/sheet/definitions/sheetMessageCatalog.ts
packages/renderer-ui/src/localization/definitions/sharedComponentMessageCatalog.ts
```

Renderer UI catalog 只放真正跨业务基础控件自身的默认文案，例如通用 Modal、AlertDialog、CustomSelect。
带明确业务语义的组件留在所属 app/domain/feature，文案也归该业务 owner。

## 4. Catalog 约定

每个 domain 保持三类文件：

```text
definitions/<domain>Messages.ts
definitions/<domain>MessageCatalog.ts
functions/resolve<Domain>Message.ts
ui/use<Domain>Localization.ts
orchestration/ensure<Domain>LocalizationRegistered.ts
```

示例：

```ts
export type WorkspaceMessageKey =
  | 'workspace.project.create.title'
  | 'workspace.project.create.namePlaceholder';

export const WORKSPACE_MESSAGE_FALLBACKS = {
  'workspace.project.create.title': '新建项目',
  'workspace.project.create.namePlaceholder': '项目名称',
} as const satisfies Readonly<Record<WorkspaceMessageKey, string>>;
```

要求：

- key 以 domain 前缀开头，例如 `workspace.*`、`editor.*`。
- 一个 key 表达一个稳定用户语义，不要把多个场景硬塞进一个 `common.error`。
- 参数只用字符串或数字，例如 `{count}`、`{fileName}`。
- `zh-CN` fallback 是中文基准文案。
- `en-US` 必须和 `zh-CN` key 集合一致。
- 不允许跨 owner 重复注册同一个 key。
- 不把后端自然语言错误、插件远端详情、用户内容写进 catalog。

### 4.1 多语言扩展形态

当前 Linnya 只维护 `zh-CN` / `en-US`，所以允许一个模块的 `definitions/<domain>MessageCatalog.ts` 同时放两种语言，方便中英对照和快速审查。

如果未来新增第三种语言，或某个模块的 catalog 明显变长，应迁移到“模块内按语言拆文件”的形态：

```text
domains/workspace/
├── definitions/
│   ├── workspaceMessages.ts
│   └── workspaceMessageCatalog.ts      # 只负责聚合 locales
├── locales/
│   ├── zh-CN.ts
│   ├── en-US.ts
│   └── ja-JP.ts
```

示例：

```ts
// domains/workspace/locales/zh-CN.ts
import type { WorkspaceMessageKey } from '../definitions/workspaceMessages';

export const WORKSPACE_ZH_CN_MESSAGES = {
  'workspace.project.create.title': '新建项目',
} as const satisfies Readonly<Record<WorkspaceMessageKey, string>>;
```

```ts
// domains/workspace/definitions/workspaceMessageCatalog.ts
import type { MessageCatalogContribution } from '@app/localization';
import { WORKSPACE_ZH_CN_MESSAGES } from '../locales/zh-CN';
import { WORKSPACE_EN_US_MESSAGES } from '../locales/en-US';

export const WORKSPACE_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'workspace',
  catalogs: {
    'zh-CN': WORKSPACE_ZH_CN_MESSAGES,
    'en-US': WORKSPACE_EN_US_MESSAGES,
  },
};
```

不要迁移成全局大字典：

```text
app/localization/locales/zh-CN.ts
app/localization/locales/en-US.ts
```

全局语言文件会破坏业务边界，后续容易变成文案杂物间。正确方向是：**语言能力统一，文案仍按 domain / plugin 高内聚管理**。

迁移原则：

- 先按模块迁，不做全项目一次性大重构。
- `definitions/<domain>Messages.ts` 的 key 类型保持不变。
- `definitions/<domain>MessageCatalog.ts` 的导出名保持不变，调用方无需跟着改。
- 每个 locale 文件继续用 `satisfies Readonly<Record<DomainMessageKey, string>>` 保证 key 不漏。
- 翻译平台接入前，优先用 TypeScript locale 文件；如果未来改用 JSON/YAML，应增加生成类型或校验脚本，不能牺牲 key 完整性。

## 5. Vue 使用方式

Vue 组件里使用当前 domain 的 hook：

```ts
const { workspaceMessage } = useWorkspaceLocalization();
```

模板里直接解析：

```vue
<button :title="workspaceMessage('workspace.project.create.title')">
  {{ workspaceMessage('workspace.project.create.title') }}
</button>
```

带参数：

```vue
{{ workspaceMessage('workspace.project.count', { count: projectCount }) }}
```

不要在模板里写新的硬编码用户文案。URL 示例、快捷键符号、技术协议名、用户输入内容可以保持原样。

## 6. 非 Vue 逻辑

非 Vue 文件不要偷偷 import UI hook。按场景选一种方式：

- UI 调用的 service / orchestration：由调用方注入 message resolver。
- 会直接触发用户提示、没有自然调用方注入点：使用对应 domain 的 `resolveCurrent<Domain>Message()`。
- store：只保存状态、枚举、错误码和用户数据，不负责翻译。

推荐：

```ts
export function buildExportMessage(params: {
  message: WorkspaceMessageResolver;
  fileName: string;
}): string {
  return params.message('workspace.export.completed', { fileName: params.fileName });
}
```

避免：

```ts
notificationStore.show(`导出失败：${error.message}`, 'error');
```

## 7. 错误与动态状态

用户可见错误必须收束成稳定文案。

允许展示：

- 本地化操作级提示：`保存失败，请稍后重试。`
- 稳定错误码映射后的用户文案。
- 用户内容：文件名、项目名、插件名。
- 数量、版本号、时间等事实数据。

不要展示：

- `Error.message`。
- IPC `error`。
- 后端 `detail`。
- 远端接口返回的自然语言错误。
- provider / protocol / stack / SQL / HTTP body 细节。

后端到前端的推荐结构：

```ts
{
  success: false,
  error: 'diagnostic text for logs',
  userMessage: {
    key: 'workspace.project.create.failed',
    params: { projectName }
  }
}
```

renderer 只解析 `userMessage.key`。`error` 保留给日志和兼容旧调用，不作为 UI 主文案。

如果当前后端只能返回动态 message，UI 层宁可展示操作级 fallback，也不要把原始 message 拼给用户。

## 8. 后端与 IPC

主进程不直接承担 UI 翻译，但 IPC 边界要提供稳定用户错误契约。

推荐分层：

- service 层：表达业务规则和业务错误类型。
- IPC handler：把业务错误映射为 `UserFacingMessage` / `OperationFailure`。
- renderer domain：用自己的 catalog 解析并展示。

系统级能力放 `app/system`，例如打开外链、系统文件对话框、导出保存、转录服务等。业务操作提示仍归调用方 domain，例如 Workspace 导出操作失败归 Workspace catalog。

## 9. 插件

插件阶段也必须纳入统一语言系统，不单独兼容一套翻译机制。

插件应提供自己的 catalog，并通过 host SDK / contribution 注册。

插件相关文案分三类：

- 插件商店外壳：归 `domains/plugin-store`。
- Linnya 内置 contribution 展示名：归 `app/plugins`。
- 插件自身 manifest、工具卡、设置页、文档类型、菜单、错误：归插件包自身。

插件 manifest / contribution 应优先使用 `LocalizedText`：

```ts
{
  key: 'slides.documentType.presentation.label',
  fallback: '演示文稿'
}
```

插件名、品牌名、URL、版本号、开发者名可以保持原始数据；描述、详情、release notes、技能说明、agent 说明、设置项、按钮和错误提示要本地化。

## 10. 审计与测试

本体静态用户可见审计：

```bash
npm run audit:i18n:user-visible
```

它能发现常见 Vue template、用户可见属性、toast / confirm / alert 的静态硬编码，但不能证明动态链路已经完全安全。动态错误、后端 message、插件 manifest、工具结果仍要沿调用链人工确认。

新增或修改多语言逻辑时，优先补以下测试：

- resolver 测试：key、参数、fallback。
- UI 行为测试：切换语言后展示变化。
- 动态错误测试：后端 raw error / detail 不进入 UI。
- contribution 测试：`LocalizedText` 能按当前语言解析，旧 string fallback 仍兼容。

## 11. 提交流程检查

提交前确认：

- 新增用户可见文案都走对应 domain catalog。
- 没有把业务文案放进 `app/localization`。
- 没有把明确业务语义丢进 shared catalog。
- 没有在 UI 中拼接 raw `error.message` / `result.error` / `detail`。
- store 没有新增需要随语言切换的展示文案。
- `zh-CN` 和 `en-US` key 集合一致。
- `npm run audit:i18n:user-visible` 通过。

## 12. 常见反例

反例：用字符串判断业务状态。

```ts
if (title === '新对话') {
  // ...
}
```

应改为结构化状态、类型、metadata 或 domain 函数判断。

反例：把后端错误拼给用户。

```ts
notificationStore.show(`插件安装失败：${result.error}`, 'error');
```

应改为：

```ts
notificationStore.show(pluginStoreMessage('pluginStore.error.installFailed'), 'error');
```

反例：把内部进度自然语言原样显示。

```ts
return task.message;
```

应改为稳定状态映射：

```ts
return message(STATUS_FALLBACK_KEYS[task.status]);
```

反例：为一个业务组件把文案塞到 shared。

```text
packages/renderer-ui/src/localization/definitions/sharedComponentMessageCatalog.ts
```

如果这个文案只属于 Editor、Conversation 或 Workspace，就放回对应 domain。
