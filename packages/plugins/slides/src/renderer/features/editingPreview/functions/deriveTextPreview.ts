import {
  layoutPreparedText, PreparedTextMeasurementUnavailable, resizeTextBoxForAutoFit,
} from '@plugin/slides/shared/textLayout';
import type { TextRenderNode } from '../../../types/render';

/** 排版与样式作为一个结果交接，绝不把新字号配上旧 slice 坐标。 */
export function deriveTextPreview(input: TextRenderNode): TextRenderNode | null {
  const prepared = input.preparedTextLayout;
  if (!prepared) return null;
  try {
    const layout = layoutPreparedText(input, prepared);
    const box = input.autoFitPolicy === 'resize-shape' && layout.requiredHeightInches !== undefined
      ? resizeTextBoxForAutoFit(input.box, layout.requiredHeightInches, input.verticalAlign ?? 'top')
      : input.box;
    return { ...input, box, layout };
  } catch (error) {
    // 新 shaping 输入／不支持缩放的测量来源必须等正式修订；其他排版错误继续暴露。
    if (error instanceof PreparedTextMeasurementUnavailable) return null;
    throw error;
  }
}

/** 子树布局目前仍由作者源码编译器拥有；固定盒可在本地准确重新排版。 */
export function canRelayoutTextBox(node: TextRenderNode): boolean {
  const evidence = node.layoutConstraintEvidence;
  return !evidence || (evidence.positionMode === 'absolute'
    && evidence.declared.widthInches !== undefined && evidence.declared.heightInches !== undefined);
}
