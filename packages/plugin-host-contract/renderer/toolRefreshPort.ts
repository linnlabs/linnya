import type { ComputedRef, Ref } from 'vue';

export interface RendererToolRefreshTriggerParams {
  readonly toolName: ComputedRef<string> | Ref<string>;
  readonly toolArgs: ComputedRef<Record<string, unknown>> | Ref<Record<string, unknown>>;
  readonly toolResult: ComputedRef<unknown> | Ref<unknown>;
  readonly status: ComputedRef<string> | Ref<string>;
  readonly messageId?: ComputedRef<string | undefined> | Ref<string | undefined>;
  readonly conversationId?: ComputedRef<string | undefined> | Ref<string | undefined>;
}

export interface RendererToolRefreshHandler {
  readonly id: string;
  /**
   * 描述该 handler 关心的工具名。
   *
   * 中文说明：toolName 在工具卡生命周期内可能从占位值变成真实工具名，
   * 因此宿主不能在 setup 阶段用它做一次性硬过滤；handler 自己必须在
   * 响应式 trigger 内再次判断。
   */
  readonly shouldHandle?: (toolName: string) => boolean;
  readonly useTrigger: (params: RendererToolRefreshTriggerParams) => void;
}

export declare function registerRendererToolRefreshHandler(handler: RendererToolRefreshHandler): void;
export declare function unregisterRendererToolRefreshHandler(id: string): void;
