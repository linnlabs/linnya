import type {
  CanvasTraceContext,
  CanvasTraceInvocation,
  CanvasTraceAttempt,
} from '../definitions/canvasToolTrace';
import { traceDiagnostic } from './traceDiagnostics';
const validationErrors = new Set([
  'invalid_operations',
  'invalid_arguments',
  'invalid_path',
  'invalid_content',
  'wrong_element_type',
  'element_missing',
]);
export function acceptsCanvasTraceError(code: string): boolean | null {
  return validationErrors.has(code) ? false : null;
}
function correction(context: CanvasTraceContext, command: CanvasTraceInvocation): boolean | null {
  const prior = [...context.facts.attempts, ...context.facts.dryRuns].sort(
    (a, b) => b.order - a.order
  );
  if (!prior.some(event => event.validationAccepted !== true)) return false;
  const related = prior.find(
    event =>
      (event.inputKey !== null && event.inputKey === command.inputKey) ||
      (event.requestId !== null && event.requestId === command.requestId)
  );
  if (related?.validationAccepted === true) return false;
  if (!related || !related.fingerprint || !command.fingerprint) return null;
  return related.fingerprint !== command.fingerprint;
}
export function recordTraceAttempt(input: {
  readonly context: CanvasTraceContext;
  readonly command: CanvasTraceInvocation;
  readonly outcome: CanvasTraceAttempt['outcome'];
  readonly accepted: boolean | null;
}): void {
  const { context, command, outcome, accepted } = input;
  if (command.kind !== 'apply' && command.kind !== 'arrange') return;
  const event = {
    requestId: command.requestId,
    kind: command.kind,
    outcome,
    validationAccepted: accepted,
    correction: correction(context, command),
    fingerprint: command.fingerprint,
    inputKey: command.inputKey,
    toolCallId: context.toolCallId,
    runId: context.runId,
    sourceFile: context.sourceFile,
    order: context.order,
  };
  if (accepted === null)
    traceDiagnostic(context, 'validation_unknown', '响应未证明请求是否已通过参数和语义校验');
  if (event.correction === null)
    traceDiagnostic(context, 'correction_unknown', '缺少可核对的原始载荷，不能推断是否为修正重提');
  if (command.dryRun) {
    context.facts.dryRuns.push(event);
    return;
  }
  if (event.requestId === null) {
    traceDiagnostic(context, 'request_identity_missing', '正式写请求没有可核对的request-id');
    return;
  }
  context.facts.attempts.push({ ...event, requestId: event.requestId });
}
