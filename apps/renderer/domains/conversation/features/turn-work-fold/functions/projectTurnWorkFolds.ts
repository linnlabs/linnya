import type { BaseMessage, ToolCallMessage } from '../../../types';
import type {
  ConversationMessageVisualRow,
  ConversationTurnWorkFoldVisualRow,
  ConversationVisualRow,
} from '../../../ui/messageCanvas';
import { readConversationMessageRunId } from '../../../functions/readConversationMessageRunId';

export interface TurnWorkFoldProjectionInput {
  readonly rows: readonly ConversationMessageVisualRow[];
  /** 仍在进行（含等回答、已暂停）的运行；它们的轮次保持透明，不折叠。 */
  readonly busyRunIds: ReadonlySet<string>;
  readonly isExpanded: (rootUserMessageId: string) => boolean;
  /** 工具结果本身是交付给用户的成果（例如生成的图片），折叠时留在外面。 */
  readonly isDeliverableTool: (message: ToolCallMessage) => boolean;
  readonly foldRowEstimatedHeight: number;
  /** 上一次的结果；内容没变的行原样复用，避免流式输出时整屏行组件重渲染。 */
  readonly previousRows?: ReadonlyMap<string, ConversationVisualRow>;
}

/**
 * 终态折叠投影：一轮（从用户消息到下一条用户消息，运行中途的插话不算新一轮）结束且有最终回答时，
 * 把本轮的思考、叙述与工具调用收成一行“已工作 x 分 x 秒”。展开时原样显示全部行。
 *
 * 不折叠：仍在进行的运行、失败或停止的运行（结算结果不是 completed，或没有最终回答）、
 * 没有结算时长的历史轮次、没有过程可收的轮次。插话、最终回答和交付成果始终留在外面。
 */
export function projectTurnWorkFolds(input: TurnWorkFoldProjectionInput): ConversationVisualRow[] {
  const output: ConversationVisualRow[] = [];
  let index = 0;
  while (index < input.rows.length) {
    const row = input.rows[index];
    if (!row) break;
    if (!isRootUserRow(row)) {
      output.push(row);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < input.rows.length) {
      const next = input.rows[end];
      if (!next || isRootUserRow(next)) break;
      end += 1;
    }
    appendSpan(output, input.rows.slice(index, end), input);
    index = end;
  }
  return settleTurnBoundaries(output, input.previousRows);
}

function appendSpan(
  output: ConversationVisualRow[],
  span: readonly ConversationMessageVisualRow[],
  input: TurnWorkFoldProjectionInput,
): void {
  const [root, ...rest] = span;
  if (!root || root.payload.type !== 'user_input') {
    output.push(...span);
    return;
  }
  const durationMs = resolveFoldableDuration(root.payload, span, input);
  const hidden = rest.filter(row => isProcessRow(row.payload, input.isDeliverableTool));
  if (durationMs === null || hidden.length === 0) {
    output.push(...span);
    return;
  }
  const expanded = input.isExpanded(root.payload.id);
  const fold: ConversationTurnWorkFoldVisualRow = {
    key: `work-fold_${root.payload.id}`,
    kind: 'turn-work-fold',
    // 折叠行跟在用户消息后面，属于同一视觉轮次；时间线导航与行间距都按这一轮计算。
    estimatedHeight: input.foldRowEstimatedHeight,
    visualTurnId: root.visualTurnId,
    turnContext: root.turnContext,
    isTurnStart: false,
    isTurnEnd: false,
    bounded: false,
    fold: { rootUserMessageId: root.payload.id, durationMs, expanded },
  };
  output.push(root, fold);
  const hiddenKeys = new Set(hidden.map(row => row.key));
  for (const row of rest) {
    if (expanded || !hiddenKeys.has(row.key)) output.push(row);
  }
}

function isRootUserRow(row: ConversationMessageVisualRow): boolean {
  return row.payload.type === 'user_input' && row.payload.metadata?.delivery !== 'mid_run';
}

/** 只有正常结束、有最终回答、已经结算出时长的轮次才折叠；返回 null 表示保持原样。 */
function resolveFoldableDuration(
  root: Extract<BaseMessage, { type: 'user_input' }>,
  span: readonly ConversationMessageVisualRow[],
  input: TurnWorkFoldProjectionInput,
): number | null {
  const agentWork = root.metadata?.agent_work;
  // agent_work 是运行结算事实；没有它就不知道这一轮是否正常结束，也写不出时长。
  if (!agentWork || agentWork.outcome !== 'completed') return null;
  const busy = span.some(row => {
    const runId = readConversationMessageRunId(row.payload);
    return runId !== null && input.busyRunIds.has(runId);
  });
  if (busy) return null;
  // 空回答在 visual-row 投影里已被过滤，这里出现的 final_answer 都是真实回答。
  if (!span.some(row => row.payload.type === 'final_answer')) return null;
  return agentWork.duration_ms;
}

/** 过程 = 思考、叙述、工具调用（交付成果除外）、重试/错误通知与上下文摘要。 */
function isProcessRow(
  message: BaseMessage,
  isDeliverableTool: (message: ToolCallMessage) => boolean,
): boolean {
  switch (message.type) {
    case 'thought':
    case 'tool_preamble':
    case 'partial_answer':
    case 'execution_notice':
    case 'history_summary':
    case 'summarization_progress':
      return true;
    case 'tool_calls':
      return !isDeliverableTool(message);
    case 'user_input':
    case 'final_answer':
    case 'client_notice':
    case 'command_permission_change':
      return false;
  }
}

/**
 * 隐去的行可能正好是某个视觉轮次的首尾，按最终顺序重算 isTurnStart / isTurnEnd。
 * 标记没变的行返回原对象；变了的行和折叠行与上一次结果逐字段相同时也复用上一次的对象。
 */
function settleTurnBoundaries(
  rows: readonly ConversationVisualRow[],
  previousRows: ReadonlyMap<string, ConversationVisualRow> | undefined,
): ConversationVisualRow[] {
  return rows.map((row, index) => {
    const isTurnStart = index === 0 || rows[index - 1]?.visualTurnId !== row.visualTurnId;
    const isTurnEnd = index === rows.length - 1 || rows[index + 1]?.visualTurnId !== row.visualTurnId;
    const settled = row.isTurnStart === isTurnStart && row.isTurnEnd === isTurnEnd
      ? row
      : { ...row, isTurnStart, isTurnEnd };
    if (settled === row && row.kind === 'message') return row;
    const previous = previousRows?.get(row.key);
    return previous && isSameDerivedRow(previous, settled) ? previous : settled;
  });
}

function isSameDerivedRow(left: ConversationVisualRow, right: ConversationVisualRow): boolean {
  if (
    left.isTurnStart !== right.isTurnStart
    || left.isTurnEnd !== right.isTurnEnd
    || left.visualTurnId !== right.visualTurnId
    || left.turnContext !== right.turnContext
    || left.estimatedHeight !== right.estimatedHeight
  ) {
    return false;
  }
  if (left.kind === 'message' && right.kind === 'message') return left.payload === right.payload;
  if (left.kind === 'turn-work-fold' && right.kind === 'turn-work-fold') {
    return left.fold.rootUserMessageId === right.fold.rootUserMessageId
      && left.fold.durationMs === right.fold.durationMs
      && left.fold.expanded === right.fold.expanded;
  }
  return false;
}
