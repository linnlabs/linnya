import type { PluginId } from '@app/schemas';
import type {
  BackendPluginIpcContribution,
  BackendPluginIpcHandlerRegistrar,
  BackendPluginAgentFenceDescriptor,
  BackendPluginHiddenWorker,
  BackendPluginRuntimeEffect,
  BackendPluginCliContribution,
  BackendPluginSandboxProfile,
  BackendPluginToolContextBindingMigrator,
  BackendPluginToolContextDecorator,
  PluginBackendContribution,
  SubagentTypeContribution,
  ToolClassCtor,
} from './types';
import { pluginDiagnostics } from './diagnostics';
import {
  registerDocumentTypeBackendHook,
  type DocumentTypeBackendHook,
  unregisterDocumentTypeBackendHook,
} from '@plugin/backend/documentTypeBackendHook';
import type { ISchemaProvider } from '../../../shared/database/schema-provider';
import type { PluginMigrationDefinition } from '@plugin/backend/pluginMigration';
import type { AgentDefinition } from '../agent-registry/types';
import type { PluginAgentDefinitionContribution } from './types';

export interface BackendPluginLifecyclePlan {
  readonly pluginId: PluginId;
  readonly targetVersion: string;
  readonly compatMin?: string;
  readonly ownedTables: readonly string[];
  readonly migrations: readonly PluginMigrationDefinition[];
}

export interface BackendPluginSandboxProfileRegistration {
  readonly pluginId: PluginId;
  readonly profile: BackendPluginSandboxProfile;
}

export interface BackendPluginHiddenWorkerRegistration {
  readonly pluginId: PluginId;
  readonly worker: BackendPluginHiddenWorker;
}

export interface BackendPluginRuntimeEffectRegistration {
  readonly pluginId: PluginId;
  readonly effect: BackendPluginRuntimeEffect;
}

export interface BackendPluginSkillResourceRootRegistration {
  readonly pluginId: PluginId;
  readonly root: string;
}

export interface BackendPluginAgentDefinitionRegistration {
  readonly pluginId: PluginId;
  readonly definitions: readonly AgentDefinition[];
}

export interface BackendPluginAgentFenceRegistration {
  readonly pluginId: PluginId;
  readonly descriptor: BackendPluginAgentFenceDescriptor;
}

export interface BackendPluginCliRegistration {
  readonly pluginId: PluginId;
  readonly cli: BackendPluginCliContribution;
}

export interface BackendPluginRegistrationTrust {
  /** 只能由验证过 artifact 来源的 Host 组合根设置，插件 contribution 不能自行声明。 */
  readonly allowPluginCli: boolean;
}

export interface BackendPluginIpcRegistration {
  readonly pluginId: PluginId;
  readonly channels: readonly string[];
  readonly source: 'contribution' | 'legacy';
  register(serviceManager: unknown, registrar: BackendPluginIpcHandlerRegistrar): void;
}

export function toHostAgentDefinition(
  pluginId: PluginId,
  definition: PluginAgentDefinitionContribution,
): AgentDefinition {
  if (pluginId === 'platform') {
    return definition;
  }

  const hostDefinition: AgentDefinition = {
    id: definition.id,
    promptKey: definition.promptKey,
    defaultMode: definition.defaultMode,
    description: definition.description,
    config: definition.config,
    task: definition.task === undefined
      ? undefined
      : {
        systemPromptBuilder: definition.task.systemPromptBuilder,
        responseProcessor: definition.task.responseProcessor,
        streamChunkProcessor: definition.task.streamChunkProcessor,
      },
  };

  return hostDefinition;
}

class BackendPluginRegistry {
  private readonly contributions = new Map<PluginId, PluginBackendContribution>();
  private revision = 0;

  clear(): void {
    for (const contribution of this.contributions.values()) {
      for (const hook of contribution.documentTypeHooks ?? []) {
        unregisterDocumentTypeBackendHook(hook.docType, hook);
      }
    }
    this.contributions.clear();
    this.revision += 1;
  }

