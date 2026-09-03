import type {
  FinalAnswerEvent,
  RuntimeEvent,
} from '../../contracts';

export function findTerminalFinalAnswer(
  events: ReadonlyArray<RuntimeEvent>,
): FinalAnswerEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== 'final_answer') continue;
    if (event.completion_reason === 'terminal') return event;
  }
  return undefined;
}

export function findLatestProgressAnswer(
  events: ReadonlyArray<RuntimeEvent>,
): FinalAnswerEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== 'final_answer') continue;
    if (event.completion_reason !== 'terminal') return event;
  }
  return undefined;
}
