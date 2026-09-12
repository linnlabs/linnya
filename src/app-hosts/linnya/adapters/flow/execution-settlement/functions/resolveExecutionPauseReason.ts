import { ENGINE_ERROR_CODES, graph } from '@linnlabs/linnkit/runtime-kernel';

const publicErrorCodes: ReadonlySet<string> = new Set(Object.values(ENGINE_ERROR_CODES));

/** 暂停原因是持久控制事实；仅接纳 ENGINE_ERROR_CODES，不把上游错误正文写进 CLI 状态。 */
export function resolveExecutionPauseReason(input: {
  readonly signal: AbortSignal;
  readonly error: unknown;
  readonly failureFact?: graph.RuntimeFailureFact;
}): string {
  if (graph.isRunPauseSignal(input.signal)) return 'user_pause';
  const error = input.error;
  if (typeof error === 'object' && error !== null && 'code' in error
    && error.code === 'RUN_RECOVERY_BLOCKED') return 'tool_reconciliation_required';

  // 已发布的终因由 Runtime owner 分类，优先于抛出对象；熔断尚无 run-level fact 时读 typed code。
  const code = input.failureFact?.error_code ?? (
    typeof error === 'object' && error !== null && 'errorCode' in error ? error.errorCode : undefined
  );
  // 未分类异常仍需运维调查；不解析 message，也不把未知 Provider 字符串当安全分类。
  return typeof code === 'string' && code !== ENGINE_ERROR_CODES.ENGINE_UNKNOWN
    && publicErrorCodes.has(code) ? code : 'execution_interrupted';
}
