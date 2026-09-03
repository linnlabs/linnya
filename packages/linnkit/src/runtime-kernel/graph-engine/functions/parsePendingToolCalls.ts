import { ToolCallWire } from '../../../contracts';
import type { StandardToolCall } from '../types';

/**
 * checkpoint 的 local 数据来自持久化边界，不能依赖 EngineState 的静态类型跳过校验。
 * ToolCallWire 是工具调用身份与字段结构的合同 owner；解析完成后才进入 Graph 内部执行。
 */
export function parsePendingToolCalls(value: unknown): StandardToolCall[] {
  return ToolCallWire.array().parse(value);
}
