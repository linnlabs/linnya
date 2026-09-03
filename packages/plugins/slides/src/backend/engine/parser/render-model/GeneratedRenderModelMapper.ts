import type {
  FreeformElement,
  SlideEntry,
  StructuredElement,
  SvgGraphicResolvedAsset,
  TextStyle,
} from '@plugin/slides/shared';
import { resolveShapeGeometry } from '@plugin/slides/shared';
import type {
  GroupRenderNode,
  RenderNode,
  ShapeRenderNode,
  SlideRenderModel,
  TextRenderNode,
} from '@plugin/slides/shared';
import { buildGeneratedEditableTarget } from './RenderModelEditable.js';
import {
  makeBaseNode,
  relativizeGroupChildren,
  resolveAssetRef,
  resolveBackground,
  resolveFill,
  resolveGeneratedLayoutKey,
  resolveImageVisualShadow,
  resolveShadow,
  resolveStroke,
  toRenderBox,
} from './RenderModelShared.js';
import type {
  RenderBaseNode,
  RenderDefaultsContext,
} from './RenderModelShared.js';
import {
  IDENTITY_TRANSFORM,
  applyFreeformTransform,
  buildFreeformParagraphs,
  buildGroupTransform,
  buildGeneratedShapeTextNode,
  buildGeneratedTextRenderNode,
  buildParagraphs,
  type FreeformTransform,
  PPTX_DEFAULT_TEXT_INSET,
  resolveTextVerticalAlign,
} from './RenderModelText.js';
import {
  mapStructuredChartNode,
  mapStructuredTableNode,
} from './RenderModelStructured.js';
import { compileMathFormula } from '../../mathFormula/compiler/compileMathFormula';

export function mapGeneratedSlide(
  entry: SlideEntry,
  index: number,
  defaults: RenderDefaultsContext,
  svgAssets: ReadonlyMap<string, SvgGraphicResolvedAsset>,
): SlideRenderModel {
  return {
    slideId: `s${entry.slideNumber}`,
    index,
    layoutKey: resolveGeneratedLayoutKey(entry.spec),
    background: resolveBackground(entry.spec),
    elements: mapGeneratedElements(entry.slideNumber, entry.spec, defaults, svgAssets),
  };
}

function resolveImageFitMode(
  fitMode: 'cover' | 'contain' | 'crop' | undefined,
): 'cover' | 'contain' {
  return fitMode === 'cover' || fitMode === 'crop' ? 'cover' : 'contain';
}

function mapGeneratedElements(
  slideNumber: number,
  spec: SlideEntry['spec'],
  defaults: RenderDefaultsContext,
  svgAssets: ReadonlyMap<string, SvgGraphicResolvedAsset>,
): RenderNode[] {
  if (spec.type === 'structured') {
    return spec.elements.map((element, index) =>
      mapStructuredElement(slideNumber, element, index, defaults, svgAssets),
    );
  }

  return spec.elements.flatMap((element, index) =>
    mapFreeformElement(slideNumber, element, index, IDENTITY_TRANSFORM, defaults, svgAssets),
  );
}

