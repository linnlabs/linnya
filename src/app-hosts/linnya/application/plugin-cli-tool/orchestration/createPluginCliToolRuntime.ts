import { randomUUID } from 'node:crypto';

import type { ConversationWorkDirectoryAdmissionPort } from '../../conversation-lifecycle';
import {
  PluginCliBridgeFailure,
  PluginCliInvocationUnexpectedError,
  invokePluginCliContribution,
  type PluginCliInvocationDependencies,
} from '../../plugin-cli-shell-bridge';
import type {
  PluginCliToolDiagnosticPort,
  PluginCliToolInvocationRequest,
  PluginCliToolInvocationResult,
  PluginCliToolRuntimePort,
} from '../definitions/pluginCliToolRuntime';

/**
 * 外部命令行的 plugin_cli 入口。它和 Linnya Agent 在 Shell 里运行 `linnya-<plugin>`
 * 走同一份执行规则，只是身份与权限来自本次工具调用，而不是父 Shell execution。
 *
 * 插件在会话工作目录准入内执行：截图、导出文件写入期间，会话删除流程会等待它结束。
 */
export function createPluginCliToolRuntime(input: {
  readonly dependencies: Omit<PluginCliInvocationDependencies, 'createInvocationId' | 'coreCli'>;
  readonly conversationAdmission: ConversationWorkDirectoryAdmissionPort;
  readonly diagnostics: PluginCliToolDiagnosticPort;
  readonly createInvocationId?: () => string;
  readonly createCorrelationId?: () => string;
}): PluginCliToolRuntimePort {
  const createCorrelationId = input.createCorrelationId ?? randomUUID;
  const dependencies: PluginCliInvocationDependencies = Object.freeze({
    ...input.dependencies,
    createInvocationId: input.createInvocationId ?? randomUUID,
  });

  async function invoke(request: PluginCliToolInvocationRequest): Promise<PluginCliToolInvocationResult> {
    try {
      return await input.conversationAdmission.withAdmission(
        { conversationId: request.conversationId },
        async directory => {
          const result = await invokePluginCliContribution({
            target: { kind: 'plugin', pluginId: request.pluginId },
            argv: request.argv,
            scope: {
              conversationId: request.conversationId,
              agentRunId: request.agentRunId,
              conversationRoot: directory.absolutePath,
              invocationIdPrefix: request.toolCallId,
              permission: {
                internalDataAccess: request.permission.internal_data_access,
                effectiveLevel: request.permission.permission_level,
              },
              permissionSubject: 'this run',
              // 外部命令行的运行承诺不调用 Linnya 的模型；需要模型的插件命令只能由 Linnya Agent 在 Shell 里运行。
              hostInference: {
                status: 'unavailable',
                reason: 'This plugin CLI command uses Linnya models; plugin_cli runs without Linnya models.',
              },
              signals: request.signal ? [request.signal] : [],
            },
            dependencies,
          });
          return {
            status: 'completed' as const,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
          };
        },
      );
    } catch (error: unknown) {
      if (error instanceof PluginCliBridgeFailure) {
        return { status: 'rejected', code: error.code, exitCode: error.exitCode, message: error.message };
      }
      const correlationId = createCorrelationId();
      const unexpected = error instanceof PluginCliInvocationUnexpectedError ? error : undefined;
      input.diagnostics.recordUnexpectedFailure({
        correlationId,
        stage: unexpected?.stage ?? 'work_directory_admission',
        conversationId: request.conversationId,
        agentRunId: request.agentRunId,
        toolCallId: request.toolCallId,
        pluginId: request.pluginId,
        ...(unexpected?.invocationId ? { invocationId: unexpected.invocationId } : {}),
        error: unexpected ? unexpected.causeError : error,
      });
      return {
        status: 'rejected',
        code: 'runtime_failure',
        exitCode: 70,
        message: `Plugin CLI failed unexpectedly. Reference: ${correlationId}.`,
      };
    }
  }

  return Object.freeze({ invoke });
}
