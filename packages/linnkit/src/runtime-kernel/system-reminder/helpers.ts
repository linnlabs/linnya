export function readNonEmptyStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

export function toDisplayStep(nodeSwitches: number): number {
  return Math.ceil(nodeSwitches / 2);
}

function isRuntimeEventLike(value: unknown): value is { type: unknown } {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'type' in value;
}

/**
 * 统计“本轮请求内”的工具调用次数（LLM 决策层）。
 *
 * 中文备注：只统计最后一个 user_input 之后的 tool_call_decision，避免旧事件或 ToolNode
 * 复用 action 语义时把同一轮工具调用重复计数。
 */
export function countToolCallsInCurrentRequest(history: ReadonlyArray<unknown>): number {
  let startIdx = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const event = history[index];
    if (!isRuntimeEventLike(event)) continue;
    if (event.type === 'user_input') {
      startIdx = index + 1;
      break;
    }
  }

  let count = 0;
  for (let index = startIdx; index < history.length; index += 1) {
    const event = history[index];
    if (!isRuntimeEventLike(event)) continue;
    if (event.type === 'tool_call_decision') {
      count += 1;
    }
  }
  return count;
}
