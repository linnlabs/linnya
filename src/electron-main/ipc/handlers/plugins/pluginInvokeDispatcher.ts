import type { PluginRuntimeState } from '../../../../app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { Logger } from '../../../../shared/logger';

const logger = new Logger('PluginInvokeDispatcher');
const PLUGIN_INVOKE_TRACE_ID_FIELD = '__plugin_trace_id';

export type PluginInvokeDiagnosticCode =
  | 'validation'
  | 'missing'
  | 'disabled'
  | 'permission_denied'
  | 'missing_handler'
  | 'crash';

export interface PluginInvokeDiagnostic {
  readonly code: PluginInvokeDiagnosticCode;
  readonly pluginId?: string;
  readonly channel?: string;
  readonly message: string;
}

export type PluginInvokeDispatchResult =
  | {
      readonly success: false;
      readonly error: string;
      readonly diagnostic: PluginInvokeDiagnostic;
    }
  | unknown;

export interface PluginInvokeDispatchDependencies {
  readonly getRuntimeState: (pluginId: string) => PluginRuntimeState;
  readonly listAllowedChannels: (pluginId: string) => readonly string[];
  readonly invokeHandler: (
    pluginId: string,
    channel: string,
    event: unknown,
    payload: unknown,
  ) => Promise<unknown> | unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parsePluginInvokeRequest(value: unknown): {
  pluginId: string;
  channel: string;
  payload: unknown;
} {
  if (!isRecord(value)) {
    throw new Error('[plugin:invoke] 请求必须是对象');
  }
  const pluginId = typeof value.pluginId === 'string' ? value.pluginId.trim() : '';
  const channel = typeof value.channel === 'string' ? value.channel.trim() : '';
  if (!pluginId || !channel) {
    throw new Error('[plugin:invoke] pluginId/channel 不能为空');
  }
  return {
    pluginId,
    channel,
    payload: value.payload,
  };
}

function buildPluginInvokeFailure(params: {
  readonly diagnostic: PluginInvokeDiagnostic;
}): {
  readonly success: false;
  readonly error: string;
  readonly diagnostic: PluginInvokeDiagnostic;
} {
  return {
    success: false,
    error: params.diagnostic.message,
    diagnostic: params.diagnostic,
  };
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classifyPluginInvokeError(params: {
  readonly error: unknown;
  readonly pluginId?: string;
  readonly channel?: string;
}): PluginInvokeDiagnostic {
  const message = readErrorMessage(params.error);
  if (!params.pluginId || !params.channel || message.includes('pluginId/channel 不能为空') || message.includes('请求必须是对象')) {
    return {
      code: 'validation',
      pluginId: params.pluginId,
      channel: params.channel,
      message,
    };
  }
  if (message.includes('未注册插件 IPC handler')) {
    return {
      code: 'missing_handler',
      pluginId: params.pluginId,
      channel: params.channel,
      message,
    };
  }
  return {
    code: 'crash',
    pluginId: params.pluginId,
    channel: params.channel,
    message,
  };
}

export async function dispatchPluginInvoke(
  event: unknown,
  request: unknown,
  dependencies: PluginInvokeDispatchDependencies,
): Promise<PluginInvokeDispatchResult> {
  let parsedRequest: { pluginId: string; channel: string; payload: unknown } | null = null;
  try {
    parsedRequest = parsePluginInvokeRequest(request);
    const { pluginId, channel, payload } = parsedRequest;
    const startedAt = Date.now();
    const traceId = readPluginInvokeTraceId(payload);
    if (traceId) {
      logger.info('[plugin:invoke] dispatch start', {
        traceId,
        pluginId,
        channel,
        payload: summarizePluginInvokePayload(payload),
      });
    }
    const runtimeState = dependencies.getRuntimeState(pluginId);
    if (runtimeState !== 'enabled') {
      if (traceId) {
        logger.warn('[plugin:invoke] dispatch blocked by runtime state', {
          traceId,
          pluginId,
          channel,
          runtimeState,
        });
      }
      return buildPluginInvokeFailure({
        diagnostic: {
          code: runtimeState,
          pluginId,
          channel,
          message: `[plugin-registry] 插件${runtimeState === 'missing' ? '未安装' : '未启用'}: ${pluginId}`,
        },
      });
    }
    const allowedChannels = new Set(dependencies.listAllowedChannels(pluginId));
    if (!allowedChannels.has(channel)) {
      if (traceId) {
        logger.warn('[plugin:invoke] dispatch blocked by channel allowlist', {
          traceId,
          pluginId,
          channel,
          allowedChannels: Array.from(allowedChannels),
        });
      }
      return buildPluginInvokeFailure({
        diagnostic: {
          code: 'permission_denied',
          pluginId,
          channel,
          message: `[plugin:invoke] 插件未声明 IPC channel: ${pluginId}/${channel}`,
        },
      });
    }
    const result = await dependencies.invokeHandler(pluginId, channel, event, payload);
    if (traceId) {
      logger.info('[plugin:invoke] dispatch completed', {
        traceId,
        pluginId,
        channel,
        durationMs: Date.now() - startedAt,
        result: summarizePluginInvokeResult(result),
      });
    }
    return result;
  } catch (error) {
    logger.error('[plugin:invoke] failed:', error);
    return buildPluginInvokeFailure({
      diagnostic: classifyPluginInvokeError({
        error,
        pluginId: parsedRequest?.pluginId,
        channel: parsedRequest?.channel,
      }),
    });
  }
}

function readPluginInvokeTraceId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const traceId = payload[PLUGIN_INVOKE_TRACE_ID_FIELD];
  return typeof traceId === 'string' ? traceId : undefined;
}

function summarizePluginInvokePayload(payload: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(payload)) return { type: typeof payload };
  return {
    payloadKeys: Object.keys(payload).filter(key => key !== PLUGIN_INVOKE_TRACE_ID_FIELD).sort(),
    documentId: stringValue(payload.documentId),
    nodeId: stringValue(payload.nodeId),
    company: stringValue(payload.company),
    query: stringValue(payload.query),
    direction: stringValue(payload.direction),
    depth: numberValue(payload.depth),
    refresh: booleanValue(payload.refresh),
  };
}

function summarizePluginInvokeResult(result: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(result)) return { type: typeof result };
  return {
    success: booleanValue(result.success),
    error: stringValue(result.error),
    diagnostic_code: isRecord(result.diagnostic) ? stringValue(result.diagnostic.code) : undefined,
    data: summarizePluginInvokeData(result.data),
  };
}

function summarizePluginInvokeData(data: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(data)) return undefined;
  return {
    dataKeys: Object.keys(data).sort(),
    kind: stringValue(data.kind),
    documentId: stringValue(data.documentId),
    run_id: stringValue(data.run_id),
    entity_id: stringValue(data.entity_id),
    targets: numberValue(data.targets),
    documents: numberValue(data.documents),
    applied_edges: numberValue(data.applied_edges),
    unknowns: numberValue(data.unknowns),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
