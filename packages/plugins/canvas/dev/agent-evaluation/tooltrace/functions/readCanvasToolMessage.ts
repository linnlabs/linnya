import { z } from 'zod';
import { ShellToolArgumentsV1Schema } from '@app/schemas';
import type { CanvasTraceContext } from '../definitions/canvasToolTrace';
import type { CanvasTraceMessage } from './readToolTraceMessages';
import { traceDiagnostic } from './traceDiagnostics';
import { readCompleteShellOutput } from './readCompleteShellOutput';
import { readLiteralCanvasCommands } from './readLiteralCanvasCommands';
import { recordCanvasTraceResponse } from './recordCanvasTraceResponse';
import { admitCanvasTraceResponse } from './admitCanvasTraceResponse';
import { readAmbiguousCanvasResponseKinds } from './readAmbiguousCanvasResponseKinds';
const attachedImage = z.object({
  source_kind: z.literal('conversation_file'),
  locator: z.string(),
  content_type: z.string().startsWith('image/'),
  attachment_status: z.literal('attached'),
});
function recordImageRead(context: CanvasTraceContext, data: unknown) {
  const image = attachedImage.safeParse(data);
  if (!image.success) return;
  const render = [...context.facts.renders]
    .reverse()
    .find(
      value =>
        value.locator === image.data.locator &&
        value.runId === context.runId &&
        value.order < context.order
    );
  if (render)
    context.facts.imageReads.push({
      locator: image.data.locator,
      renderToolCallId: render.toolCallId,
      toolCallId: context.toolCallId,
      sourceFile: context.sourceFile,
      order: context.order,
    });
}
export function readCanvasToolMessage(input: {
  readonly context: CanvasTraceContext;
  readonly row: CanvasTraceMessage;
  readonly files: Map<string, string>;
}): void {
  const message = input.row.message;
  if (message.message_type !== 'tool_calls') return;
  const payload = message.payload,
    context = input.context;
  if (
    payload.tool_name === 'read_file' &&
    payload.status === 'success' &&
    payload.phase === 'complete'
  ) {
    recordImageRead(context, payload.data);
    return;
  }
  if (payload.tool_name !== 'shell') return;
  const args = ShellToolArgumentsV1Schema.safeParse(payload.args);
  if (!args.success) {
    traceDiagnostic(context, 'shell_arguments_unknown', 'shell参数不符合正式合同');
    return;
  }
  const commands = readLiteralCanvasCommands(args.data.command, input.files, args.data.cwd ?? '.');
  if (payload.phase === 'complete')
    for (const command of commands.receiptInvocations) {
      if (command.requestId && context.facts.scope.locators.includes(command.target))
        context.facts.requests.push({
          requestId: command.requestId,
          runId: context.runId,
          toolCallId: context.toolCallId,
          sourceFile: context.sourceFile,
          order: context.order,
        });
    }
  const matching = commands.invocations.filter(command =>
    context.facts.scope.locators.includes(command.target)
  );
  if (commands.ambiguous) {
    if (
      matching.length ||
      /\blinnya-canvas\s+(apply|arrange|check|render)\b/.test(args.data.command)
    )
      traceDiagnostic(
        context,
        'shell_dynamic_command',
        '动态shell、控制流、管道或混合输出不作执行推断'
      );
    return;
  }
  if (!matching.length) return;
  const output = readCompleteShellOutput(payload.data);
  if (!output) {
    traceDiagnostic(context, 'shell_output_incomplete', 'shell输出未完整终止，不能判定Canvas结果');
    return;
  }
  if (output.unknownLines)
    traceDiagnostic(context, 'shell_output_unknown_text', 'stdout含非正式单行JSON内容');
  const responses = output.objects.map(value => admitCanvasTraceResponse(value));
  const ambiguous = readAmbiguousCanvasResponseKinds(commands.invocations, responses),
    reported = new Set<string>();
  for (const response of responses) {
    if (
      (response.kind === 'check' || response.kind === 'render') &&
      ambiguous.has(response.kind) &&
      matching.some(command => command.kind === response.kind)
    ) {
      if (!reported.has(response.kind))
        traceDiagnostic(
          context,
          'response_target_ambiguous',
          `${response.kind}输出缺文档身份，多目标或多条同类命令/响应不能唯一配对`
        );
      reported.add(response.kind);
      continue;
    }
    recordCanvasTraceResponse(context, matching, response);
  }
  if (!output.objects.length)
    traceDiagnostic(context, 'canvas_response_missing', 'Canvas调用缺少可接纳的正式响应');
}
