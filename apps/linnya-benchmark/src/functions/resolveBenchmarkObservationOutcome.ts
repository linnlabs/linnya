import type { ConversationControlRunStatusSnapshot } from '@app/schemas';
import type { BenchmarkRunOutcome } from '../definitions/benchmarkRun';

/** 观察可以结束而 run 仍可恢复；不能把 settled pause 当作完成或隐式批准。 */
export function resolveBenchmarkObservationOutcome(
  snapshot: ConversationControlRunStatusSnapshot,
): BenchmarkRunOutcome | undefined {
  switch (snapshot.status) {
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'paused': return snapshot.pause?.settled === true ? 'requires_recovery' : undefined;
    case 'pending':
    case 'running':
    case 'awaiting_user':
      return undefined;
  }
  const unhandledStatus: never = snapshot.status;
  return unhandledStatus;
}
