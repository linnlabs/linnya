import type { RunId, RuntimeEvent } from 'linnkit/contracts';

/**
 * 只把当前 run 的正式附件事实视为“模型已经见过”。历史轮次、其他 child run
 * 或仅有文件名的输出都不能证明当前模型上下文仍持有相同像素。
 */
export function hasRunImageAttachment(
  events: ReadonlyArray<RuntimeEvent>,
  runId: RunId,
  sha256: string,
): boolean {
  return events.some(event => (
    event.run_id === runId
    && (event.type === 'user_input' || event.type === 'tool_output')
    && event.attachments?.some(attachment => attachment.sha256 === sha256) === true
  ));
}
