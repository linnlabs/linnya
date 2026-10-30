import type { SlidesTextStyleBase } from '@plugin/slides/shared/authoringEditing';
import type { TextEditingTarget } from '../definitions/textEditingTypes';

export function resolveTextEditingStyleBase(target: TextEditingTarget): SlidesTextStyleBase {
  return { fontSizePt: target.fontSizePt, color: target.color, bold: target.fontWeight === 'bold',
    italic: target.fontStyle === 'italic', underline: target.textDecoration?.includes('underline') === true };
}
