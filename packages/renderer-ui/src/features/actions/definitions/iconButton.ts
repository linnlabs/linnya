/**
 * 纯图标按钮的外框与图标尺寸：
 * - xs：20px / 14px，文字行内的密集操作；命中区向外扩到 24px；
 * - sm：24px / 18px，Header、侧栏行、消息与卡片上的操作；
 * - md：28px / 18px，面板与对话框标题行的关闭等操作；
 * - lg：32px / 20px，与 32px 输入框、选择器并排的操作。
 */
export type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * - ghost：透明底，悬停出现 hover 底色；绝大多数图标按钮使用它；
 * - subtle：静止即有浅底，用于表单里与输入框并排、需要被看见的添加类操作；
 * - overlay：叠在图片、视频等内容之上，白色图标，悬停出现半透明白底。颜色不随主题变化，
 *   承载它的半透明深色底条由容器提供。
 */
export type IconButtonVariant = 'ghost' | 'subtle' | 'overlay';

/** danger 静止保持中性、悬停显示错误色，用于行内删除与移除。 */
export type IconButtonTone = 'neutral' | 'danger';

export type IconButtonType = 'button' | 'submit' | 'reset';

export interface IconButtonProps {
  /** 可访问名称，必填；默认同时作为原生提示。 */
  readonly label: string;
  readonly size?: IconButtonSize;
  readonly variant?: IconButtonVariant;
  readonly tone?: IconButtonTone;
  /**
   * 选中或展开的视觉状态（切换开关、下拉已打开），强调色浅底，与 ToolbarButton 一致。
   * 语义由调用方补充 aria-pressed 或 aria-expanded，组件不猜测。
   */
  readonly active?: boolean;
  readonly disabled?: boolean;
  /** 外层已有 HoverTooltip 等自定义提示时关闭原生 title，避免出现两个提示。 */
  readonly tooltip?: boolean;
  readonly type?: IconButtonType;
}

export interface IconButtonSlots {
  /** 单个图标组件；尺寸由 size 决定，调用方不再给图标写宽高。 */
  readonly default?: () => unknown;
}

export interface IconButtonExposed {
  /** 原生按钮元素，供下拉、浮层定位锚点使用。 */
  readonly element: HTMLButtonElement | null;
}
