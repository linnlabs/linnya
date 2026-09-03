import {
  SubagentArgsSchema,
  SubagentResultSchema,
} from '@app/schemas';

import type { ToolCallMessage } from '../../../types';
import type { SubrunDetailFooterPresentation } from '../definitions/subrunDetail';

/**
 * 底栏只读取 subagent owner 的正式参数/结果合同。
 * 当前模型选择和 trace 文本都不是 durable 执行事实，不能拿来补猜历史模型或终态。
 */
export function projectSubrunDetailFooterPresentation(params: {
  readonly parentMessage: ToolCallMessage;
  readonly subrunId: string;
}): SubrunDetailFooterPresentation {
  const { parentMessage } = params;
  SubagentArgsSchema.parse(parentMessage.metadata.args);

  if (parentMessage.metadata.status === 'loading') {
    return { status: 'running' };
  }
  if (parentMessage.metadata.status === 'error') {
    return { status: 'failed' };
  }

  const result = SubagentResultSchema.parse({
    data: parentMessage.metadata.data,
    observation: parentMessage.content,
  });
  if (result.data.subrun_ids[0] !== params.subrunId) {
    throw new Error(
      `[SUBRUN_DETAIL_RESULT_IDENTITY_CONFLICT] scope=${params.subrunId}, result=${result.data.subrun_ids[0]}`,
    );
  }
  return {
    status: result.data.status,
    modelId: result.data.model_id,
  };
}
