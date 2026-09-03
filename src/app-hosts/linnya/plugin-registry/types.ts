/**
 * @file types.ts
 * @description 后端插件 contribution 契约的 host 兼容入口。
 *
 * 中文说明：
 * - 契约真源在 `@linnya/plugin-host-contract`，`src/plugin-sdk` 只是兼容门面；
 * - host registry 消费 SDK 门面并在本文件叠加少量 host 内部增强类型；
 * - 新插件和新 host 代码优先从 `@plugin/backend/pluginContribution` / `src/plugin-sdk/backend/pluginContribution` 取类型。
 */

export type {
  BackendPluginAgentContribution,
  BackendPluginCliContribution,
  BackendPluginCliContributionPoint,
  BackendPluginAgentFenceDescriptor,
  BackendPluginDatabaseContribution,
  BackendPluginDocumentContribution,
  BackendPluginDocumentTypeHook,
  BackendPluginHiddenWorker,
  BackendPluginIpcContribution,
  BackendPluginIpcGatewayContribution,
  BackendPluginIpcHandler,
  BackendPluginIpcHandlerRegistrar,
  BackendPluginIpcRegistrar,
  BackendPluginIdentityContribution,
  BackendPluginLegacyIpcCompatibilityContribution,
  BackendPluginMigrationDefinition,
  BackendPluginRuntimeContribution,
  BackendPluginRuntimeEffect,
  BackendPluginSandboxProfile,
  BackendPluginSchemaProvider,
  BackendPluginRendererPushContribution,
  BackendPluginRendererPushGatewayContribution,
  BackendPluginSkillContribution,
  BackendPluginToolContribution,
  BackendPluginToolContextBindingMigrator,
  BackendPluginToolContextDecorator,
  BackendPluginToolContextDecoratorParams,
  SubagentTypeContribution,
  ToolClassCtor,
} from '../../../plugin-sdk/backend/pluginContribution';
import type {
  BackendPluginAgentDefinition,
  PluginBackendContribution as SdkPluginBackendContribution,
} from '../../../plugin-sdk/backend/pluginContribution';
import type { AgentDefinition as HostAgentDefinition } from '../agent-registry/types';
import type { DocumentTypeBackendHook } from '@plugin/backend/documentTypeBackendHook';
import type { ISchemaProvider } from '../../../shared/database/schema-provider';
import type { PluginMigrationDefinition } from '@plugin/backend/pluginMigration';

export type PluginAgentDefinitionContribution =
  | BackendPluginAgentDefinition
  | HostAgentDefinition;

export type PluginBackendContribution = SdkPluginBackendContribution & {
  agentDefinitions?: readonly PluginAgentDefinitionContribution[];
  documentTypeHooks?: readonly DocumentTypeBackendHook[];
  schemaProviders?: readonly ISchemaProvider[];
  pluginMigrations?: readonly PluginMigrationDefinition[];
};
