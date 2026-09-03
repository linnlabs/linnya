import type { PluginMeta } from '@app/schemas';
import type {
  AgentDefinition,
  SubagentTypeContribution,
} from './agentRegistry';
import type {
  DocumentTypeBackendSystemViewSpec,
} from './documentTypeBackendHook';
import type {
  BackendPluginIpcHandler,
} from './pluginIpcRuntime';
import type {
  BaseTool,
} from './toolRuntime';
import type {
  PluginMigrationDefinition,
} from './pluginMigration';
import type {
  HiddenWorkerDefinition,
} from './hiddenWorkerRuntime';
import type { BackendPluginCliContribution } from './pluginCli';
import type {
  SandboxJsonValue,
  SandboxProfile,
} from './sandboxRuntime';

export type BackendPluginMeta = PluginMeta;

export type ToolClassCtor = new () => BaseTool;
export type BackendPluginIpcRegistrar = (tsServiceManager: unknown) => void;
export type BackendPluginIpcHandlerRegistrar = (
  pluginId: string,
  channel: string,
  handler: BackendPluginIpcHandler,
) => void;

export interface BackendPluginIpcContribution {
  readonly channels: readonly string[];
  register(tsServiceManager: unknown, registrar: BackendPluginIpcHandlerRegistrar): void;
}

export interface BackendPluginToolContextDecoratorParams {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
}

export interface BackendPluginToolContextDecorator {
  readonly toolNames: readonly string[];
  decorate(
    context: unknown,
    params: BackendPluginToolContextDecoratorParams,
  ): void | Promise<void>;
  /** @deprecated use `toolContextBindingMigrators` on PluginBackendContribution. */
  copyBinding?(
    source: unknown,
    target: unknown,
  ): void;
}

export interface BackendPluginToolContextBindingMigrator {
  /**
   * 派生 ToolContext 时迁移插件私有绑定。
   *
   * 中文说明：插件可以把运行时对象存在 WeakMap / 非枚举属性里，
   * 普通 `{ ...context }` 无法复制这些绑定。通用 host 工具必须通过平台
   * 派生入口调用这里，不能 import 某个插件自己的 copy helper。
   */
  migrate(
    source: unknown,
    target: unknown,
  ): void;
}

export interface BackendPluginRuntimeEffect {
  readonly id: string;
  activate(): void | Promise<void>;
  deactivate(): void | Promise<void>;
}

export type BackendPluginAgentFenceCategory =
  | 'current-view'
  | 'selection'
  | 'system-capability'
  | 'legacy';

export interface BackendPluginAgentFenceDescriptor {
  readonly kind: string;
  readonly category?: BackendPluginAgentFenceCategory;
  readonly llmRole: 'user' | 'system';
  readonly placement: 'after-system' | 'before-current-user' | 'after-current-user' | 'after-last-tool-result';
  readonly lifetime: 'turn-only' | 'persisted';
  readonly mustKeep?: boolean;
  readonly maxBudgetFraction?: number;
  readonly formatter: (content: string, attrs: Record<string, unknown>) => string;
}

export interface BackendPluginDocumentTypeHookSummary {
  readonly docType: string;
  readonly displayName?: string;
  readonly fileExtension?: string;
  readonly fileExtensions?: readonly string[];
  readonly systemView?: DocumentTypeBackendSystemViewSpec;
  readonly systemViews?: readonly DocumentTypeBackendSystemViewSpec[];
  readonly isEnabled?: () => boolean;
}

export interface BackendPluginSchemaProvider {
  readonly name: string;
  getSchema(): string[];
}

export interface BackendPluginIdentityContribution {
  readonly meta: BackendPluginMeta;
}

export interface BackendPluginToolContribution {
  readonly toolClasses?: readonly ToolClassCtor[];
  readonly toolContextDecorators?: readonly BackendPluginToolContextDecorator[];
  readonly toolContextBindingMigrators?: readonly BackendPluginToolContextBindingMigrator[];
}

export interface BackendPluginCliContributionPoint {
  /** 一个插件只贡献一个 opaque-argv 命令面；子命令和领域错误仍归插件 parser。 */
  readonly pluginCli?: BackendPluginCliContribution;
}

