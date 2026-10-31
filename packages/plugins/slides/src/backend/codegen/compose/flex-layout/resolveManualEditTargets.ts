import { parseSlidesManualEdits, type FlexComposeInput, type LayoutNode, type SlidesManualSlideEdits } from '@plugin/slides/shared';
import type { ParseCodegenDiagnostic } from '../../writeDiagnostics/definitions/codegenDiagnostic.js';

/** 先严格解析值，再解析目标；失联只停用目标，绝不吞掉非法人工值。 */
export function resolveManualEditTargets(input: FlexComposeInput): {
  readonly slides: readonly SlidesManualSlideEdits[];
  readonly diagnostics: readonly ParseCodegenDiagnostic[];
} {
  if (input.manualEdits === undefined) return { slides: [], diagnostics: [] };
  const parsed = parseSlidesManualEdits(input.manualEdits);
  if ('error' in parsed) throw new Error(parsed.error);
  const diagnostics: ParseCodegenDiagnostic[] = [];
  function suspended(slideKey: string, editKey: string): void {
    diagnostics.push({ phase: 'parse', severity: 'warning', code: 'manual_edit_suspended',
      path: `manualEdits.${slideKey}.${editKey}`,
      message: `人工修改 ${slideKey}/${editKey} 的原对象已不存在或生成逻辑已变化，本次停用；原值仍保留在 deck.js。`,
      hint: '读取当前源码并明确重绑或清理该记录。不要按相同文字、位置或循环序号猜测对象。' });
  }
  const slides = parsed.value.slides.flatMap(edits => {
    const slide = input.slides.find(node => node.slideKey === edits.slideKey);
    const keys = new Set(edits.additions?.map(node => node.editKey));
    function visit(node: LayoutNode): void {
      if ('editKey' in node && node.editKey) keys.add(node.editKey);
      if ('children' in node) node.children.forEach(visit);
    }
    if (slide) visit(slide);
    const targets = edits.targets.filter(target => {
      if (slide && keys.has(target.editKey)) return true;
      suspended(edits.slideKey, target.editKey);
      return false;
    });
    if (!slide) {
      for (const addition of edits.additions ?? []) suspended(edits.slideKey, addition.editKey);
      return [];
    }
    for (const key of edits.paintOrder ?? []) if (!keys.has(key)) suspended(edits.slideKey, `paintOrder.${key}`);
    return [{ ...edits, targets, ...(edits.paintOrder ? { paintOrder: edits.paintOrder.filter(key => keys.has(key)) } : {}) }];
  });
  return { slides, diagnostics };
}
