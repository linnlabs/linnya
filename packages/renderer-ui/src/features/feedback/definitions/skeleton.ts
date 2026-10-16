/**
 * 加载占位（骨架）。
 * Skeleton 是带读屏文案与延迟出现的容器；SkeletonBlock 是单个形状；SkeletonRows 模拟列表行。
 * 占位只在加载超过 --delay-reveal 后才淡入，短于此的加载不产生闪烁。
 */
export interface SkeletonProps {
  /** 读屏文案，例如“正在加载项目”；视觉上不显示。 */
  readonly label: string;
  /** 为 false 时立即显示，用于已经确定需要较长时间的加载。 */
  readonly delayed?: boolean;
}

export type SkeletonBlockRadius = 'sm' | 'md' | 'lg' | 'full';

export interface SkeletonBlockProps {
  /** CSS 宽度，默认占满。 */
  readonly width?: string;
  /** CSS 高度，默认 10px（一行文字的视觉高度）。 */
  readonly height?: string;
  readonly radius?: SkeletonBlockRadius;
}

/**
 * - sm：28px 单行（下拉、紧凑列表）；
 * - md：32px 单行（侧栏与导航行）；
 * - lg：双行带 32px 图标（插件、卡片式列表）。
 */
export type SkeletonRowsSize = 'sm' | 'md' | 'lg';

export interface SkeletonRowsProps extends SkeletonProps {
  readonly rows?: number;
  readonly size?: SkeletonRowsSize;
  /** 行首图标占位。 */
  readonly icon?: boolean;
  /** 行尾短占位（时间、数量、开关）。 */
  readonly trailing?: boolean;
}

export interface SkeletonSlots {
  readonly default?: () => unknown;
}
