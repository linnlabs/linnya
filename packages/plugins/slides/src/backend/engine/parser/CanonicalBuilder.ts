/**
 * CanonicalBuilder
 *
 * 从 PresentationInfo 构建 CanonicalDeck。
 * 为每个 slide 和 element 生成稳定 ID，弱化对 elementName 的依赖。
 */

import type { PresentationInfo, SlideElementInfo, SlideInfo } from '@plugin/slides/shared';
import type {
  CanonicalDeck,
  CanonicalElement,
  CanonicalRole,
  CanonicalSlide,
  CanonicalVisualHints,
} from '@plugin/slides/shared';

export class CanonicalBuilder {
  /**
   * 从 PresentationInfo 构建 CanonicalDeck。
   * 同时会回写 elementId 到 info.slides[].elements[]（如果尚未设置）。
   */
  build(
    nodeId: string,
    versionNumber: number,
    title: string,
    info: PresentationInfo,
  ): CanonicalDeck {
    const slides = info.slides.map((slide) => this.buildSlide(slide));

    return {
      nodeId,
      versionNumber,
      title,
      slideSize: { ...info.slideSize },
      slides,
      theme: info.theme,
      masterCount: info.masters.length,
    };
  }

  /** 为 PresentationInfo 中的元素回写 elementId（就地修改） */
  enrichElementIds(info: PresentationInfo): void {
    for (const slide of info.slides) {
      for (let i = 0; i < slide.elements.length; i++) {
        this.enrichElementId(slide.elements[i], slide.number, [i]);
      }
    }
  }

  private buildSlide(slide: SlideInfo): CanonicalSlide {
    const elements = slide.elements.map((el, index) =>
      this.buildElement(el, slide.number, [index]),
    );

    return {
      slideId: `s${slide.number}`,
      number: slide.number,
      layoutName: slide.layoutName,
      backgroundPaint: slide.backgroundPaint,
      elements,
    };
  }

  private buildElement(
    el: SlideElementInfo,
    slideNumber: number,
    indexPath: number[],
  ): CanonicalElement {
    const elementId = el.elementId ?? this.buildElementId(el, slideNumber, indexPath);
    // 回写到原始对象
    if (!el.elementId) {
      el.elementId = elementId;
    }
    if (el.editableTarget && !el.editableTarget.elementId) {
      el.editableTarget.elementId = elementId;
    }

    return {
      elementId,
      role: this.mapRole(el),
      text: el.text,
      paragraphs: el.paragraphs?.map((paragraph) => ({
        runs: paragraph.runs.map((run) => ({ ...run })),
        align: paragraph.align,
        lineSpacing: paragraph.lineSpacing,
        lineSpacingResolution: paragraph.lineSpacingResolution,
        spacingBeforePt: paragraph.spacingBeforePt,
        spacingAfterPt: paragraph.spacingAfterPt,
        indentInches: paragraph.indentInches,
      })),
      position: el.position ? { ...el.position } : undefined,
      zOrder: indexPath[indexPath.length - 1] ?? 0,
      rotation: el.rotation,
      visual: this.buildVisualHints(el),
      children: el.children?.map((child, childIndex) =>
        this.buildElement(child, slideNumber, [...indexPath, childIndex])),
      chartType: el.chartType,
      imageRef: el.imageRef,
      svgGraphic: el.svgGraphic,
      importFidelity: el.importFidelity,
      patchMeta: {
        creationId: el.creationId,
        elementName: el.name,
      },
    };
  }

  /**
   * 把 PptxReader 提取的视觉提示透传到 canonical：
   *   - shape：fill / shapeKind / border / cornerRadius / shadow
   *   - image：fitMode
   *   - text / shape innerText：textVerticalAlign / textAutoFit / textPadding / textWrap（来自 OOXML `bodyPr`）
   * 段落文字与行距不属于 visual hint，已通过 CanonicalElement.paragraphs 原样透传。
   * 走 generated 主链时这些字段全为 undefined，CanonicalRenderModelMapper 会优先使用 specElement。
   */
  private buildVisualHints(el: SlideElementInfo): CanonicalVisualHints | undefined {
    const shapeVisual = el.shapeVisual;
    const fill = el.fill;
    const fitMode = el.imageFit;
    const textVerticalAlign = el.textBody?.verticalAlign;
    const textAutoFit = el.textBody?.autoFit;
    const textPadding = el.textBody?.padding;
    const textWrap = el.textBody?.wrap;
    if (
      !shapeVisual
      && fill == null
      && fitMode == null
      && textVerticalAlign == null
      && textAutoFit == null
      && textPadding == null
      && textWrap == null
    ) {
      return undefined;
    }
    return {
      ...(shapeVisual ?? {}),
      ...(fill != null ? { fill } : {}),
      ...(fitMode != null ? { fitMode } : {}),
      ...(textVerticalAlign != null ? { textVerticalAlign } : {}),
      ...(textAutoFit != null ? { textAutoFit } : {}),
      ...(textPadding != null ? { textPadding } : {}),
      ...(textWrap != null ? { textWrap } : {}),
    };
  }

  /**
   * 生成稳定 elementId。
   * 优先使用 creationId（OOXML 原生），fallback 基于 slide + type/name/text/position 的确定性键。
   * 在 creationId 缺失时仍附带 index 作为末位去重，避免同位置叠层元素发生碰撞。
   */
  buildElementId(el: SlideElementInfo, slideNumber: number, indexPath: number[]): string {
    if (el.creationId) {
      return `cid-${el.creationId}`;
    }

    const parts = [`s${slideNumber}`, `t${el.type}`];
    const nameOrText = sanitizeIdPart(el.name ?? el.text);
    if (nameOrText) {
      parts.push(nameOrText);
    }

    if (el.position) {
      const { x, y, w, h } = el.position;
      parts.push(`p${r(x)}_${r(y)}_${r(w)}_${r(h)}`);
    }

    parts.push(`i${indexPath.join('_')}`);
    return parts.join('-');
  }

  private enrichElementId(
    el: SlideElementInfo,
    slideNumber: number,
    indexPath: number[],
  ): void {
    if (!el.elementId) {
      el.elementId = this.buildElementId(el, slideNumber, indexPath);
    }
    if (el.editableTarget && !el.editableTarget.elementId) {
      el.editableTarget.elementId = el.elementId;
    }
    el.children?.forEach((child, childIndex) => {
      this.enrichElementId(child, slideNumber, [...indexPath, childIndex]);
    });
  }

  private mapRole(el: SlideElementInfo): CanonicalRole {
    switch (el.type) {
      case 'text':
        return el.text && el.name?.toLowerCase().includes('title') ? 'title' : 'body';
      case 'chart': return 'chart';
      case 'table': return 'table';
      case 'image': return 'image';
      case 'svgGraphic': return 'svgGraphic';
      case 'shape': return 'shape';
      case 'group': return 'group';
      default: return 'other';
    }
  }
}

/** Round to 3 decimals for stable ID generation */
function r(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

function sanitizeIdPart(value?: string): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized) return null;
  return normalized.slice(0, 48);
}
