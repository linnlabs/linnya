import type { GeneratedLayoutConstraintEvidence, GeneratedLayoutBox } from '../definitions/generatedLayoutConstraintEvidence';
import type { SlidesEditableTextContent } from '../../authoringEditing';
import { measureGeneratedTextHeight } from './measureGeneratedTextHeight';

/** 独立绝对文字的宽度不影响兄弟；自动高度只重放编译器已声明的同源测量事实。 */
export function projectIndependentTextWidth(
  evidence: GeneratedLayoutConstraintEvidence,
  width: number,
  content?: SlidesEditableTextContent,
): GeneratedLayoutBox | null {
  const declared = evidence.declared;
  if (evidence.positionMode !== 'absolute' || declared.leftInches === undefined
    || declared.widthInches === undefined
    || declared.minWidthInches !== undefined || declared.maxWidthInches !== undefined) return null;
  if (declared.heightInches !== undefined) return { ...evidence.finalBox, w: width };
  if (!evidence.textHeightMeasurement || content === undefined || declared.topInches === undefined
    || declared.bottomInches !== undefined) return null;
  const text = typeof content === 'string' ? content : content.map(run => run.text).join('');
  // Yoga 的点数参数经过 float32；在换行临界宽度上也必须重放相同输入。
  const height = measureGeneratedTextHeight(text, Math.fround(width * 72) / 72, evidence.textHeightMeasurement);
  return { ...evidence.finalBox, w: width,
    h: Math.round(Math.max(declared.minHeightInches ?? 0, Math.min(declared.maxHeightInches ?? Infinity, height)) * 10_000) / 10_000,
  };
}