  register(
    contribution: PluginBackendContribution,
    trust: BackendPluginRegistrationTrust = { allowPluginCli: false },
  ): void {
    const id = contribution.meta.id;
    if (this.contributions.has(id)) {
      pluginDiagnostics.record({
        level: 'error',
        pluginId: id,
        capability: null,
        message: '插件重复注册',
      });
      throw new Error(`[plugin-registry] 插件重复注册: ${id}`);
    }
    if (contribution.pluginCli && !trust.allowPluginCli) {
      const message = 'Plugin CLI bridge 只允许来自 Host 可信装配源的插件贡献';
      pluginDiagnostics.record({
        level: 'error',
        pluginId: id,
        capability: 'pluginCli',
        message,
      });
      throw new Error(`[plugin-registry] ${message}: ${id}`);
    }
    const registeredHooks: DocumentTypeBackendHook[] = [];
    for (const hook of contribution.documentTypeHooks ?? []) {
      try {
        registerDocumentTypeBackendHook(hook);
        registeredHooks.push(hook);
      } catch (error) {
        for (const registeredHook of registeredHooks.reverse()) {
          unregisterDocumentTypeBackendHook(registeredHook.docType, registeredHook);
        }
        pluginDiagnostics.record({
          level: 'error',
          pluginId: id,
          capability: 'documentTypeHook',
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    this.contributions.set(id, contribution);
    this.revision += 1;
  }

  getRevision(): number {
    return this.revision;
  }

  has(pluginId: PluginId): boolean {
    return this.contributions.has(pluginId);
  }

  listMeta() {
    return Array.from(this.contributions.values()).map((contribution) => contribution.meta);
  }

  private effective(enabledIds: ReadonlySet<PluginId> | null): PluginBackendContribution[] {
    const all = Array.from(this.contributions.values());
    const enabled = enabledIds ?? new Set(all.map((contribution) => contribution.meta.id));
    const missing = new Set<PluginId>();
    const disabledDeps = new Set<PluginId>();

    for (const contribution of all) {
      if (!enabled.has(contribution.meta.id)) continue;
      for (const dependencyId of contribution.meta.dependsOn ?? []) {
        if (!this.contributions.has(dependencyId)) {
          missing.add(dependencyId);
        } else if (!enabled.has(dependencyId)) {
          disabledDeps.add(dependencyId);
        }
      }
    }

    if (missing.size > 0 || disabledDeps.size > 0) {
      const message = `插件依赖未满足 missing=[${Array.from(missing).join(',')}] disabled=[${Array.from(disabledDeps).join(',')}]`;
      pluginDiagnostics.record({ level: 'error', pluginId: null, capability: null, message });
      throw new Error(`[plugin-registry] ${message}`);
    }

    return all.filter((contribution) => enabled.has(contribution.meta.id));
  }

  getToolClasses(enabledIds: ReadonlySet<PluginId> | null): ToolClassCtor[] {
    return this.effective(enabledIds).flatMap((contribution) => contribution.toolClasses ?? []);
  }

  getPluginCliRegistrations(
    enabledIds: ReadonlySet<PluginId> | null,
  ): BackendPluginCliRegistration[] {
    return this.effective(enabledIds).flatMap((contribution) => (
      contribution.pluginCli
        ? [{ pluginId: contribution.meta.id, cli: contribution.pluginCli }]
        : []
    ));
  }

  getToolContextDecorators(enabledIds: ReadonlySet<PluginId> | null): BackendPluginToolContextDecorator[] {
    return this.effective(enabledIds).flatMap((contribution) => contribution.toolContextDecorators ?? []);
  }

  getToolContextBindingMigrators(enabledIds: ReadonlySet<PluginId> | null): BackendPluginToolContextBindingMigrator[] {
    return this.effective(enabledIds).flatMap((contribution) => [
      ...(contribution.toolContextBindingMigrators ?? []),
      // 中文说明：旧磁盘插件可能仍把派生迁移动作挂在 decorator.copyBinding 上；
      // 官方插件禁止继续使用这条兼容路径，新插件应声明 toolContextBindingMigrators。
      ...(contribution.toolContextDecorators ?? [])
        .filter((decorator) => typeof decorator.copyBinding === 'function')
        .map((decorator) => ({
          migrate: (
            source: Parameters<BackendPluginToolContextBindingMigrator['migrate']>[0],
            target: Parameters<BackendPluginToolContextBindingMigrator['migrate']>[1],
          ) => decorator.copyBinding?.(source, target),
        })),
    ]);
  }

  getIpcRegistrations(enabledIds: ReadonlySet<PluginId> | null): BackendPluginIpcRegistration[] {
    return this.effective(enabledIds).flatMap((contribution) => (
      this.normalizeIpcRegistrations(contribution)
    ));
  }

  getIpcChannelsForPlugin(pluginId: PluginId, enabledIds: ReadonlySet<PluginId> | null): string[] {
    const contribution = this.effective(enabledIds).find((item) => item.meta.id === pluginId);
    if (!contribution) {
      throw new Error(`[plugin-registry] 插件未安装或未启用: ${pluginId}`);
    }
    return this.normalizeIpcRegistrations(contribution).flatMap((registration) => [...registration.channels]);
  }

  getRendererPushChannelsForPlugin(pluginId: PluginId, enabledIds: ReadonlySet<PluginId> | null): string[] {
    const contribution = this.effective(enabledIds).find((item) => item.meta.id === pluginId);
    if (!contribution) {
      throw new Error(`[plugin-registry] 插件未安装或未启用: ${pluginId}`);
    }
    return [...(contribution.rendererPush?.channels ?? [])];
  }

  getSchemaProviders(enabledIds: ReadonlySet<PluginId> | null): ISchemaProvider[] {
    return this.effective(enabledIds).flatMap((contribution) => contribution.schemaProviders ?? []);
  }

  getSandboxProfileRegistrations(
    enabledIds: ReadonlySet<PluginId> | null,
  ): BackendPluginSandboxProfileRegistration[] {
    return this.effective(enabledIds).flatMap((contribution) =>
      (contribution.sandboxProfiles ?? []).map((profile) => ({
        pluginId: contribution.meta.id,
        profile,
      }))
    );
  }

  getHiddenWorkerRegistrations(enabledIds: ReadonlySet<PluginId> | null): BackendPluginHiddenWorkerRegistration[] {
    return this.effective(enabledIds).flatMap((contribution) =>
      (contribution.hiddenWorkers ?? []).map((worker) => ({
        pluginId: contribution.meta.id,
        worker,
      }))
    );
  }

  getRuntimeEffectRegistrations(enabledIds: ReadonlySet<PluginId> | null): BackendPluginRuntimeEffectRegistration[] {
    return this.effective(enabledIds).flatMap((contribution) =>
      (contribution.runtimeEffects ?? []).map((effect) => ({
        pluginId: contribution.meta.id,
        effect,
      }))
    );
  }

  getSkillResourceRootRegistrations(
    enabledIds: ReadonlySet<PluginId> | null,
  ): BackendPluginSkillResourceRootRegistration[] {
    return this.effective(enabledIds).flatMap((contribution) =>
      (contribution.skillResourceRoots ?? []).map((root) => ({
        pluginId: contribution.meta.id,
        root,
      }))
    );
  }

  getLifecyclePlans(enabledIds: ReadonlySet<PluginId> | null): BackendPluginLifecyclePlan[] {
    return this.effective(enabledIds)
      .map((contribution) => ({
        pluginId: contribution.meta.id,
        targetVersion: contribution.meta.version,
        compatMin: contribution.meta.compatMin,
        ownedTables: contribution.ownedTables ?? [],
        migrations: contribution.pluginMigrations ?? [],
      }));
  }

  getAgentDefinitions(enabledIds: ReadonlySet<PluginId> | null): AgentDefinition[] {
    // 中文说明：promptKey 是 agent 的运行期路由键（childRunHarness 等用 promptKey→definition 的 Map 解析），
    // host 类型层面 PromptKey 只是 string，不做白名单约束，因此必须在聚合处守住全局唯一性，
    // 否则两个插件（或插件与内置）撞同名 promptKey 会被后者静默覆盖、错乱难查。
    // 校验模式与 getSubagentTypes 的 type 冲突检测保持一致（运行期 fail-fast）。
    const ownerByPromptKey = new Map<string, PluginId>();
    const definitions: AgentDefinition[] = [];
    for (const contribution of this.effective(enabledIds)) {
      for (const definition of contribution.agentDefinitions ?? []) {
        const hostDefinition = toHostAgentDefinition(contribution.meta.id, definition);
        const existingOwner = ownerByPromptKey.get(hostDefinition.promptKey);
        if (existingOwner !== undefined) {
          pluginDiagnostics.record({
            level: 'error',
            pluginId: contribution.meta.id,
            capability: 'agent',
            message: `agent promptKey 冲突: ${hostDefinition.promptKey}（已由 ${existingOwner} 注册）`,
          });
          throw new Error(`[plugin-registry] agent promptKey 冲突: ${hostDefinition.promptKey}`);
        }
        ownerByPromptKey.set(hostDefinition.promptKey, contribution.meta.id);
        definitions.push(hostDefinition);
      }
    }
    return definitions;
  }

  getAgentFenceRegistrations(enabledIds: ReadonlySet<PluginId> | null): BackendPluginAgentFenceRegistration[] {
    return this.effective(enabledIds).flatMap((contribution) =>
      (contribution.agentFences ?? []).map((descriptor) => ({
        pluginId: contribution.meta.id,
        descriptor,
      }))
    );
  }

  getAgentDefinitionRegistrations(
    enabledIds: ReadonlySet<PluginId> | null,
  ): BackendPluginAgentDefinitionRegistration[] {
    return this.effective(enabledIds)
      .filter((contribution) => (contribution.agentDefinitions ?? []).length > 0)
      .map((contribution) => ({
        pluginId: contribution.meta.id,
        definitions: (contribution.agentDefinitions ?? [])
          .map((definition) => toHostAgentDefinition(contribution.meta.id, definition)),
      }));
  }

  getSubagentTypes(enabledIds: ReadonlySet<PluginId> | null): SubagentTypeContribution[] {
    const byType = new Map<string, SubagentTypeContribution>();
    for (const contribution of this.effective(enabledIds)) {
      for (const subagentType of contribution.subagentTypes ?? []) {
        if (byType.has(subagentType.type)) {
          pluginDiagnostics.record({
            level: 'error',
            pluginId: contribution.meta.id,
            capability: 'subagentType',
            message: `subagent_type 冲突: ${subagentType.type}`,
          });
          throw new Error(`[plugin-registry] subagent_type 冲突: ${subagentType.type}`);
        }
        byType.set(subagentType.type, subagentType);
      }
    }
    return Array.from(byType.values());
  }

  private normalizeIpcRegistrations(contribution: PluginBackendContribution): BackendPluginIpcRegistration[] {
    const modern = contribution.ipc ? [this.fromIpcContribution(contribution.meta.id, contribution.ipc)] : [];
    const legacyRegistrars = contribution.ipcRegistrars ?? [];
    const legacyChannels = contribution.ipcChannels ?? [];
    const legacy = legacyRegistrars.length > 0
      ? legacyRegistrars.map((registrar) => ({
        pluginId: contribution.meta.id,
        channels: legacyChannels,
        source: 'legacy' as const,
        register: (serviceManager: unknown, _handlerRegistrar: BackendPluginIpcHandlerRegistrar) => {
          registrar(serviceManager);
        },
      }))
      : legacyChannels.length > 0
        ? [{
          pluginId: contribution.meta.id,
          channels: legacyChannels,
          source: 'legacy' as const,
          register: () => {},
        }]
        : [];
    return [
      ...modern,
      ...legacy,
    ];
  }

  private fromIpcContribution(
    pluginId: PluginId,
    contribution: BackendPluginIpcContribution,
  ): BackendPluginIpcRegistration {
    return {
      pluginId,
      channels: contribution.channels,
      source: 'contribution',
      register: contribution.register,
    };
  }

}

export const backendPluginRegistry = new BackendPluginRegistry();