export interface BackendPluginAgentContribution {
  readonly agentDefinitions?: readonly AgentDefinition[];
  readonly subagentTypes?: readonly SubagentTypeContribution[];
  readonly agentFences?: readonly BackendPluginAgentFenceDescriptor[];
}

export interface BackendPluginSkillContribution {
  /**
   * 插件自带 Skill 资源根目录。每个目录下按 `<skill-name>/SKILL.md` 组织。
   *
   * 中文说明：这里仅声明“资源在哪里”，不承载启停规则；启停仍由 registry
   * 统一计算后同步给 Skill feature 的只读快照，避免 Skill 系统反向管理插件生命周期。
   */
  readonly skillResourceRoots?: readonly string[];
}

export interface BackendPluginDocumentContribution<THook extends BackendPluginDocumentTypeHookSummary = BackendPluginDocumentTypeHookSummary> {
  readonly documentTypeHooks?: readonly THook[];
}

export interface BackendPluginIpcGatewayContribution {
  /**
   * 插件业务 IPC 的单一声明入口。
   *
   * 中文说明：`channels` 是 plugin:invoke 的白名单，`register` 注册这些 channel
   * 的真实 handler。二者放在同一个 contribution 里，避免白名单和 registrar
   * 分裂漂移。旧 `ipcChannels` / `ipcRegistrars` 仅用于兼容历史 artifact。
   */
  readonly ipc?: BackendPluginIpcContribution;
}

export interface BackendPluginRendererPushContribution {
  /**
   * 插件主进程到 renderer 的推送事件声明。
   *
   * 中文说明：请求响应走 `ipc` + `plugin:invoke`；push 事件统一走
   * `plugin:push` envelope。插件必须先在这里声明 channel，后端 broadcaster
   * 才能发送，避免把插件专属事件重新塞回 preload 静态白名单。
   */
  readonly channels: readonly string[];
}

export interface BackendPluginRendererPushGatewayContribution {
  readonly rendererPush?: BackendPluginRendererPushContribution;
}

export interface BackendPluginLegacyIpcCompatibilityContribution {
  /** @deprecated use `ipc.channels` */
  readonly ipcChannels?: readonly string[];
  /** @deprecated use `ipc.register` */
  readonly ipcRegistrars?: readonly BackendPluginIpcRegistrar[];
}

export interface BackendPluginRuntimeEffectContribution {
  readonly runtimeEffects?: readonly BackendPluginRuntimeEffect[];
}

export type BackendPluginSandboxProfile = SandboxProfile<SandboxJsonValue | undefined>;

export type BackendPluginHiddenWorker = HiddenWorkerDefinition;

export interface BackendPluginRuntimeContribution extends BackendPluginRuntimeEffectContribution {
  readonly sandboxProfiles?: readonly BackendPluginSandboxProfile[];
  readonly hiddenWorkers?: readonly BackendPluginHiddenWorker[];
}

export interface BackendPluginDatabaseContribution {
  readonly schemaProviders?: readonly BackendPluginSchemaProvider[];
  readonly ownedTables?: readonly string[];
  readonly pluginMigrations?: readonly PluginMigrationDefinition[];
}

export type PluginBackendContributionBase<
  THook extends BackendPluginDocumentTypeHookSummary = BackendPluginDocumentTypeHookSummary,
> =
  & BackendPluginIdentityContribution
  & BackendPluginToolContribution
  & BackendPluginCliContributionPoint
  & BackendPluginAgentContribution
  & BackendPluginSkillContribution
  & BackendPluginDocumentContribution<THook>
  & BackendPluginIpcGatewayContribution
  & BackendPluginRendererPushGatewayContribution
  & BackendPluginLegacyIpcCompatibilityContribution
  & BackendPluginRuntimeContribution
  & BackendPluginDatabaseContribution;

export type PluginBackendContribution<
  THook extends BackendPluginDocumentTypeHookSummary = BackendPluginDocumentTypeHookSummary,
> = PluginBackendContributionBase<THook>;
