import { CanvasCommitResultSchema } from '@plugin/canvas/shared';
import type { CanvasTraceContext, CanvasTraceInvocation } from '../definitions/canvasToolTrace';
import type { CanvasTraceResponse } from './admitCanvasTraceResponse';
import { traceDiagnostic } from './traceDiagnostics';
import { acceptsCanvasTraceError, recordTraceAttempt } from './recordTraceAttempt';
type Response = CanvasTraceResponse;
function commandFor(
  context: CanvasTraceContext,
  commands: readonly CanvasTraceInvocation[],
  requestId?: string
) {
  const matches = commands.filter(
    command => requestId === undefined || command.requestId === requestId
  );
  if (matches.length === 1) return matches[0];
  traceDiagnostic(context, 'response_command_ambiguous', '响应不能唯一匹配本次实际Canvas命令');
  return null;
}
function recordCommitted(
  context: CanvasTraceContext,
  command: CanvasTraceInvocation,
  response: Extract<Response, { kind: 'committed' }>
) {
  const commit = CanvasCommitResultSchema.parse({
    documentId: context.facts.scope.documentId,
    requestId: response.value.requestId,
    sequence: response.value.sequence,
    refs: response.value.refs,
    results: response.value.results,
  });
  const previous = context.facts.commits.find(value => value.requestId === commit.requestId);
  if (previous && JSON.stringify(previous) === JSON.stringify(commit)) {
    context.facts.replays.push({
      requestId: commit.requestId,
      toolCallId: context.toolCallId,
      sourceFile: context.sourceFile,
    });
    return;
  }
  if (previous) {
    traceDiagnostic(context, 'receipt_changed', '同一请求编号出现不同正式回执');
    return;
  }
  context.facts.commits.push(commit);
  if (
    context.facts.attempts.some(
      event => event.requestId === commit.requestId && event.outcome === 'pending'
    )
  )
    return;
  recordTraceAttempt({ context, command, outcome: 'committed', accepted: true });
}
export function recordCanvasTraceResponse(
  context: CanvasTraceContext,
  commands: readonly CanvasTraceInvocation[],
  response: CanvasTraceResponse
): void {
  if (response.kind === 'unknown') {
    traceDiagnostic(context, 'output_unknown', 'Canvas输出不符合已支持的正式响应schema');
    return;
  }
  if (response.kind === 'check') {
    if (commands.some(command => command.kind === 'check'))
      context.facts.checks.push({
        report: response.value,
        toolCallId: context.toolCallId,
        sourceFile: context.sourceFile,
        order: context.order,
      });
    return;
  }
  if (response.kind === 'render') {
    if (!commands.some(command => command.kind === 'render')) {
      traceDiagnostic(context, 'render_command_missing', '图片输出没有实际render命令');
      return;
    }
    context.facts.renders.push({
      sequence: response.value.sequence,
      locator: response.value.locator,
      runId: context.runId,
      toolCallId: context.toolCallId,
      sourceFile: context.sourceFile,
      order: context.order,
    });
    if (response.value.check && response.value.checkScope === 'canvas')
      context.facts.checks.push({
        report: response.value.check,
        toolCallId: context.toolCallId,
        sourceFile: context.sourceFile,
        order: context.order,
      });
    return;
  }
  const requestId =
    response.kind === 'committed' || response.kind === 'pending'
      ? response.value.requestId
      : undefined;
  const command = commandFor(
    context,
    commands.filter(value => value.kind === 'apply' || value.kind === 'arrange'),
    requestId
  );
  if (!command) return;
  if (response.kind === 'committed') {
    if (command.dryRun) {
      traceDiagnostic(context, 'dry_run_committed', 'dry-run命令返回正式提交，需复核实现');
      return;
    }
    recordCommitted(context, command, response);
    return;
  }
  if (response.kind === 'pending') {
    if (
      context.facts.attempts.some(
        event => event.requestId === response.value.requestId && event.outcome === 'pending'
      )
    ) {
      context.facts.replays.push({
        requestId: response.value.requestId,
        toolCallId: context.toolCallId,
        sourceFile: context.sourceFile,
      });
      return;
    }
    recordTraceAttempt({ context, command, outcome: 'pending', accepted: true });
    return;
  }
  if (response.kind === 'dry-run') {
    if (!command.dryRun) {
      traceDiagnostic(context, 'write_preview_only', '正式写命令只返回预览');
      return;
    }
    recordTraceAttempt({ context, command, outcome: 'previewed', accepted: true });
    return;
  }
  recordTraceAttempt({
    context,
    command,
    outcome: 'rejected',
    accepted: acceptsCanvasTraceError(response.value.code),
  });
}
