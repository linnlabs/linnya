import type { ChildRunHistoryPolicy } from './types';
import type { RuntimeEvent } from '../../contracts';

export function defaultChildRunHistoryEventFilter(event: RuntimeEvent): boolean {
  return event.type === 'user_input'
    || (event.type === 'final_answer'
      && event.completion_reason === 'terminal');
}

function removeInheritedAttachments(event: RuntimeEvent): RuntimeEvent {
  if (event.type !== 'user_input' && event.type !== 'tool_output') {
    return event;
  }
  const { attachments: _attachments, ...eventWithoutAttachments } = event;
  return eventWithoutAttachments;
}

export function pickChildRunSeedHistory(params: {
  parentHistory: ReadonlyArray<RuntimeEvent>;
  historyPolicy?: ChildRunHistoryPolicy;
}): RuntimeEvent[] {
  const { parentHistory, historyPolicy } = params;
  const inheritTurns = historyPolicy?.inheritTurns ?? 0;
  if (inheritTurns <= 0) {
    return [];
  }

  const eventFilter = historyPolicy?.eventFilter ?? defaultChildRunHistoryEventFilter;
  const selectedReversed: RuntimeEvent[] = [];
  let userCount = 0;

  for (let i = parentHistory.length - 1; i >= 0; i -= 1) {
    const event = parentHistory[i];
    if (!eventFilter(event)) {
      continue;
    }
    selectedReversed.push(event);
    if (event.type === 'user_input') {
      userCount += 1;
      if (userCount >= inheritTurns) {
        break;
      }
    }
  }

  const selected = selectedReversed.reverse();
  if (historyPolicy?.includeAttachments === true) {
    return selected;
  }

  // 继承文本历史不隐含父附件读取权，附件必须由调用方单独显式授权。
  return selected.map(removeInheritedAttachments);
}
