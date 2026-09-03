import { GraphNode, EngineState, NodeResult } from '../types';
import type { RuntimeEvent } from '../../../contracts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  return isRecord(value) && typeof value.type === 'string';
}

export class UserNode implements GraphNode {
  id = 'user';

  async run(state: EngineState): Promise<NodeResult> {
    const local = isRecord(state.local) ? state.local : {};
    const newEvents = Array.isArray(local.newEvents) ? local.newEvents.filter(isRuntimeEvent) : [];
    const userInputEvent = newEvents.find((event) => event.type === 'user_input');

    if (!userInputEvent) {
      return { kind: 'yield', events: [] };
    }

    return { kind: 'route', nextNodeId: 'llm', events: [] };
  }
}
