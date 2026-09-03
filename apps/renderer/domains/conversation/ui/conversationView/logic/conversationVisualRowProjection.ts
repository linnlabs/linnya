import type { BaseMessage } from '../../../types';
import {
  conversationPartialVisualTurnIdFromMessageId,
  conversationVisualTurnIdFromUserMessageId,
  type ConversationVisualTurnId,
} from '@app/schemas';
import {
  isBlankFinalAnswerMessage,
  isHiddenConversationMessage,
} from '../../../functions/renderableConversationMessage';
import {
  estimateConversationMessageLayout,
  type ConversationMessageLayoutEstimate,
} from '../utils/contentHeightEstimator';
import {
  defaultEstimationRegistry,
  type EstimationRegistry,
} from '../utils/estimationRegistry';
import type {
  ConversationVisualRow,
  ConversationVisualTurnContext,
} from '../../messageCanvas';

export type VisualRowDraft = Omit<ConversationVisualRow, 'isTurnEnd' | 'isTurnStart'>;
export type EstimateVisualMessageLayout = (
  message: BaseMessage,
  registry: EstimationRegistry,
  widthPx?: number,
) => ConversationMessageLayoutEstimate;

interface MutableVisualTurnContext extends ConversationVisualTurnContext {
  sourceMessageIds: string[];
}

export interface VisualTurnAssignmentState {
  currentVisualTurnId: ConversationVisualTurnId | null;
  readonly visualTurnIdByMessageId: Map<string, ConversationVisualTurnId>;
  readonly turnContextById: Map<ConversationVisualTurnId, MutableVisualTurnContext>;
}

export interface VisualRowProjectionRuntime {
  readonly estimateMessageLayout: EstimateVisualMessageLayout;
  readonly registry: EstimationRegistry;
  readonly widthPx?: number;
}

export function shouldProjectConversationVisualMessage(message: BaseMessage): boolean {
  if (isHiddenConversationMessage(message) || isBlankFinalAnswerMessage(message)) return false;
  return true;
}

export function createVisualTurnAssignmentState(): VisualTurnAssignmentState {
  return {
    currentVisualTurnId: null,
    visualTurnIdByMessageId: new Map(),
    turnContextById: new Map(),
  };
}

export function appendVisualTurnAssignment(
  state: VisualTurnAssignmentState,
  message: BaseMessage,
): ConversationVisualTurnId {
  if (message.type === 'user_input') {
    // 可见 user message 是完整视觉轮次的唯一 owner。这里禁止读取 metadata.turn_id：
    // Runtime turn 属于执行/引用关联，把它引入布局会让 reload、窗口换页与 timeline 使用不同身份。
    state.currentVisualTurnId = conversationVisualTurnIdFromUserMessageId(message.id);
    state.turnContextById.set(state.currentVisualTurnId, {
      id: state.currentVisualTurnId,
      userMessageId: message.id,
      sourceMessageIds: [],
    });
  } else if (state.currentVisualTurnId === null) {
    // 窗口从 assistant 中段开始时只能创建局部布局身份，不能伪装成可持久化完整轮次。
    state.currentVisualTurnId = conversationPartialVisualTurnIdFromMessageId(message.id);
    state.turnContextById.set(state.currentVisualTurnId, {
      id: state.currentVisualTurnId,
      userMessageId: null,
      sourceMessageIds: [],
    });
  }

  const visualTurnId = state.currentVisualTurnId;
  const context = state.turnContextById.get(visualTurnId);
  if (!context) throw new Error(`Missing visual-row turn context: ${visualTurnId}`);
  context.sourceMessageIds.push(message.id);
  state.visualTurnIdByMessageId.set(message.id, visualTurnId);
  return visualTurnId;
}

export function buildVisualTurnAssignments(
  messages: readonly BaseMessage[],
): VisualTurnAssignmentState {
  const state = createVisualTurnAssignmentState();
  for (const message of messages) {
    if (shouldProjectConversationVisualMessage(message)) {
      appendVisualTurnAssignment(state, message);
    }
  }
  return state;
}

export function createVisualRowDraft(input: {
  readonly assignments: VisualTurnAssignmentState;
  readonly message: BaseMessage;
  readonly runtime: VisualRowProjectionRuntime;
  readonly visualTurnId: ConversationVisualTurnId;
}): VisualRowDraft {
  const layout = input.runtime.estimateMessageLayout(
    input.message,
    input.runtime.registry,
    input.runtime.widthPx,
  );
  const turnContext = input.assignments.turnContextById.get(input.visualTurnId);
  if (!turnContext) throw new Error(`Missing visual-row turn context: ${input.visualTurnId}`);
  return {
    key: `msg_${input.message.id}`,
    kind: 'message',
    estimatedHeight: layout.estimatedHeight,
    visualTurnId: input.visualTurnId,
    turnContext,
    role: input.message.role,
    bounded: false,
    payload: input.message,
  };
}

export function finalizeVisualRowDrafts(drafts: readonly VisualRowDraft[]): ConversationVisualRow[] {
  return drafts.map((draft, index) => ({
    ...draft,
    isTurnStart: index === 0 || drafts[index - 1]?.visualTurnId !== draft.visualTurnId,
    isTurnEnd: index === drafts.length - 1 || drafts[index + 1]?.visualTurnId !== draft.visualTurnId,
  }));
}

export function createVisualRowProjectionRuntime(input: {
  readonly estimateMessageLayout?: EstimateVisualMessageLayout;
  readonly estimationRegistry?: EstimationRegistry;
  readonly widthPx?: number;
}): VisualRowProjectionRuntime {
  return {
    estimateMessageLayout: input.estimateMessageLayout ?? estimateConversationMessageLayout,
    registry: input.estimationRegistry ?? defaultEstimationRegistry,
    widthPx: input.widthPx,
  };
}
