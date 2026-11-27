import type { BackendPluginCliContribution } from '@linnya/plugin-host-contract/backend';

import { acquireBackendPluginCliInvocation } from '../../../plugin-registry/pluginCliInvocationRuntime';
import {
  PluginCliOutputLimitExceededError,
  parsePluginCliExecutionResult,
  type PluginCliExecutionResult,
} from '../definitions/pluginCliBridgeProtocol';
import {
  PluginCliBridgeFailure,
  PluginCliInvocationUnexpectedError,
  type PluginCliInvocationDependencies,
  type PluginCliInvocationScope,
  type PluginCliInvocationTarget,
} from '../definitions/pluginCliInvocation';
import type {
  PluginCliBridgeUnexpectedFailureStage,
  PluginCliConversationInputSession,
} from '../definitions/pluginCliShellBridgeRuntime';
import { parsePluginCliAccessPlan } from '../functions/parsePluginCliAccessPlan';

interface CombinedSignal {
  readonly signal: AbortSignal;
  dispose(): void;
}

function combineAbortSignals(signals: readonly AbortSignal[]): CombinedSignal {
  const controller = new AbortController();
  const listeners: Array<{ readonly signal: AbortSignal; readonly listener: () => void }> = [];
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const listener = (): void => controller.abort(signal.reason);
    signal.addEventListener('abort', listener, { once: true });
    listeners.push({ signal, listener });
  }
  return {
    signal: controller.signal,
    dispose() {
      for (const { signal, listener } of listeners) {
        signal.removeEventListener('abort', listener);
      }
    },
  };
}

/**
 * 插件命令的唯一执行规则：解析插件 → prepare 只拿 argv → 按访问申报和调用方权限放行 →
 * execute。Shell 桥与 plugin_cli 工具都调用这里，权限判断不能在入口各写一份。
 *
 * 宿主不解析插件参数；能否访问内部数据、写对话文件、调用模型，只看插件申报与调用方的
 * 冻结权限，拒绝发生在打开数据库或 worker 之前。
 */
export async function invokePluginCliContribution(input: {
  readonly target: PluginCliInvocationTarget;
  readonly argv: readonly string[];
  readonly scope: PluginCliInvocationScope;
  readonly dependencies: PluginCliInvocationDependencies;
}): Promise<PluginCliExecutionResult> {
  const { scope, dependencies } = input;
  const invocationId = `${scope.invocationIdPrefix}_cli_${dependencies.createInvocationId()}`;
  const pluginId = input.target.kind === 'plugin' ? input.target.pluginId : undefined;
  let stage: PluginCliBridgeUnexpectedFailureStage = 'resolve_plugin';
  let pluginLease: ReturnType<typeof acquireBackendPluginCliInvocation>;
  let signals: CombinedSignal | undefined;
  let fileInput: PluginCliConversationInputSession | undefined;
  let inferenceSession: ReturnType<NonNullable<PluginCliInvocationDependencies['createInferenceSession']>> | undefined;
  try {
    let cli: BackendPluginCliContribution;
    if (input.target.kind === 'core') {
      if (!dependencies.coreCli) throw new PluginCliBridgeFailure('runtime_failure', 69, 'Core CLI is unavailable.');
      cli = dependencies.coreCli;
      signals = combineAbortSignals(scope.signals);
    } else {
      const registration = dependencies.resolveCli(input.target.pluginId);
      if (!registration) throw new PluginCliBridgeFailure('plugin_unavailable', 69, 'Plugin CLI is unavailable.');
      stage = 'acquire_plugin';
      pluginLease = acquireBackendPluginCliInvocation(registration);
      if (!pluginLease) throw new PluginCliBridgeFailure('plugin_unavailable', 69, 'Plugin CLI is not accepting work.');
      cli = registration.cli;
      signals = combineAbortSignals([...scope.signals, pluginLease.signal]);
    }
    signals.signal.throwIfAborted();
    stage = 'prepare';
    const preparation = cli.prepare({
      argv: [...input.argv],
      invocationId,
      conversationRoot: scope.conversationRoot,
    });
    if (preparation.status === 'completed') {
      stage = 'project_result';
      return parsePluginCliExecutionResult(preparation.result);
    }
    stage = 'validate_access';
    const access = parsePluginCliAccessPlan(preparation.plan.access);
    const needsInternalData = access.internalDataAccess !== 'none';
    if (access.hostInference?.length) {
      if (scope.hostInference.status === 'unavailable') {
        throw new PluginCliBridgeFailure('permission_denied', 77, scope.hostInference.reason);
      }
      if (access.internalDataAccess !== 'write') {
        throw new PluginCliBridgeFailure('permission_denied', 77, 'Host inference requires explicit internal write access.');
      }
    }
    if (needsInternalData && scope.permission.internalDataAccess !== 'allowed') {
      throw new PluginCliBridgeFailure(
        'permission_denied',
        77,
        `Internal Linnya data access is disabled for ${scope.permissionSubject}.`,
      );
    }
    if (
      (access.conversationFiles === 'write' || access.internalDataAccess === 'write')
      && scope.permission.effectiveLevel === 'read_only'
    ) {
      throw new PluginCliBridgeFailure(
        'permission_denied',
        77,
        `This plugin CLI command requires write access, but ${scope.permissionSubject} is read-only.`,
      );
    }
    signals.signal.throwIfAborted();
    stage = 'execute';
    if (access.hostInference?.length) {
      if (!dependencies.createInferenceSession) throw new PluginCliBridgeFailure('runtime_failure', 69, 'Host inference is unavailable.');
      inferenceSession = dependencies.createInferenceSession({ operations: access.hostInference, signal: signals.signal });
    }
    const projectId = needsInternalData
      ? await dependencies.readConversationProjectId?.(scope.conversationId)
      : undefined;
    signals.signal.throwIfAborted();
    if (access.conversationFiles !== 'none') {
      fileInput = dependencies.createConversationInput?.({ conversationId: scope.conversationId, signal: signals.signal });
    }
    const modelPurposeSnapshot = scope.hostInference.status === 'available'
      ? scope.hostInference.modelPurposeSnapshot
      : undefined;
    const result = await preparation.plan.execute({
      conversationId: scope.conversationId,
      agentRunId: scope.agentRunId,
      ...(projectId ? { projectId } : {}),
      ...(inferenceSession ? {
        inference: inferenceSession.inference,
        ...(modelPurposeSnapshot ? { modelPurposeSnapshot } : {}),
      } : {}),
      hostContext: needsInternalData
        ? dependencies.internalDataContext
        : Object.freeze({}),
      signal: signals.signal,
      ...(fileInput ? { stageConversationFile: fileInput.stage } : {}),
    });
    signals.signal.throwIfAborted();
    stage = 'project_result';
    return parsePluginCliExecutionResult(result);
  } catch (error: unknown) {
    if (signals?.signal.aborted) {
      throw new PluginCliBridgeFailure('cancelled', 130, 'Plugin CLI invocation was cancelled.');
    }
    if (error instanceof PluginCliOutputLimitExceededError) {
      throw new PluginCliBridgeFailure(
        'output_limit_exceeded',
        74,
        'Plugin CLI output exceeds the bridge byte limit.',
      );
    }
    if (error instanceof PluginCliBridgeFailure) throw error;
    throw new PluginCliInvocationUnexpectedError(stage, invocationId, pluginId, error);
  } finally {
    try {
      await inferenceSession?.close();
      await fileInput?.close();
    }
    finally {
      signals?.dispose();
      pluginLease?.release();
    }
  }
}
