import type {
  FreeformSlideSpec,
  StructuredElement,
  StructuredSlideSpec,
  TextStyle,
} from '@plugin/slides/shared';
import { isPresetShapeName, resolveShapeGeometry } from '@plugin/slides/shared';
import type {
  CanonicalElement,
  CanonicalSlide,
  CanonicalTextParagraph,
  ChartRenderNode,
  GroupRenderNode,
  ImageRenderNode,
  RenderNode,
  RenderParagraph,
  ShapeRenderNode,
  SlideRenderModel,
  SvgGraphicRenderNode,
  TableRenderNode,
  TextRenderNode,
} from '@plugin/slides/shared';
import { buildCanonicalEditableTarget } from './RenderModelEditable.js';
import {
  makeBaseNode,
  relativizeGroupChildren,
  resolveAssetRef,
  resolveBackground,
  resolveChartType,
  resolveFill,
  resolveShadow,
  resolveStroke,
  toRenderBox,
} from './RenderModelShared.js';
import type { RenderBaseNode, RenderDefaultsContext } from './RenderModelShared.js';
import {
  buildParagraphs,
  buildShapeTextNode,
  PPTX_DEFAULT_TEXT_INSET,
  resolveTextVerticalAlign,
  textStyleToRun,
} from './RenderModelText.js';
import {
  mapStructuredChartNode,
  mapStructuredTableNode,
  resolveTextStyle,
} from './RenderModelStructured.js';

export function mapCanonicalSlide(
  slide: CanonicalSlide,
  index: number,
  spec: StructuredSlideSpec | FreeformSlideSpec | undefined,
  defaults: RenderDefaultsContext,
): SlideRenderModel {
  return {
    slideId: slide.slideId,
    index,
    layoutKey: slide.layoutName ?? 'unknown',
    background: spec?.background
      ? resolveBackground(spec)
      : {
          paint: slide.backgroundPaint ?? { type: 'solid', color: '#FFFFFF' },
        },
    elements: mapCanonicalElements(slide.elements, spec, defaults),
  };
}

function mapCanonicalElements(
  canonicalElements: CanonicalElement[],
  spec: StructuredSlideSpec | FreeformSlideSpec | undefined,
  defaults: RenderDefaultsContext,
): RenderNode[] {
  const specElements = spec?.type === 'structured' ? spec.elements : undefined;

  return canonicalElements
    .filter((element) => element.position != null)
    .map((element, zIndex) => {
      const matchedSpec = findMatchingSpecElement(element, specElements);
      return mapCanonicalElement(element, zIndex, matchedSpec, defaults);
    });
}

function findMatchingSpecElement(
  canonical: CanonicalElement,
  specElements: StructuredElement[] | undefined,
): StructuredElement | undefined {
  if (!specElements || !canonical.position) {
    return undefined;
  }

  // 嵌套回调内不会继承对 optional 属性的收窄，提取为 const 供 find 闭包使用
  const canonicalBox = canonical.position;

  return specElements.find((element) => {
    const delta =
      Math.abs(element.position.x - canonicalBox.x) +
      Math.abs(element.position.y - canonicalBox.y) +
      Math.abs(element.position.w - canonicalBox.w) +
      Math.abs(element.position.h - canonicalBox.h);
    return delta < 0.05;
  });
}

function mapCanonicalElement(
  element: CanonicalElement,
  zIndex: number,
  specElement: StructuredElement | undefined,
  defaults: RenderDefaultsContext,
): RenderNode {
  const position = element.position;
  if (!position) {
    throw new Error(`Canonical render mapping requires position for element ${element.elementId}`);
  }

  const base = makeBaseNode(
    element.elementId,
    toRenderBox(position),
    zIndex,
    buildCanonicalEditableTarget(element),
  );
  base.rotation = element.rotation;

  switch (element.role) {
    case 'title':
    case 'body':
      return mapTextNode(base, element, specElement, defaults);
    case 'chart':
      return mapChartNode(base, element, specElement, defaults);
    case 'table':
      return mapTableNode(base, element, specElement, defaults);
    case 'image':
      return mapImageNode(base, element);
    case 'svgGraphic':
      return mapSvgGraphicNode(base, element);
    case 'shape':
      return mapShapeNode(base, element, specElement, defaults);
    case 'group':
      return mapGroupNode(base, element, defaults);
    case 'other':
      return mapShapeNode(base, element, specElement, defaults);
  }
}

