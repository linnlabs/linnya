import type { ToolUiActivity } from '@linnya/plugin-host-contract/renderer/toolUi';
import type { InteractiveRunStatus } from '../../../features/interactive-run';
import type { BaseMessage, ToolCallMessage } from '../../../types';
import {
  RUN_STATUS_LONG_THOUGHT_MS,
  RUN_STATUS_MIN_DWELL_MS,
  type RunStatusSignal,
  type RunStatusText,
} from '../definitions/runStatus';

export interface RunStatusSignalInput {
  readonly runStatus: InteractiveRunStatus;
  /** 当前执行身份；重试通知只有属于同一次执行时才算“正在重试”。 */
  readonly executionId: string | undefined;
  /** 本对话有命令正在等用户批准（命令审批投影里 awaiting_reply）。 */
  readonly awaitingApproval: boolean;
  /** 本次运行已加载的消息，按时间线顺序；调用方已按 run_id 过滤。 */
  readonly runMessages: readonly BaseMessage[];
  readonly now: number;
  /** 工具类别由工具 owner 在 ToolUiConfig.activity 声明，这里只读取，不维护工具名映射。 */
  readonly resolveToolActivity: (message: ToolCallMessage) => ToolUiActivity | undefined;
}

/**
 * 从运行事实推出状态行信号。优先级从“球在用户这边”到“正在做什么”：
 * 暂停 > 等回答 > 等批准 > 整理上下文 > 重试 > 最后一条消息说明的进展。
 */
export function resolveRunStatusSignal(input: RunStatusSignalInput): RunStatusSignal {
  // 暂停收尾、停止收尾都已不再产生进展，和已暂停一样静止显示。
  if (input.runStatus === 'paused' || input.runStatus === 'pausing' || input.runStatus === 'cancelling') {
    return { kind: 'paused' };
  }
  if (input.runStatus === 'awaiting_user') return { kind: 'awaiting_answer' };
  if (input.awaitingApproval) return { kind: 'awaiting_approval' };
  // 摘要进度不一定是最后一条消息（摘要期间可能还有通知），只要仍在摘要就以它为准。
  if (input.runMessages.some(message => (
    message.type === 'summarization_progress' && message.metadata.summary.status === 'summarizing'
  ))) {
    return { kind: 'compacting' };
  }

  const progress = input.runMessages.filter(isRunProgressMessage);
  const last = progress[progress.length - 1];
  if (!last) return { kind: 'starting' };

  switch (last.type) {
    case 'user_input':
      // 刚发出，或运行中途插话刚送达：模型正在读新的输入。
      return { kind: 'starting' };
    case 'execution_notice': {
      const retry = last.metadata.retry;
      const isCurrentRetry = retry !== undefined
        && (retry.status === 'waiting' || retry.status === 'retrying')
        && last.metadata.execution_id === input.executionId;
      return isCurrentRetry ? { kind: 'retrying' } : { kind: 'working' };
    }
    case 'thought':
      return last.metadata.is_complete
        ? { kind: 'working' }
        : { kind: 'thinking', thoughtMs: Math.max(0, input.now - last.metadata.thought_started_at) };
    case 'final_answer':
    case 'partial_answer':
    case 'tool_preamble':
      // 回答正文流式输出时还分不清它最后是叙述还是最终回答，统一说“正在写回答”。
      return last.metadata.is_complete ? { kind: 'working' } : { kind: 'answering' };
    case 'tool_calls':
      return resolveTrailingToolSignal(progress, input.resolveToolActivity);
    case 'history_summary':
    case 'summarization_progress':
      return { kind: 'working' };
  }
}

type RunProgressMessage = Exclude<BaseMessage, { type: 'client_notice' | 'command_permission_change' }>;

/** 本地通知与命令档位变更不是运行进展，不能改变状态文字。 */
function isRunProgressMessage(message: BaseMessage): message is RunProgressMessage {
  return message.type !== 'client_notice' && message.type !== 'command_permission_change';
}

/**
 * 并行工具会连续出现多条 tool_calls；只要末尾这一批里还有在跑的，就说最后开始的那个在做什么，
 * 全部返回后模型还没输出下一步时说“正在分析结果”。
 */
function resolveTrailingToolSignal(
  progress: readonly RunProgressMessage[],
  resolveToolActivity: RunStatusSignalInput['resolveToolActivity'],
): RunStatusSignal {
  for (let index = progress.length - 1; index >= 0; index -= 1) {
    const message = progress[index];
    if (message?.type !== 'tool_calls') break;
    if (message.metadata.status === 'loading') {
      return { kind: 'tool', activity: resolveToolActivity(message) };
    }
  }
  return { kind: 'after_tool' };
}

const TOOL_TEXT: Readonly<Record<ToolUiActivity, RunStatusText>> = {
  search: { labelKey: 'conversation.runStatus.search', motion: 'processing' },
  read: { labelKey: 'conversation.runStatus.read', motion: 'processing' },
  edit: { labelKey: 'conversation.runStatus.edit', motion: 'generating' },
  command: { labelKey: 'conversation.runStatus.command', motion: 'processing' },
  delegate: { labelKey: 'conversation.runStatus.delegate', motion: 'processing' },
  plan: { labelKey: 'conversation.runStatus.plan', motion: 'thinking' },
  image: { labelKey: 'conversation.runStatus.image', motion: 'generating' },
};

