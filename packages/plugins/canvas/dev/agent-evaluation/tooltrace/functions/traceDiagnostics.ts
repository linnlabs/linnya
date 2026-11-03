import type { CanvasTraceContext } from '../definitions/canvasToolTrace';
export function traceDiagnostic(context: CanvasTraceContext, code: string, message: string): void {
  context.facts.diagnostics.push({
    code,
    message,
    sourceFile: context.sourceFile,
    toolCallId: context.toolCallId,
  });
  context.facts.needsReview = true;
}
