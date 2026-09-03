/**
 * @file pluginContribution.ts
 * @description 渲染端插件 contribution 的 SDK 契约真源。
 *
 * 中文说明：
 * - 插件包只依赖 SDK 公开类型，不直接穿透到 app/plugins/types；
 * - 具体注册仍由 host 的 renderer plugin registry 执行；
 * - host 可以在 `apps/renderer/app/plugins/types.ts` 对这些结构做更强类型约束，
 *   但 SDK 不能反向 import host app 内部契约。
 */

export type {
  ConversationAgentChoiceContribution,
  ConversationSubrunWorkerContribution,
  DocumentActionMenuContribution,
  DocumentActionMenuOption,
  DocumentActionMenuOptionValue,
  DocumentEntityReferenceContribution,
  DocumentRuntimeLoaderContribution,
  DocumentRuntimeLoadRequest,
  DocumentTypeContribution,
  PluginConversationInputContribution,
  RendererPluginContribution,
} from '@linnya/plugin-host-contract/renderer/pluginContribution';
