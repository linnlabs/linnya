/**
 * @file configs/resource.ts
 * @description 历史 Resource 事件的 UI 别名配置
 *
 * 设计说明：
 * - Resource executable 已退役，这里只解释已持久化的旧事件；
 * - 通过别名机制，根据历史参数（source / uri scheme）路由到领域卡片；
 * - 别名解析优先读 result.data 的稳定字段，备选读 args（覆盖历史 lifecycle 阶段）。
 */

import type { ToolUiAliasConfig } from '../types';
import { isRecord, readString } from '../registry.helpers';

// ─────────────────── resource_list ───────────────────

/**
 * resource_list 的 UI 别名解析：
 * 根据 source 参数路由到被合并前的旧工具 UI key
 *
 * 映射关系：
 * - knowledge_base -> list_knowledge_base
 * - shared_memory  -> sharedmemory_list（历史 / Deep Research 内部产物）
 */
function resolveResourceListUiKey(args: unknown, result?: unknown): string | null {
  // 优先从 result.data.source 读取（成功后字段更可靠）
  const r = isRecord(result) ? result : undefined;
  const data = r && isRecord(r['data']) ? r['data'] : undefined;
  const sourceFromResult = data ? readString(data['source']) : undefined;

  // 其次从 args.source 读取（loading 阶段 args 已可用）
  const a = isRecord(args) ? args : undefined;
  const sourceFromArgs = a ? readString(a['source']) : undefined;

  const source = sourceFromResult ?? sourceFromArgs;

  switch (source) {
    case 'knowledge_base':
      return 'list_knowledge_base';
    case 'shared_memory':
      return 'sharedmemory_list';
    default:
      return null;
  }
}

// ─────────────────── resource_read ───────────────────

function resolveResourceReadUiKeyFromUri(uri: string): string | null {
  if (uri.startsWith('kb://')) return 'knowledge_read';
  if (uri.startsWith('skill://skills/')) return 'skill_resource_read';
  if (uri.startsWith('asset://assets/')) return 'image_read';
  if (uri.startsWith('conversation_file://files/')) return 'image_read';
  if (uri.startsWith('http://') || uri.startsWith('https://')) return 'web_read';
  if (uri.startsWith('tool_output://')) return 'tool_output_read';
  if (
    uri.startsWith('shared_memory://') ||
    uri.startsWith('evidence://') ||
    uri.startsWith('citation_snapshot://')
  ) {
    return 'sharedmemory_read';
  }

  return null;
}

/**
 * resource_read 的 UI 路由优先使用稳定协议字段：
 * - 首选：`result.data.uri`
 * - 回退：`args.uri`
 *
 * 不再兼容旧历史里的“结构猜测式识别”。
 * 因此，旧 replay 数据若同时缺失 `result.data.uri` 与 `args.uri`，则视为不满足当前工具协议。
 */
export function readResourceReadUiKeyFromResult(result?: unknown): string | null {
  const r = isRecord(result) ? result : undefined;
  const data = r && isRecord(r['data']) ? r['data'] : undefined;
  if (!data) return null;

  const uri = readString(data['uri']);
  return uri ? resolveResourceReadUiKeyFromUri(uri) : null;
}

/**
 * resource_read 的 UI 别名解析：
 * 根据 URI scheme 路由到所属领域的 UI key
 *
 * URI scheme 是历史 resource_read 事件的持久化协议，协议前缀判断是确定性
 * replay 路由，不属于结构猜测，也不会重新建立 live executable。
 *
 * 映射关系：
 * - kb://                    -> knowledge_read
 * - skill://skills/...       -> skill_resource_read
 * - asset:// / conversation_file:// -> image_read
 * - http(s)://               -> web_read
 * - tool_output://           -> tool_output_read
 * - shared_memory://...      -> sharedmemory_read（历史 / Deep Research 内部产物）
 * - evidence://...           -> sharedmemory_read
 * - citation_snapshot://...  -> sharedmemory_read
 */
function resolveResourceReadUiKey(args: unknown, _result?: unknown): string | null {
  const resultKey = readResourceReadUiKeyFromResult(_result);
  if (resultKey) return resultKey;

  const a = isRecord(args) ? args : undefined;
  const uri = a ? readString(a['uri']) : undefined;
  return uri ? resolveResourceReadUiKeyFromUri(uri) : null;
}

// ─────────────────── 导出 ───────────────────

export const resourceToolConfigs: Record<string, ToolUiAliasConfig> = {
  resource_list: { resolveUiKey: resolveResourceListUiKey },
  resource_read: { resolveUiKey: resolveResourceReadUiKey },
};
