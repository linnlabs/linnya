import type { ToolExecutionContext } from './toolExecutionContext';
import type { TOOL_CONTEXT_RUNTIME_RESERVED_KEYS } from './toolContextRuntime';

type RuntimeReservedToolContextKey = (typeof TOOL_CONTEXT_RUNTIME_RESERVED_KEYS)[number];

/**
 * ToolContext patch 的最小合同。
 *
 * 中文备注：
 * - patch 只表达 host/product 追加字段，不能覆盖 runtime-owned capability；
 * - 完全 host 白名单需要由具体宿主定义，本层先在类型层排除运行时保留字段。
 */
export type ToolContextPatch =
  & Partial<Record<Exclude<string, RuntimeReservedToolContextKey>, unknown>>
  & Partial<Omit<ToolExecutionContext, RuntimeReservedToolContextKey>>;
