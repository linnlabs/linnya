import type { SSETransportEndEvent } from '@linnlabs/linnkit/contracts';

import { parseSSEExecutionScope } from '@linnlabs/linnkit/contracts';

import { releaseExecutionProjectionState } from '../functions/executionProjectionState';
import type { MessageProjectionState, ProjectionResult } from '../state';

/** transport completion 只释放本 execution 的在途归并状态，不写 run 业务状态。 */
export function projectTransportEndEvent(
  state: MessageProjectionState,
  event: SSETransportEndEvent,
): ProjectionResult {
  // pre-admission transport 没有 run 身份，只结束请求连接，不存在可释放的 run 投影。
  if (!event.run_id) return { success: true, newState: state };
  releaseExecutionProjectionState(state, parseSSEExecutionScope(event));
  return { success: true, newState: state };
}
