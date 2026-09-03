import {
  isRoutedRuntimeEvent,
  type RoutedRuntimeEvent,
  type RuntimeEvent,
} from '../../../contracts';
import type { EngineState, NodeResult } from '../types';

export type GraphStepAction =
  | { kind: 'route'; fromNodeId: string; nextNodeId: string }
  | { kind: 'yield' }
  | { kind: 'pause' };

export interface GraphStepResultInput {
  state: EngineState;
  result: NodeResult;
}

export interface GraphStepResultResolution {
  state: EngineState;
  events: RoutedRuntimeEvent[];
  action: GraphStepAction;
}

function normalizeResultEvents(events: NodeResult['events']): RoutedRuntimeEvent[] {
  if (!Array.isArray(events)) return [];
  for (const event of events) {
    const candidate: RuntimeEvent = event;
    if (!isRoutedRuntimeEvent(candidate)) {
      throw new Error(`Graph node returned an event before run admission: ${candidate.id}`);
    }
  }
  return events;
}

function assertNeverResultKind(value: never): never {
  throw new Error(`Unsupported graph node result kind: ${String(value)}`);
}

export function resolveGraphStepResult(input: GraphStepResultInput): GraphStepResultResolution {
  const events = normalizeResultEvents(input.result.events);
  if (input.result.kind === 'route') {
    const nextNodeId = input.result.nextNodeId || 'user';
    return {
      state: { ...input.state, nodeId: nextNodeId },
      events,
      action: {
        kind: 'route',
        fromNodeId: input.state.nodeId,
        nextNodeId,
      },
    };
  }

  if (input.result.kind === 'yield') {
    return {
      state: input.state,
      events,
      action: { kind: 'yield' },
    };
  }

  if (input.result.kind === 'pause') {
    return {
      state: input.state,
      events,
      action: { kind: 'pause' },
    };
  }

  return assertNeverResultKind(input.result.kind);
}
