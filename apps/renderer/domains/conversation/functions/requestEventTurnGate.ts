import type { SSEEvent } from 'linnkit/contracts';

export type RequestTurnEvent = Pick<SSEEvent, 'type' | 'turn_id'>;

function isTurnIndependentEvent(event: RequestTurnEvent): boolean {
  return (
    event.type === 'transport_error'
    || event.type === 'transport_end'
    || event.type === 'summarization_start'
    || event.type === 'summarization_end'
    || event.type === 'summarization_error'
  );
}

/**
 * 为一次后端请求创建 turn 所有权门禁。
 * 首个 run event 确定本请求的 turn；只有 transport / summarization 控制信号不参与锁定。
 */
export function createRequestEventTurnGate(): (event: RequestTurnEvent) => boolean {
  let activeTurnId: string | null = null;

  return (event: RequestTurnEvent): boolean => {
    if (!event.turn_id || isTurnIndependentEvent(event)) return true;
    if (activeTurnId === null) {
      activeTurnId = event.turn_id;
      return true;
    }
    return event.turn_id === activeTurnId;
  };
}
