import type { ThemeSpec } from '@plugin/slides/shared';
import { assertCanonicalHexColor } from '@plugin/slides/shared/visual';

/** 与未声明背景的页面渲染默认值一致。 */
const UNTHEMED_SLIDE_BACKGROUND = '#FFFFFF';

/**
 * 新空白页沿用文稿主题声明的页面背景；主题没有声明时与默认空白页同为白色。
 * 读取的是当前修订持久化时已规范化的 DeckSpec.theme，不执行或解析源码表达式。
 */
export function resolveInsertedSlideBackgroundColor(theme: ThemeSpec | undefined): string {
  const declared = theme?.colors?.background;
  return declared === undefined
    ? UNTHEMED_SLIDE_BACKGROUND
    : assertCanonicalHexColor(declared, 'theme.colors.background');
}
