import type JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

interface ShapeTextAutofitEntry {
  readonly marker: string;
  readonly originalName: string | undefined;
  readonly layout: ShapeTextAutofitValues;
}

export interface ShapeTextAutofitValues {
  readonly fontScale: number;
  readonly lineSpacingReduction: number;
}
export type ShapeTextAutofitLayouts = readonly (readonly ShapeTextAutofitValues[])[];

export interface ShapeTextAutofitPlan {
  readonly slides: Map<number, ShapeTextAutofitEntry[]>;
}

export interface ShapeTextAutofitContext {
  readonly plan: ShapeTextAutofitPlan;
  readonly slideIndex: number;
  readonly layouts: readonly ShapeTextAutofitValues[];
}

export function createShapeTextAutofitPlan(): ShapeTextAutofitPlan {
  return { slides: new Map() };
}

/** 只记录编译对象；字体预热与排版由 Host 提前完成，不修改作者事实。 */
export function registerShapeTextAutofit(
  context: ShapeTextAutofitContext,
  originalName: string | undefined
): string {
  const entries = context.plan.slides.get(context.slideIndex) ?? [];
  context.plan.slides.set(context.slideIndex, entries);
  const marker = `linnya-autofit:${context.slideIndex}-${entries.length}`;
  const layout = context.layouts[entries.length];
  if (!layout) throw new Error(`Shape text autofit 缺少预先计算的布局 ${marker}`);
  entries.push({ marker, originalName, layout });
  return marker;
}

/** PptxGenJS 仅输出空 normAutofit；Office 首次打开不会代为计算缩字结果。 */
export async function applyShapeTextAutofit(
  zip: JSZip,
  plan: ShapeTextAutofitPlan | undefined
): Promise<boolean> {
  if (!plan || plan.slides.size === 0) return false;
  for (const [index, entries] of plan.slides) {
    const path = `ppt/slides/slide${index + 1}.xml`;
    const file = zip.file(path);
    if (!file) throw new Error(`Shape text autofit 缺少 ${path}`);
    const doc = new DOMParser().parseFromString(await file.async('text'), 'application/xml');
    const shapes = Array.from(doc.getElementsByTagName('p:sp'));
    for (const entry of entries) {
      const shape = shapes.find(
        shape => shape.getElementsByTagName('p:cNvPr')[0]?.getAttribute('name') === entry.marker
      );
      const nonVisual = shape?.getElementsByTagName('p:cNvPr')[0];
      const autofit = shape?.getElementsByTagName('a:normAutofit')[0];
      const layout = entry.layout;
      if (!nonVisual || !autofit) throw new Error(`Shape text autofit 无法匹配 ${entry.marker}`);
      if (layout.fontScale < 1)
        autofit.setAttribute('fontScale', String(Math.round(layout.fontScale * 100_000)));
      if (layout.lineSpacingReduction > 0)
        autofit.setAttribute(
          'lnSpcReduction',
          String(Math.round(layout.lineSpacingReduction * 100_000))
        );
      // Paint 后处理还需要原 marker；没有 Paint 的对象恢复常规名称。
      nonVisual.setAttribute('name', entry.originalName ?? `Shape ${nonVisual.getAttribute('id')}`);
    }
    zip.file(path, new XMLSerializer().serializeToString(doc));
  }
  return true;
}