function mapStructuredElement(
  slideNumber: number,
  element: StructuredElement,
  zIndex: number,
  defaults: RenderDefaultsContext,
  svgAssets: ReadonlyMap<string, SvgGraphicResolvedAsset>,
): RenderNode {
  const elementId = `s${slideNumber}-generated-${zIndex}`;
  const base = makeBaseNode(
    elementId,
    toRenderBox(element.position),
    zIndex,
    buildGeneratedEditableTarget(slideNumber, elementId, element),
    element._sourceSpan,
    element._layoutConstraintEvidence,
  );

  switch (element.type) {
    case 'title':
    case 'text': {
      const paragraphs = buildParagraphs(
        element.content,
        element,
        element.style ?? {},
        element.type === 'title' ? defaults.majorFontFamily : defaults.minorFontFamily,
      );
      return buildGeneratedTextRenderNode(
        {
          ...base,
          kind: 'text',
          paragraphs,
        },
        paragraphs,
        resolveTextVerticalAlign(element.style?.valign),
        {
          padding: PPTX_DEFAULT_TEXT_INSET,
          autoFitPolicy: 'resize-shape',
          wrap: element.textWrap,
        },
      );
    }
    case 'bulletList':
    case 'numberedList': {
      const paragraphs = buildParagraphs('', element, element.style ?? {}, defaults.minorFontFamily);
      return buildGeneratedTextRenderNode(
        {
          ...base,
          kind: 'text',
          paragraphs,
        },
        paragraphs,
        resolveTextVerticalAlign(element.style?.valign),
        {
          padding: PPTX_DEFAULT_TEXT_INSET,
          autoFitPolicy: 'resize-shape',
        },
      );
    }
    case 'shape':
      return {
        ...base,
        kind: 'shape',
        geometry: resolveShapeGeometry(element.geometry),
        fill: resolveFill(element.style?.paint, element.style?.fill, element.style?.gradient),
        stroke: resolveStroke(element.style?.border),
        cornerRadius: element.style?.borderRadius,
        shadow: resolveShadow(element.style?.shadow),
        opacity: element.style?.opacity,
        rotation: element.style?.rotate,
        innerText: element.text
          ? buildGeneratedShapeTextNode(
            makeBaseNode(`${base.id}-inner`, base.box, zIndex),
            element.text,
            {},
            defaults.minorFontFamily,
            element.style?.rotate,
          )
          : undefined,
      };
    case 'image':
      const imageMaskShape = element.maskShape === 'circle' || element.rounding ? 'circle' : element.maskShape;
      return {
        ...base,
        kind: 'image',
        assetRef: resolveAssetRef(element.src),
        fitMode: resolveImageFitMode(element.fitMode),
        alt: element.alt,
        borderRadius: undefined,
        maskShape: imageMaskShape,
        flipH: element.flipH,
        flipV: element.flipV,
        shadow: resolveImageVisualShadow(element.shadow),
        rotation: element.rotate,
        opacity: element.transparency != null ? 1 - element.transparency : undefined,
      };
    case 'svgGraphic': {
      const asset = requireSvgGraphicAsset(element.asset.assetId, svgAssets);
      return {
        ...base,
        kind: 'svgGraphic',
        canonicalSvg: asset.canonicalSvg,
        contentHash: asset.contentHash,
        viewBox: asset.viewBox,
        fit: element.fit,
        altText: element.altText,
        decorative: element.decorative === true,
        rotation: element.rotate,
        opacity: element.opacity,
      };
    }
    case 'formula': {
      const projection = compileMathFormula(element.source).renderProjection;
      return {
        ...base,
        kind: 'formula',
        ...projection,
      };
    }
    case 'table':
      return mapStructuredTableNode(base, element, defaults);
    case 'chart':
      return mapStructuredChartNode(base, element, defaults);
  }
}

function mapFreeformElement(
  slideNumber: number,
  element: FreeformElement,
  zIndex: number,
  transform: FreeformTransform,
  defaults: RenderDefaultsContext,
  svgAssets: ReadonlyMap<string, SvgGraphicResolvedAsset>,
): RenderNode[] {
  if (element.type === 'group') {
    return [mapFreeformGroup(slideNumber, element, zIndex, transform, defaults, svgAssets)];
  }

  const elementId = `s${slideNumber}-freeform-${zIndex}`;
  const base = makeBaseNode(
    elementId,
    toRenderBox(applyFreeformTransform(element.position, transform)),
    zIndex,
    buildGeneratedEditableTarget(slideNumber, elementId, element),
    element._sourceSpan,
    element._layoutConstraintEvidence,
  );

  switch (element.type) {
    case 'text':
      return [mapFreeformTextNode(base, element, defaults)];
    case 'shape':
      return [mapFreeformShapeNode(base, element, defaults)];
    case 'image':
      const imageMaskShape = element.maskShape === 'circle' || element.rounding ? 'circle' : element.maskShape;
      return [{
        ...base,
        kind: 'image',
        assetRef: resolveAssetRef(element.src),
        fitMode: resolveImageFitMode(element.fitMode),
        alt: element.alt,
        borderRadius: undefined,
        maskShape: imageMaskShape,
        flipH: element.flipH,
        flipV: element.flipV,
        shadow: resolveImageVisualShadow(element.shadow),
        rotation: element.rotate,
        opacity: element.transparency != null ? 1 - element.transparency : undefined,
      }];
    case 'svgGraphic': {
      const asset = requireSvgGraphicAsset(element.asset.assetId, svgAssets);
      return [{
        ...base,
        kind: 'svgGraphic',
        canonicalSvg: asset.canonicalSvg,
        contentHash: asset.contentHash,
        viewBox: asset.viewBox,
        fit: element.fit,
        altText: element.altText,
        decorative: element.decorative === true,
        rotation: element.rotate,
        opacity: element.opacity,
      }];
    }
    case 'formula': {
      const projection = compileMathFormula(element.source).renderProjection;
      return [{
        ...base,
        kind: 'formula',
        ...projection,
      }];
    }
  }
}