function mapSvgGraphicNode(
  base: RenderBaseNode,
  element: CanonicalElement,
): SvgGraphicRenderNode {
  const graphic = element.svgGraphic;
  if (!graphic) {
    throw new Error(`Canonical SVG Graphic ${element.elementId} is missing admitted content.`);
  }
  return {
    ...base,
    kind: 'svgGraphic',
    canonicalSvg: graphic.canonicalSvg,
    contentHash: graphic.contentHash,
    viewBox: graphic.viewBox,
    fit: graphic.fit,
    altText: graphic.altText,
    decorative: graphic.decorative,
  };
}

function mapTextNode(
  base: RenderBaseNode,
  element: CanonicalElement,
  specElement: StructuredElement | undefined,
  defaults: RenderDefaultsContext,
): TextRenderNode {
  const style = resolveTextStyle(specElement);
  const defaultFontFamily = element.role === 'title'
    ? defaults.majorFontFamily
    : defaults.minorFontFamily;
  const paragraphs = element.paragraphs && element.paragraphs.length > 0
    ? mapCanonicalParagraphs(element.paragraphs, defaultFontFamily)
    : buildParagraphs(element.text ?? '', specElement, style, defaultFontFamily);

  // 优先级：specElement.style.valign（generated 主链）> visual.textVerticalAlign（imported / patched 路径）
  // imported 路径 specElement 为 undefined，PptxReader 已经从 OOXML `bodyPr@anchor` 提取了 verticalAlign
  // 并通过 CanonicalBuilder 透传到 element.visual.textVerticalAlign。
  const verticalAlign = style.valign != null
    ? resolveTextVerticalAlign(style.valign)
    : resolveTextVerticalAlign(element.visual?.textVerticalAlign);

  return {
    ...base,
    kind: 'text',
    paragraphs,
    verticalAlign,
    autoFitPolicy: element.visual?.textAutoFit,
    padding: element.visual?.textPadding ?? PPTX_DEFAULT_TEXT_INSET,
    wrap: element.visual?.textWrap ?? 'word',
    overflow: 'clip',
  };
}

function mapShapeNode(
  base: RenderBaseNode,
  element: CanonicalElement,
  specElement: StructuredElement | undefined,
  defaults: RenderDefaultsContext,
): ShapeRenderNode {
  const shapeStyle = specElement?.type === 'shape' ? specElement.style : undefined;
  const visual = element.visual;

  // 优先级：specElement（generated 主链）> visual（PptxReader 提取的 imported / patched 提示）
  const geometry =
    specElement?.type === 'shape'
      ? resolveShapeGeometry(specElement.geometry)
      : visual?.geometry
        ? visual.geometry
        : resolveShapeGeometry(
          visual?.shapeKind && isPresetShapeName(visual.shapeKind)
            ? visual.shapeKind
            : undefined,
        );

  const fill =
    resolveFill(shapeStyle?.paint, shapeStyle?.fill, shapeStyle?.gradient)
    ?? visual?.paint
    ?? (visual?.fill ? { type: 'solid' as const, color: visual.fill } : undefined);

  const stroke = resolveStroke(shapeStyle?.border) ?? resolveStroke(visual?.border);

  const cornerRadius = shapeStyle?.borderRadius ?? visual?.cornerRadius;

  const shadow = resolveShadow(shapeStyle?.shadow) ?? resolveShadow(visual?.shadow);

  return {
    ...base,
    kind: 'shape',
    geometry,
    fill,
    stroke,
    cornerRadius,
    shadow,
    innerText: element.text
      ? buildInnerText(
          base,
          element.text,
          specElement,
          defaults.minorFontFamily,
          element.visual?.textVerticalAlign,
          element.visual?.textAutoFit,
          element.visual?.textPadding,
          element.visual?.textWrap,
          element.paragraphs,
        )
      : undefined,
  };
}

