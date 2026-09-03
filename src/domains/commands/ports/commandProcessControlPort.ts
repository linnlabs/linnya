import type {
  CommandProcessInteractionResult,
  ProcessCancellationRequestV1,
  ProcessInteractionRequestV1,
  CommandProcessCancellationResult,
} from '../features/process-control/definitions/processControlAction';
import type {
  CommandProtectedInputRequest,
  CommandProtectedInputResult,
} from '../features/protected-input';

/**
 * Agent 可见 handle 的状态变更控制口。查询保持在 observation port，避免长时间 wait
 * 占住取消；真正的平台 PID、进程组和 Job 仍封装在 runtime 内部。
 */
export interface CommandProcessControlPort {
  controlInteraction(request: ProcessInteractionRequestV1): Promise<CommandProcessInteractionResult>;
  submitProtectedInput(request: CommandProtectedInputRequest): Promise<CommandProtectedInputResult>;
  cancelAndWait(request: ProcessCancellationRequestV1): Promise<CommandProcessCancellationResult>;
}
