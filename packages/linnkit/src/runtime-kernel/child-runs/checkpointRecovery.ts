import {
  parseRuntimeEvents,
  parseRoutedRuntimeEvent,
  type RoutedRuntimeEvent,
  type RuntimeEvent,
} from '../../contracts';
import type { Checkpointer } from '../graph-engine/checkpointer/base';
import type { EngineState } from '../graph-engine/types';

function hasSeedHistoryPrefix(
  history: ReadonlyArray<RuntimeEvent>,
  seedHistory: ReadonlyArray<RuntimeEvent>
): boolean {
  if (seedHistory.length === 0) return true;
  if (history.length < seedHistory.length) return false;

  for (let i = 0; i < seedHistory.length; i += 1) {
    const historyEvent = history[i];
    const seedEvent = seedHistory[i];
    if (!historyEvent || !seedEvent) return false;
    if (historyEvent.id !== seedEvent.id || historyEvent.type !== seedEvent.type) {
      return false;
    }
  }
  return true;
}

function readCheckpointHistory(checkpoint: EngineState | null): RuntimeEvent[] {
  if (!checkpoint?.local) return [];
  const history = checkpoint.local.history;
  if (!Array.isArray(history)) return [];
  return parseRuntimeEvents(history);
}

export async function recoverChildRunEventsFromCheckpoint(params: {
  checkpointer: Checkpointer;
  checkpointKey: string;
  childConversationId: string;
  seedHistory: ReadonlyArray<RuntimeEvent>;
}): Promise<RoutedRuntimeEvent[]> {
  const checkpoint = await params.checkpointer.load(params.checkpointKey);
  const history = readCheckpointHistory(checkpoint);
  if (history.length === 0) {
    return [];
  }

  if (hasSeedHistoryPrefix(history, params.seedHistory)) {
    return history
      .slice(params.seedHistory.length)
      .map(event => parseRoutedRuntimeEvent(event));
  }

  return history
    .filter(event => event.conversation_id === params.childConversationId)
    .map(event => parseRoutedRuntimeEvent(event));
}