function mapImageNode(
  base: RenderBaseNode,
  element: CanonicalElement,
): ImageRenderNode {
  return {
    ...base,
    kind: 'image',
    assetRef: resolveCanonicalImageAssetRef(element.imageRef),
    // imported 默认按 OOXML `a:stretch` 行为给 'stretch'；如果 PptxReader 推断出别的（如 'fill'）就用提示值。
    // 这里不再硬编码 'contain'，避免 imported 预览与原始 PPT 行为漂移。
    fitMode: element.visual?.fitMode ?? 'stretch',
    editableTarget: base.editableTarget
      ? {
          ...base.editableTarget,
          imageEditCapabilities: { replaceSource: true, editVisuals: false },
        }
      : undefined,
  };
}

/**
 * CanonicalDeck 的 imageRef 来自 PPTX `r:embed` relationship target，语义是包内 part
 * path，不是 deck.js authoring source。两者不能共用“相对路径 = generated asset”规则。
 * data URI / HTTP(S) 仍交给统一 authoring resolver 校验，避免 imported 路径旁路远程
 * 资产禁令。
 */
function resolveCanonicalImageAssetRef(imageRef: string | undefined): ImageRenderNode['assetRef'] {
  if (
    imageRef == null
    || imageRef.startsWith('data:')
    || imageRef.startsWith('http://')
    || imageRef.startsWith('https://')
  ) {
    return resolveAssetRef(imageRef);
  }
  return { type: 'embedded', partPath: imageRef };
}

function mapGroupNode(
  base: RenderBaseNode,
  element: CanonicalElement,
  defaults: RenderDefaultsContext,
): GroupRenderNode {
  const node: GroupRenderNode = {
    ...base,
    kind: 'group',
    children: (element.children ?? [])
      .filter((child) => child.position != null)
      .map((child, childIndex) =>
        mapCanonicalElement(child, childIndex, undefined, defaults)),
  };
  // children 此时是 slide 全局绝对坐标（CanonicalBuilder 已累计 group transform）；
  // 在 mapper 出口统一转相对，详见 CONTRACTS §4.7 GroupRenderNode 坐标契约。
  return relativizeGroupChildren(node);
}

function mapTableNode(
  base: RenderBaseNode,
  element: CanonicalElement,
  specElement: StructuredElement | undefined,
  defaults: RenderDefaultsContext,
): TableRenderNode {
  if (specElement?.type === 'table') {
    return mapStructuredTableNode(base, specElement, defaults);
  }

  return {
    ...base,
    kind: 'table',
    columns: [base.box.w],
    rows: [base.box.h],
    cells: [{
      row: 0,
      col: 0,
      paragraphs: [{
        runs: [textStyleToRun(
          element.text ?? 'Table',
          { fontFamily: defaults.minorFontFamily, fontSize: 11 },
          defaults.minorFontFamily,
        )],
      }],
      fill: '#F5F5F5',
      padding: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
      verticalAlign: 'middle',
    }],
  };
}

function mapChartNode(
  base: RenderBaseNode,
  element: CanonicalElement,
  specElement: StructuredElement | undefined,
  defaults: RenderDefaultsContext,
): ChartRenderNode {
  if (specElement?.type === 'chart') {
    return mapStructuredChartNode(base, specElement, defaults);
  }

  return {
    ...base,
    kind: 'chart',
    chartType: resolveChartType(element.chartType),
    categories: [],
    series: [],
    palette: defaults.chartPalette,
  };
}

/**
 * 构造 shape 内嵌文本节点（B13 三路统一）。
 *
 * 原先三路分支严重不一致：
 *   - generated（specElement.type === 'shape'）→ buildShapeTextNode：自动算字号 + 标准 padding + autoFit shrink-text
 *   - imported（specElement undefined）→ buildTextNode：无 padding、无 autoFit、字号空 → 文字贴边、不缩字
 *   - patched（specElement 类型不匹配）→ 同上 imported
 *
 * 现在三路都走 buildShapeTextNode，使用 `resolveShapeTextLayout` 算出来的 padding/字号/autoFit；
 * 详见 CONTRACTS §4.5 shape innerText 契约。
 *
 * imported paragraph/run 的字号与字体已经由 CanonicalTextParagraph 透传；只有在原文
 * 没有可解析字号时，buildShapeTextNode 才使用 shape layout 的估算字号。
 */
