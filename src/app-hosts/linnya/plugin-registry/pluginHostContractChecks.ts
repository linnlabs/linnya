/**
 * @file pluginHostContractChecks.ts
 * @description 插件契约包与 host 真实类型之间的编译期锁。
 *
 * 中文说明：
 * - 这里没有运行时代码路径，只用类型关系把 host 实现钉在
 *   `@linnya/plugin-host-contract` 的插件视角窄契约上；
 * - 目的不是扩大插件可见面，而是防止 host 内部类型改动后 SDK facade
 *   继续“看起来能编译”，实际已经和契约漂移；
 * - 真正运行时 port 化仍归 U7/U8，本文件只负责 Stage 3 的双向锁。
 */

import type { BackendHiddenWorkerRuntimePort } from '../desktop-capabilities';
import type { WorkspaceService } from '../../../electron-main/services/workspace/workspace';
import type { SandboxJsonValue as HostSandboxJsonValue, SandboxProfile as HostSandboxProfile } from '../../../features/sandbox/types';
import type { VersionRetentionPolicy } from '../../../shared/database/versionRetention';
import type { ISchemaProvider } from '../../../shared/database/schema-provider';
import type { Logger } from '../../../shared/logger';
import type { ToolContext } from '../../../tools/types';
import type {
  HiddenWorkerDefinition as PluginHiddenWorkerDefinition,
} from '@linnya/plugin-host-contract/backend/hiddenWorkerRuntime';
import type {
  SandboxJsonValue as PluginSandboxJsonValue,
  SandboxProfile as PluginSandboxProfile,
} from '@linnya/plugin-host-contract/backend/sandboxRuntime';
import type {
  PluginToolContext,
} from '@linnya/plugin-host-contract/backend/toolRuntime';
import type {
  PluginLoggerConstructor,
  PluginLoggerPort,
  PluginSchemaProvider,
  PluginVersionRetentionPolicy,
  PluginWorkspaceServicePort,
} from '@linnya/plugin-host-contract/backend/workspaceRuntime';

type AssertTrue<T extends true> = T;

type HostHiddenWorkerDefinition = Parameters<
  BackendHiddenWorkerRuntimePort['registerHiddenWorker']
>[0];

type HostToolContextMatchesPluginContract = AssertTrue<ToolContext extends PluginToolContext ? true : false>;
type HostWorkspaceServiceMatchesPluginPort = AssertTrue<WorkspaceService extends PluginWorkspaceServicePort ? true : false>;
type HostLoggerMatchesPluginPort = AssertTrue<Logger extends PluginLoggerPort ? true : false>;
type HostLoggerConstructorMatchesPluginContract = AssertTrue<typeof Logger extends PluginLoggerConstructor ? true : false>;
type HostSchemaProviderMatchesPluginContract = AssertTrue<ISchemaProvider extends PluginSchemaProvider ? true : false>;
type HostVersionRetentionPolicyMatchesPluginContract = AssertTrue<
  VersionRetentionPolicy extends PluginVersionRetentionPolicy ? true : false
>;

// 中文说明：插件注册表会把 contribution 里的 profile 交给 host sandbox runtime。
// 因此 contract 版本必须能被 host runtime 消费，不能只在插件侧自洽。
type PluginSandboxProfileAcceptedByHost = AssertTrue<
  PluginSandboxProfile<PluginSandboxJsonValue | undefined> extends HostSandboxProfile<HostSandboxJsonValue | undefined>
    ? true
    : false
>;
type HostSandboxProfileAcceptedByPluginContract = AssertTrue<
  HostSandboxProfile<HostSandboxJsonValue | undefined> extends PluginSandboxProfile<PluginSandboxJsonValue | undefined>
    ? true
    : false
>;

type PluginHiddenWorkerAcceptedByHost = AssertTrue<
  PluginHiddenWorkerDefinition extends HostHiddenWorkerDefinition ? true : false
>;
type HostHiddenWorkerAcceptedByPluginContract = AssertTrue<
  HostHiddenWorkerDefinition extends PluginHiddenWorkerDefinition ? true : false
>;

export type PluginHostContractChecks =
  & HostToolContextMatchesPluginContract
  & HostWorkspaceServiceMatchesPluginPort
  & HostLoggerMatchesPluginPort
  & HostLoggerConstructorMatchesPluginContract
  & HostSchemaProviderMatchesPluginContract
  & HostVersionRetentionPolicyMatchesPluginContract
  & PluginSandboxProfileAcceptedByHost
  & HostSandboxProfileAcceptedByPluginContract
  & PluginHiddenWorkerAcceptedByHost
  & HostHiddenWorkerAcceptedByPluginContract;