function mapFreeformGroup(
  slideNumber: number,
  element: Extract<FreeformElement, { type: 'group' }>,
  zIndex: number,
  parentTransform: FreeformTransform,
  defaults: RenderDefaultsContext,
  svgAssets: ReadonlyMap<string, SvgGraphicResolvedAsset>,
): GroupRenderNode {
  const groupId = `s${slideNumber}-freeform-${zIndex}`;
  const groupBox = toRenderBox(applyFreeformTransform(element.position, parentTransform));
  const base = makeBaseNode(
    groupId,
    groupBox,
    zIndex,
    buildGeneratedEditableTarget(slideNumber, groupId, element),
    element._sourceSpan,
    element._layoutConstraintEvidence,
  );
  if (!element.children?.length) {
    return {
      ...base,
      kind: 'group',
      children: [],
    };
  }

  const groupTransform = buildGroupTransform(element, parentTransform);
  // children 在递归 mapFreeformElement 时使用了已累计 group origin 的 groupTransform，
  // 所以产出的 box 是 slide 全局绝对坐标；在 mapper 出口统一转相对，
  // 详见 CONTRACTS §4.7 GroupRenderNode 坐标契约。
  const node: GroupRenderNode = {
    ...base,
    kind: 'group',
    children: element.children.flatMap((child, index) =>
      mapFreeformElement(
        slideNumber,
        child,
        zIndex * 100 + index,
        groupTransform,
        defaults,
        svgAssets,
      ),
    ),
  };
  return relativizeGroupChildren(node);
}

function requireSvgGraphicAsset(
  assetId: string,
  svgAssets: ReadonlyMap<string, SvgGraphicResolvedAsset>,
): SvgGraphicResolvedAsset {
  const asset = svgAssets.get(assetId);
  if (!asset) {
    throw new Error('Generated RenderModel requires resolved SVG Graphic content.');
  }
  return asset;
}

function mapFreeformTextNode(
  base: RenderBaseNode,
  element: Extract<FreeformElement, { type: 'text' }>,
  defaults: RenderDefaultsContext,
): TextRenderNode {
  const style = resolveFreeformTextStyle(element.style);
  const paragraphs = buildFreeformParagraphs(element.content, style, defaults.minorFontFamily);
  return buildGeneratedTextRenderNode(
    {
      ...base,
      kind: 'text',
      paragraphs,
    },
    paragraphs,
    resolveTextVerticalAlign(style.valign),
    {
      padding: PPTX_DEFAULT_TEXT_INSET,
      autoFitPolicy: 'resize-shape',
      wrap: element.textWrap,
    },
  );
}

function mapFreeformShapeNode(
  base: RenderBaseNode,
  element: Extract<FreeformElement, { type: 'shape' }>,
  defaults: RenderDefaultsContext,
): ShapeRenderNode {
  return {
    ...base,
    kind: 'shape',
    geometry: resolveShapeGeometry(element.geometry),
    fill: resolveFill(element.style?.paint, element.style?.fill, element.style?.gradient),
    stroke: resolveStroke(element.style?.border),
    // 与 mapStructuredElement 'shape' 分支严格对齐（CONTRACTS §4.4 / §2.4）：
    // 必须把 ShapeStyle.borderRadius 透传到 ShapeRenderNode.cornerRadius，
    // 否则 shapeBuilder 会回退到 OOXML 默认 adj = 16667/100000 ≈ 短边/6 的小圆角，
    // 导致同一份 spec 在 freeform 和 structured 两条线上 pill 视觉不一致。
    cornerRadius: element.style?.borderRadius,
    shadow: resolveShadow(element.style?.shadow),
    opacity: element.style?.opacity,
    rotation: element.style?.rotate,
    innerText: typeof element.content === 'string'
      ? buildGeneratedShapeTextNode(
        makeBaseNode(`${base.id}-inner`, base.box, base.zIndex),
        element.content,
        resolveFreeformTextStyle(element.style),
        defaults.minorFontFamily,
        element.style?.rotate,
      )
      : undefined,
  };
}

function resolveFreeformTextStyle(
  style: FreeformElement['style'],
): TextStyle {
  if (!style) {
    return {};
  }

  return {
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,
    color: style.color,
    align: style.align,
    valign: style.valign,
    letterSpacing: style.letterSpacing,
    lineSpacing: style.lineSpacing,
  };
}
