import type { DefineComponent } from 'vue';

/** 动效表达由工具选择，执行态与动画实现仍由 Host 统一持有。 */
export type ToolActivityTextEffect = 'shimmer' | 'pulse' | 'none';

export interface ToolActivityIndicatorProps {
  readonly runningLabel?: string;
  readonly compact?: boolean;
  readonly effect?: ToolActivityTextEffect;
}

export declare const ToolActivityIndicator: DefineComponent<ToolActivityIndicatorProps>;
