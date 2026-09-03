import type { Component } from 'vue';
import type { SubRunTraceEvent } from '@linnlabs/linnkit/contracts';

export declare const SubrunCard: Component;

/** 插件只引用 Runtime trace kind，不得维护 Host 私有枚举。 */
export type HistoricalSubrunTraceKind = SubRunTraceEvent['kind'];

/** 插件 subrun 卡按需读取历史过程时使用的宿主契约。 */
export interface HistoricalSubrunTraceLazySource {
  readonly conversationId: string;
  readonly parentToolCallId: string;
  /** 卡片加载历史前必须把自身 subrunId 补入；父工具运行时绑定阶段可以暂缺。 */
  readonly subrunId?: string;
  readonly kinds: readonly HistoricalSubrunTraceKind[];
}
