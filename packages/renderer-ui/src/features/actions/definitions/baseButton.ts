/**
 * 按钮视觉层级。
 * - primary：页面或对话框里唯一的主操作，品牌色实底；
 * - secondary：与主操作并列的次操作，表面底色加描边；
 * - ghost：已有容器内的次要操作，透明底加描边；
 * - plain：工具栏或行内的轻操作，无底无描边；
 * - danger：不可撤销的破坏性主操作；
 * - soft：需要强调但不应抢过主操作的推荐操作，品牌色浅底；
 * - outline：页面级入口，表面底色、描边与轻投影，由 tone 表达用途。
 */
export type BaseButtonVariant = 'primary' | 'secondary' | 'ghost' | 'plain' | 'danger' | 'soft' | 'outline';

/**
 * 只作用于 outline 与 plain：accent 表达创建与主入口，info 表达导入、上传等信息流入口，
 * neutral 表达普通操作，danger 表达删除、清理等破坏性操作。
 * plain 的 danger 静止时保持中性、悬停才显示错误色，避免列表里成排出现红字。
 */
export type BaseButtonTone = 'accent' | 'info' | 'neutral' | 'danger';

/** 尺寸与 --control-height-sm/md/lg 一一对应，与同一行的输入框、选择器取同一档。 */
export type BaseButtonSize = 'sm' | 'md' | 'lg';

export type BaseButtonShape = 'default' | 'pill';

export type BaseButtonType = 'button' | 'submit' | 'reset';

export interface BaseButtonProps {
  readonly variant?: BaseButtonVariant;
  readonly tone?: BaseButtonTone;
  readonly size?: BaseButtonSize;
  readonly shape?: BaseButtonShape;
  /** 占满容器宽度；带图标时图标贴左、文字按整个按钮视觉居中。 */
  readonly block?: boolean;
  readonly disabled?: boolean;
  readonly type?: BaseButtonType;
}

export interface BaseButtonSlots {
  readonly default?: () => unknown;
  /** 前置图标，放入 14px 图标槽位；图标只辅助理解，按钮文字或 aria-label 必须能独立说明操作。 */
  readonly icon?: () => unknown;
}
