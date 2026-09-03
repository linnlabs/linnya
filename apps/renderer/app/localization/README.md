# Renderer 本地化

`apps/renderer/app/localization` 是 Linnya Renderer 的本地化运行时 owner。它拥有当前语言、catalog 注册表、文案解析、参数插值和 Vue 接入；各业务模块仍拥有自己的文案与 key，不能把所有文案集中到这里。

当前正式支持 `zh-CN` 和 `en-US`，默认及最终 fallback 均为 `zh-CN`。支持范围与默认值以 [`definitions/locale.ts`](./definitions/locale.ts) 为准。

## 边界

本模块负责：

- 保存并切换 Renderer 当前语言，同步 `document` 的语言属性；
- 按 owner 注册、注销并查询 message catalog，拒绝不同 owner 的同语言 key 冲突；
- 按“当前语言 → fallback 语言 → 调用方 fallback”解析 `LocalizedText`；
- 为 Vue 组件和非 Vue 调用方提供同一套解析入口；
- 向 `@linnya/renderer-ui` 提供默认文案解析 port。

本模块不负责：

- 业务文案、业务错误含义和具体 catalog 内容；
- Backend 的业务错误分类或跨进程 DTO；
- 插件自己的文案生命周期；
- 根据浏览器或系统语言静默改变产品语言。

## 数据流与入口

应用启动时，[`app/main.js`](../main.js) 先注册 App、Domain、Workflow 与共享组件 catalog，再安装 Pinia 并初始化本模块。`registerMessageCatalogs` 把 catalog 写入 registry；`useLocalization` 订阅当前语言和 registry revision，通过 `resolveLocalizedText` 输出最终文本。

| 要改的内容 | 唯一入口 |
| --- | --- |
| 支持语言、默认语言与 fallback | [`definitions/locale.ts`](./definitions/locale.ts) |
| `LocalizedText` 与 catalog 合同 | [`@linnya/plugin-host-contract`](../../../../packages/plugin-host-contract/renderer/localization.ts) |
| catalog 注册、冲突与查询 | [`registry/localizationRegistry.ts`](./registry/localizationRegistry.ts) |
| fallback 与参数插值 | [`functions/resolveLocalizedText.ts`](./functions/resolveLocalizedText.ts)、[`functions/interpolateMessage.ts`](./functions/interpolateMessage.ts) |
| 当前语言持久化 | [`store/localizationStore.ts`](./store/localizationStore.ts) |
| Vue 使用入口 | [`vue/useLocalization.ts`](./vue/useLocalization.ts) |
| 共享 UI 默认解析器 | [`orchestration/provideSharedComponentLocalization.ts`](./orchestration/provideSharedComponentLocalization.ts) |

`packages/plugin-host-contract/renderer/localization.ts` 是插件和独立 package 可见的编译期门面；Renderer App 运行时仍由本目录提供真实实现。插件不得 deep import 本目录内部文件。

## Catalog 归属

文案跟随业务 owner，而不是跟随页面或组件类型：

- App shell、update、system 与跨 domain workflow 的 catalog 放在对应 `apps/renderer/app/*` owner；
- Conversation、Editor、Workspace、Knowledge Base、Settings、Plugin Store 等文案放在各自 `apps/renderer/domains/*`；
- `@linnya/renderer-ui` 只拥有真正跨业务的基础控件默认文案；业务标题、实体名、错误解释和操作结果由调用方提供；
- Mindmap、Slides 等插件在自己的 renderer 注册阶段注册 catalog，并随插件生命周期演进。

owner 目录可以按自身复杂度选择 `locales/messageCatalog.ts`、feature-local catalog 或其他清晰结构，不要求为了形式统一创建固定五件套。单个 catalog 已明显影响查找和审阅时，应在同一 owner 内按 locale 或稳定 feature 边界拆分，再由一个公开 contribution 聚合；不能上移到本模块规避拆分。

## 文案规则

- key 使用稳定的 owner/feature 语义命名，不使用英文原文、页面位置或临时组件名充当身份；同一含义只保留一个 owner；
- 新增面向用户的文案时，同时提供 `zh-CN`、`en-US` 和调用点 fallback；fallback 是异常情况下的可读保障，不是漏翻译的长期替代；
- 动态内容通过 `params` 插值，参数只允许字符串和数字。不要拼接可翻译句子，也不要把 HTML、密钥、原始异常或 Provider 响应塞进参数；
- 普通字符串表示已经由调用方确定、无需再次查表的文本；需要跨边界延迟解析时使用带 `key`、`fallback`、`params` 的 `LocalizedText`；
- 不根据错误消息文本、模型名、URL 或 locale 写业务分支。本地化只决定展示，不决定业务行为。

Vue 组件使用 `useLocalization`，以便切换语言和动态注册 catalog 时自动更新。非 Vue 代码使用 `resolveLocalizedText` 并显式提供 locale、fallbackLocale 与 resolver；不要在纯函数中读取 Pinia store。

## 跨进程错误

Backend 先生成稳定业务错误和可选的 `UserFacingMessage`，跨进程合同由 [`packages/schemas/src/user-facing-message.ts`](../../../../packages/schemas/src/user-facing-message.ts) 拥有。Renderer 在展示边界用当前 owner 的 catalog 解析 `userMessage`。

`OperationFailure.error` 是必需的诊断字段，不是兼容旧调用的展示文案；UI 不应直接展示它。Provider 原始错误、响应正文、token、路径和堆栈不得进入可翻译参数或用户提示。

## 验证

- `pnpm run audit:i18n:user-visible`：扫描 Vue 与 Renderer 源码中的疑似硬编码用户文案；
- `pnpm exec vitest run apps/renderer/app/localization`：验证 registry、fallback 与插值行为；
- `pnpm typecheck:renderer`：验证 Renderer 与插件门面类型；
- `pnpm run guard:public-source-sanitization`：检查公开源码中的路径和敏感信息。

审计结果用于定位真实用户文案，不要求把日志、测试 fixture、协议常量和开发诊断机械地搬进 catalog。目录变化、支持语言或跨边界合同变化时，同步更新本 README 与对应 owner 文档。