function buildInnerText(
  base: RenderBaseNode,
  text: string,
  specElement: StructuredElement | undefined,
  defaultFontFamily: string,
  /** imported / patched 路径专用 fallback：来自 OOXML `bodyPr@anchor`，仅当 specElement 没指定 valign 时才生效。 */
  fallbackVerticalAlign: 'top' | 'middle' | 'bottom' | undefined,
  /** imported / patched 路径专用 fallback：来自 OOXML `bodyPr` 的 autofit 策略。 */
  fallbackAutoFitPolicy: TextRenderNode['autoFitPolicy'] | undefined,
  /** imported / patched 路径专用 fallback：来自 OOXML `bodyPr` 的 padding。 */
  fallbackPadding: TextRenderNode['padding'] | undefined,
  /** imported / patched 路径专用 fallback：来自 OOXML `bodyPr@wrap`。 */
  fallbackWrap: TextRenderNode['wrap'] | undefined,
  /** imported / patched 路径专用：按 OOXML a:p 顺序保留的段落。 */
  fallbackParagraphs: readonly CanonicalTextParagraph[] | undefined,
): TextRenderNode {
  if (specElement?.type === 'shape') {
    return buildShapeTextNode(
      `${base.box.x}-${base.box.y}-inner`,
      base.box,
      0,
      text,
      {},
      defaultFontFamily,
      specElement.style?.rotate,
    );
  }

  const baseStyle = resolveTextStyle(specElement);
  const styleWithFallback: TextStyle =
    baseStyle.valign != null || fallbackVerticalAlign == null
      ? baseStyle
      : { ...baseStyle, valign: fallbackVerticalAlign };

  const node = buildShapeTextNode(
    `${base.box.x}-${base.box.y}-inner`,
    base.box,
    0,
    text,
    styleWithFallback,
    defaultFontFamily,
    undefined,
    fallbackAutoFitPolicy,
    {
      padding: fallbackPadding,
      wrap: fallbackWrap,
    },
  );
  return {
    ...node,
    paragraphs: fallbackParagraphs && fallbackParagraphs.length > 0
      ? mapCanonicalParagraphs(fallbackParagraphs, defaultFontFamily)
      : node.paragraphs,
  };
}

function mapCanonicalParagraphs(
  paragraphs: readonly CanonicalTextParagraph[],
  defaultFontFamily: string,
): RenderParagraph[] {
  return paragraphs.map((paragraph) => ({
    runs: paragraph.runs.map((run) => {
      const resolved = textStyleToRun(run.text, {
        fontFamily: run.fontFamily,
        fontSize: run.fontSize,
        bold: run.bold,
        italic: run.italic,
      }, defaultFontFamily);
      return {
        ...resolved,
        resolvedFontFamily: run.resolvedFontFamily ?? resolved.resolvedFontFamily,
        fontScript: run.fontScript ?? resolved.fontScript,
        fontResolution: run.fontResolution ?? resolved.fontResolution,
        fontFaceFingerprint: run.fontFaceFingerprint ?? resolved.fontFaceFingerprint,
        resolvedFontWeight: run.resolvedBold == null
          ? resolved.resolvedFontWeight
          : run.resolvedBold ? 'bold' : 'normal',
        resolvedFontStyle: run.resolvedItalic == null
          ? resolved.resolvedFontStyle
          : run.resolvedItalic ? 'italic' : 'normal',
      };
    }),
    align: paragraph.align,
    lineSpacing: paragraph.lineSpacing,
    lineSpacingResolution: paragraph.lineSpacingResolution,
    spacingBefore: paragraph.spacingBeforePt,
    spacingAfter: paragraph.spacingAfterPt,
    indent: paragraph.indentInches,
  }));
}
