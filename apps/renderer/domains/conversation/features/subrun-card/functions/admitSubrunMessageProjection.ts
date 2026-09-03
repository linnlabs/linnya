import type { SSESubRunTraceEvent } from 'linnkit/contracts';

import type { BaseMessage } from '../../../types';
import type { SubrunTraceBucket } from '../../subrun-trace';
import type {
  SubrunAnswerProjectionState,
  SubrunMessageProjectionState,
} from '../definitions/subrunCard';
import {
  createSubrunMessageProjectionState,
  projectSubrunTraceEvent,
  resetSubrunMessageProjection,
} from './projectSubrunTraceEvent';

export interface SubrunMessageProjectionSnapshot {
  readonly subrunId: string;
  readonly messages: readonly BaseMessage[];
  readonly version: number;
}

export interface SubrunMessageProjectionAdmission {
  admit(bucket: SubrunTraceBucket | null): SubrunMessageProjectionSnapshot;
  reset(): SubrunMessageProjectionSnapshot;
}

function cloneAnswerState(value: SubrunAnswerProjectionState): SubrunAnswerProjectionState {
  return {
    ...value,
    chunks: new Map(value.chunks),
  };
}

function cloneProjectionState(value: SubrunMessageProjectionState): SubrunMessageProjectionState {
  return {
    citationWorkspace: new Map(
      [...value.citationWorkspace].map(([turnId, citations]) => [turnId, new Map(citations)]),
    ),
    toolMessageIndexByCallId: new Map(value.toolMessageIndexByCallId),
    toolDecisionByCallId: new Map(value.toolDecisionByCallId),
    currentThoughtMessageIndex: value.currentThoughtMessageIndex,
    thoughtSequence: value.thoughtSequence,
    answerStateById: new Map(
      [...value.answerStateById].map(([answerId, answer]) => [answerId, cloneAnswerState(answer)]),
    ),
    subrunId: value.subrunId,
    currentThoughtStartedAt: value.currentThoughtStartedAt,
  };
}

function cloneMessage<TMessage extends BaseMessage>(message: TMessage): TMessage {
  return {
    ...message,
    metadata: { ...message.metadata },
  };
}

function cloneMessages(messages: readonly BaseMessage[]): BaseMessage[] {
  return messages.map(cloneMessage);
}

function projectEvents(
  state: SubrunMessageProjectionState,
  messages: BaseMessage[],
  events: readonly SSESubRunTraceEvent[],
  startIndex: number,
): void {
  for (let index = startIndex; index < events.length; index += 1) {
    const event = events[index];
    if (!event) continue;
    try {
      const result = projectSubrunTraceEvent(state, messages, event, index);
      if (!result.success) {
        throw new Error(result.reason);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `[SUBRUN_MESSAGE_ADMISSION_FAILED] event=${event.source_event_id}: ${detail}`,
      );
    }
  }
}

/**
 * Subrun 完整消息的唯一 presentation admission owner。
 *
 * 同一 append-only bucket 只处理新增尾部；历史前缀迟到或 source epoch 改变时，bucket
 * identity 会变化，此处在 detached draft 上完整重建。任何失败都不会修改已发布 snapshot。
 */
export function createSubrunMessageProjectionAdmission(): SubrunMessageProjectionAdmission {
  let admittedEvents: readonly SSESubRunTraceEvent[] | null = null;
  let processedLength = 0;
  let state = createSubrunMessageProjectionState();
  let messages: BaseMessage[] = [];
  let version = 0;
  let snapshot: SubrunMessageProjectionSnapshot = {
    subrunId: '',
    messages,
    version,
  };

  function reset(): SubrunMessageProjectionSnapshot {
    admittedEvents = null;
    processedLength = 0;
    state = createSubrunMessageProjectionState();
    messages = [];
    version += 1;
    snapshot = { subrunId: '', messages, version };
    return snapshot;
  }

  return {
    admit(bucket) {
      if (!bucket) {
        return admittedEvents === null && messages.length === 0 ? snapshot : reset();
      }
      if (admittedEvents === bucket.events && processedLength === bucket.events.length) {
        return snapshot;
      }

      const appendsCurrentEpoch = admittedEvents === bucket.events
        && processedLength <= bucket.events.length;
      const draftState = appendsCurrentEpoch
        ? cloneProjectionState(state)
        : createSubrunMessageProjectionState();
      const draftMessages = appendsCurrentEpoch ? cloneMessages(messages) : [];
      const startIndex = appendsCurrentEpoch ? processedLength : 0;
      if (!appendsCurrentEpoch) {
        resetSubrunMessageProjection(draftState, draftMessages, bucket.subrun_id);
      }

      projectEvents(draftState, draftMessages, bucket.events, startIndex);

      state = draftState;
      messages = draftMessages;
      admittedEvents = bucket.events;
      processedLength = bucket.events.length;
      version += 1;
      snapshot = {
        subrunId: bucket.subrun_id,
        messages,
        version,
      };
      return snapshot;
    },
    reset,
  };
}