const WORKING_TEXT: RunStatusText = { labelKey: 'conversation.runStatus.working', motion: 'processing' };

/** 信号 → 文字与图标动态的唯一映射；没有声明类别的工具落到“努力工作中”。 */
export function resolveRunStatusText(signal: RunStatusSignal): RunStatusText {
  switch (signal.kind) {
    case 'starting':
      return { labelKey: 'conversation.runStatus.starting', motion: 'thinking' };
    case 'thinking':
      return signal.thoughtMs >= RUN_STATUS_LONG_THOUGHT_MS
        ? { labelKey: 'conversation.runStatus.thinkingHard', motion: 'thinking' }
        : { labelKey: 'conversation.runStatus.thinking', motion: 'thinking' };
    case 'tool':
      return signal.activity ? TOOL_TEXT[signal.activity] : WORKING_TEXT;
    case 'after_tool':
      return { labelKey: 'conversation.runStatus.reviewingResults', motion: 'processing' };
    case 'answering':
      return { labelKey: 'conversation.runStatus.answering', motion: 'generating' };
    case 'working':
      return WORKING_TEXT;
    case 'awaiting_answer':
      return { labelKey: 'conversation.runStatus.awaitingAnswer', motion: 'still' };
    case 'awaiting_approval':
      return { labelKey: 'conversation.runStatus.awaitingApproval', motion: 'still' };
    case 'compacting':
      return { labelKey: 'conversation.runStatus.compacting', motion: 'processing' };
    case 'retrying':
      return { labelKey: 'conversation.runStatus.retrying', motion: 'processing' };
    case 'paused':
      return { labelKey: 'conversation.runStatus.paused', motion: 'still' };
  }
}

export interface DisplayedRunStatus {
  readonly text: RunStatusText;
  readonly shownAt: number;
}

/**
 * 文字至少停留 2 秒再换。例外是“球在用户这边”的静止状态（暂停、等回答、等批准）进出：
 * 它们回应用户刚做的操作或需要用户马上处理，延迟显示会让人以为没生效。
 */
export function advanceDisplayedRunStatus(
  current: DisplayedRunStatus | null,
  next: RunStatusText,
  now: number,
): DisplayedRunStatus {
  if (!current) return { text: next, shownAt: now };
  if (current.text.labelKey === next.labelKey) return current;
  const involvesUser = current.text.motion === 'still' || next.motion === 'still';
  if (!involvesUser && now - current.shownAt < RUN_STATUS_MIN_DWELL_MS) return current;
  return { text: next, shownAt: now };
}

/**
 * 本轮已用时长：从触发本轮的用户消息算起，暂停期间不计。
 * `runningSince` 为空表示计时停着；暂停前累计的时长留在 `accumulatedMs`。
 */
export interface RunWorkClock {
  readonly accumulatedMs: number;
  readonly runningSince: number | null;
}

export function createRunWorkClock(input: {
  readonly startedAt: number;
  readonly now: number;
  readonly ticking: boolean;
}): RunWorkClock {
  return input.ticking
    ? { accumulatedMs: 0, runningSince: input.startedAt }
    : { accumulatedMs: Math.max(0, input.now - input.startedAt), runningSince: null };
}

export function setRunWorkClockTicking(clock: RunWorkClock, ticking: boolean, now: number): RunWorkClock {
  if (ticking && clock.runningSince === null) return { ...clock, runningSince: now };
  if (!ticking && clock.runningSince !== null) {
    return { accumulatedMs: readRunWorkClock(clock, now), runningSince: null };
  }
  return clock;
}

export function readRunWorkClock(clock: RunWorkClock, now: number): number {
  return clock.accumulatedMs + (clock.runningSince === null ? 0 : Math.max(0, now - clock.runningSince));
}

/**
 * 本轮的开始时间：触发本轮的用户消息（最后一条非插话的用户消息）。长运行里它可能不在已加载的
 * 消息窗口中，这时只能从本轮最早加载的一条消息算起，时长会偏短。还没有任何带本轮身份的消息时
 * （刚发出、还没拿到运行身份）返回 null，由调用方从现在开始计时：此时最后一条用户消息可能还是上一轮的。
 */
export function resolveRunStartedAt(
  messages: readonly BaseMessage[],
  isRunMessage: (message: BaseMessage) => boolean,
): number | null {
  let rootUserAt: number | null = null;
  let earliestRunMessageAt: number | null = null;
  for (const message of messages) {
    if (message.type === 'user_input' && message.metadata?.delivery !== 'mid_run') {
      rootUserAt = message.timestamp;
    }
    if (earliestRunMessageAt === null && isRunMessage(message)) earliestRunMessageAt = message.timestamp;
  }
  if (earliestRunMessageAt === null) return null;
  return rootUserAt !== null && rootUserAt <= earliestRunMessageAt ? rootUserAt : earliestRunMessageAt;
}
