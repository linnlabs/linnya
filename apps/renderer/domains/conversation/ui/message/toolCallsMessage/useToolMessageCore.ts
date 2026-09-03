/**
 * @file useToolMessageCore.ts
 * @description ToolCallsMessage 的核心数据层：读取已经通过消息投影边界校验的工具 metadata。
 */

import { computed, type ComputedRef, type Ref } from 'vue';
import type { ToolCallMessage } from '../../../types';
import {
  type ConversationToolMessageStatus,
} from '@app/schemas';
import { buildToolResultFromMessage } from '../../../services/message/tool/buildToolResultFromMessage';

export interface ToolMessageCoreModel {
  toolCallId: ComputedRef<string>;
  toolName: ComputedRef<string>;
  toolArgs: ComputedRef<Record<string, unknown>>;
  toolResult: ComputedRef<unknown>;
  status: ComputedRef<ConversationToolMessageStatus>;
  isLoading: ComputedRef<boolean>;
  hasContent: ComputedRef<boolean>;
  subrunTrace: ComputedRef<unknown | null>;
  /**
   * subrun_trace 增量版本号（轻量 number）
   *
   * 中文说明：
   * - 配合投影器 `projectSubRunTraceEvent` 的 `subrunTraceVersion`；
   * - UI 侧只 watch 这个 number，避免 watch 巨大的 events 数组导致响应式雪崩。
   */
  subrunTraceVersion: ComputedRef<number>;
}

export function useToolMessageCore(message: Ref<ToolCallMessage>): ToolMessageCoreModel {
  // 消息只能由严格 projector/DTO mapper 创建；组件层禁止再次猜测 metadata 形状。
  const metadata = computed(() => message.value.metadata);
  const toolCallId = computed(() => metadata.value.tool_call_id);
  const toolName = computed(() => metadata.value.tool_name);

  const toolArgs = computed<Record<string, unknown>>(() => {
    // 无参数工具的正式 args 可以省略；空对象只表达“没有参数”，不承担合同兜底。
    return metadata.value.args ?? {};
  });

  const status = computed(() => metadata.value.status);
  const isLoading = computed(() => status.value === 'loading');
  const hasContent = computed(() => {
    const content = message.value.content;
    // 严格返回 boolean：避免 `a && b` 产生 `string | boolean` 的类型漂移
    return typeof content === 'string' && content.trim().length > 0;
  });

  const toolResult = computed<unknown>(() => {
    return buildToolResultFromMessage(message.value.content, metadata.value);
  });

  const subrunTrace = computed<unknown | null>(() => {
    return metadata.value.subrunTrace ?? null;
  });

  const subrunTraceVersion = computed<number>(() => {
    return metadata.value.subrunTraceVersion ?? 0;
  });

  return {
    toolCallId,
    toolName,
    toolArgs,
    toolResult,
    status,
    isLoading,
    hasContent,
    subrunTrace,
    subrunTraceVersion,
  };
}
