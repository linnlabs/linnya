import { isRecord } from '../../../utils/typeGuards';

/**
 * 读取 todo_read 的 items 数量（用于 UI 层的“空结果优化”）。
 *
 * 约束：
 * - 这里只做“结构化读取”，不做猜测式修复；解析失败就按 0 处理。
 * - 仅用于 UI 折叠/挂载策略，不影响工具执行语义。
 */
export function readTodoItemCountFromResult(result: unknown): number {
  if (!isRecord(result)) return 0;
  const data = isRecord(result['data']) ? result['data'] : result;
  if (!isRecord(data)) return 0;
  const items = data['items'];
  return Array.isArray(items) ? items.length : 0;
}

/**
 * 读取工具错误诊断文本。
 *
 * 约束：
 * - `tool_output.error` 是执行层提供的正式失败原因，通用错误卡直接展示；
 * - 失败不得伪装进 `data.error`，Renderer 也不兼容该旧形状。
 */
export function readToolErrorDiagnostic(toolResult: unknown): string | undefined {
  if (!isRecord(toolResult)) return undefined;
  const errorValue = toolResult['error'];
  if (typeof errorValue !== 'string') return undefined;
  return errorValue.trim() || undefined;
}

/**
 * 投影通用工具错误正文。
 *
 * error 是工具失败的正式原因，observation 是同一事件给 Agent 的补充说明；两者都存在且不重复时才并列展示。
 * fallback 只处理上游确实没有提供任何错误文本的协议缺口，不能覆盖真实错误。
 */
export function projectToolErrorMessage(params: {
  readonly toolResult: unknown;
  readonly observation: string;
  readonly fallback: string;
}): string {
  const diagnostic = readToolErrorDiagnostic(params.toolResult);
  const observation = params.observation.trim() || undefined;
  if (!diagnostic) return observation ?? params.fallback;
  if (!observation || observation === diagnostic || diagnostic.includes(observation)) return diagnostic;
  return `${diagnostic}\n\n${observation}`;
}
