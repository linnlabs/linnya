/**
 * @file pluginContribution.ts
 * @description 后端插件 contribution 的 SDK 门面。
 *
 * 中文说明：
 * - 纯结构契约真源在 `@linnya/plugin-host-contract`；
 * - 本文件只做 SDK 兼容 re-export，不再把 sandbox / hidden worker 的 host 内部类型
 *   暴露给插件贡献声明；
 * - 运行时注册仍由 host 同步器接线，插件侧只依赖契约包里的协议形状。
 */

export type {
  AgentDefinition as BackendPluginAgentDefinition,
  SubagentTypeContribution,
} from '@linnya/plugin-host-contract/backend/agentRegistry';
export type {
  BackendPluginAgentContribution,
  BackendPluginAgentFenceCategory,
  BackendPluginAgentFenceDescriptor,
  BackendPluginDatabaseContribution,
  BackendPluginDocumentContribution,
  BackendPluginDocumentTypeHookSummary as BackendPluginDocumentTypeHook,
  BackendPluginHiddenWorker,
  BackendPluginIpcContribution,
  BackendPluginIpcGatewayContribution,
  BackendPluginIpcHandlerRegistrar,
  BackendPluginIpcRegistrar,
  BackendPluginIdentityContribution,
  BackendPluginLegacyIpcCompatibilityContribution,
  BackendPluginMeta,
  BackendPluginRendererPushContribution,
  BackendPluginRendererPushGatewayContribution,
  BackendPluginRuntimeEffect,
  BackendPluginRuntimeEffectContribution,
  BackendPluginSandboxProfile,
  BackendPluginSchemaProvider,
  BackendPluginSkillContribution,
  BackendPluginToolContribution,
  BackendPluginToolContextBindingMigrator,
  BackendPluginToolContextDecorator,
  BackendPluginToolContextDecoratorParams,
  BackendPluginRuntimeContribution,
  PluginBackendContributionBase,
  PluginBackendContribution,
  ToolClassCtor,
} from '@linnya/plugin-host-contract/backend/pluginContribution';
export type {
  BackendPluginCliAccessPlan,
  BackendPluginCliContribution,
  BackendPluginCliContributionPoint,
  BackendPluginCliExecutionContext,
  BackendPluginCliPlan,
  BackendPluginCliPreparation,
  BackendPluginCliResult,
} from '@linnya/plugin-host-contract/backend';
export type {
  BackendPluginIpcHandler,
} from '@linnya/plugin-host-contract/backend/pluginIpcRuntime';
export type {
  PluginMigrationDatabase as BackendPluginMigrationDatabase,
  PluginMigrationDefinition as BackendPluginMigrationDefinition,
  PluginMigrationStatement as BackendPluginMigrationStatement,
} from '@linnya/plugin-host-contract/backend/pluginMigration';
