/**
 * SlideElementParser
 *
 * 将 OOXML `p:spTree` 下的 `p:sp / p:pic / p:graphicFrame / p:grpSp` 翻译为 `SlideElementInfo`。
 *
 * 设计：
 * - 全部为纯函数，互相递归（parseGroup 调用 parseShape/parsePicture/parseGraphicFrame/parseGroup）
 * - 依赖只通过显式参数传入：`theme / slideRelMap / parentTransform`
 * - 不暴露 internal helpers（extractCreationId 在 XmlNode 通用工具里）
 *
 * 与 imported / patched 链路语义契约（ai-ppt §4.5）：
 * - shape vs textbox 启发式（见 parseShape 内注释）
 * - rotation / shapeVisual / fill / imageFit 全部透传到 `SlideElementInfo`，由 CanonicalBuilder 再注入 visual hints
 */

import type { Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom';
import type {
  SlideElementInfo,
  SlideElementImportFidelity,
  SlideElementSvgGraphicInfo,
  ThemeInfo,
} from '@plugin/slides/shared';
import {
  extractCreationId,
  getAttr,
  getElementByLocalName,
  getElementByTag,
  getTextContent,
} from './XmlNode.js';
import {
  buildGroupTransform,
  parsePosition,
  parseXfrm,
  type GroupTransform,
} from './GeometryParser.js';
import {
  extractImageFitMode,
  extractShapeVisual,
  parseRotationDegrees,
} from './ShapeVisualParser.js';
import {
  extractParagraphInfo,
  extractTextBodyInfo,
  extractTextStyleInfo,
} from './TextBodyParser.js';
import { extractMaxFontSizePt } from './TextSpacingParser.js';

export interface SlidePictureResourceContext {
  readonly svgGraphicsByRelationshipId: ReadonlyMap<string, SlideElementSvgGraphicInfo>;
  readonly svgFailureReasonsByRelationshipId: ReadonlyMap<
    string,
    SlideElementImportFidelity['reason']
  >;
}

/**
 * 解析 slide 顶层 `p:spTree` 下的全部直接子元素，按出现顺序返回。
 * 只递归 `p:grpSp`（group），其他元素扁平展开。
 */
export function parseSlideElements(
  slideDoc: XmlDocument,
  slideRelMap: Map<string, string>,
  theme: ThemeInfo,
  pictureResources?: SlidePictureResourceContext,
): SlideElementInfo[] {
  const elements: SlideElementInfo[] = [];
  const spTree = getElementByTag(slideDoc, 'p:spTree');
  if (!spTree) return elements;

  for (let index = 0; index < spTree.children.length; index++) {
    const element = spTree.children.item(index);
    if (!element) continue;
    switch (element.localName || element.tagName.split(':').pop()) {
      case 'sp':
        elements.push(parseShape(element, theme));
        break;
      case 'pic':
        elements.push(parsePicture(element, slideRelMap, undefined, pictureResources));
        break;
      case 'graphicFrame':
        elements.push(parseGraphicFrame(element, slideRelMap));
        break;
      case 'grpSp':
        elements.push(parseGroup(element, slideRelMap, theme, undefined, pictureResources));
        break;
    }
  }

  return elements;
}

/**
 * 解析 `p:sp`（形状/文本框，OOXML 中两者共用同一根节点）。
 *
 * shape vs text 启发式（与 ai-ppt §4.5 契约一致）：
 *   1) `p:cNvSpPr@txBox === '1'` ⇒ 明确 textbox（强制 text）
 *   2) 含 `custGeom` 或 `prst != 'rect'`（roundRect / ellipse / triangle / ...）⇒ 真正的几何形状，
 *      文本作为 innerText 保留（修复 imported / patched 中「带文字的 shape」语义丢失）
 *   3) `prst == 'rect'` 且无文本 且 带视觉负载（fill / border / cornerRadius / shadow）⇒ shape（纯色块）
 *   4) 其他情况 ⇒ text（含「带 fill 的 textbox」，保持 generated 主链 elementId / round-trip 稳定）
 */
export function parseShape(
  sp: XmlElement,
  theme: ThemeInfo,
  transform?: GroupTransform,
): SlideElementInfo {
  const nvSpPr = getElementByTag(sp, 'p:nvSpPr');
  const cNvPr = nvSpPr ? getElementByTag(nvSpPr, 'p:cNvPr') : null;
  const name = cNvPr ? getAttr(cNvPr, 'name') ?? '' : '';
  const creationId = extractCreationId(cNvPr);

  const txBody = getElementByTag(sp, 'p:txBody');
  const paragraphInfo = txBody ? extractParagraphInfo(txBody, theme) : undefined;
  const text = paragraphInfo
    ?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    .join('\n');
  const hasText = !!(text && text.trim().length > 0);

  const cNvSpPr = nvSpPr ? getElementByTag(nvSpPr, 'p:cNvSpPr') : null;
  const isTextBox = cNvSpPr ? getAttr(cNvSpPr, 'txBox') === '1' : false;
  const spPr = getElementByTag(sp, 'p:spPr');
  const prstGeom = spPr ? getElementByTag(spPr, 'a:prstGeom') : null;
  const customGeometry = spPr ? getElementByTag(spPr, 'a:custGeom') : null;
  const prstName = prstGeom ? getAttr(prstGeom, 'prst') : null;
  const hasNonRectGeom = prstGeom !== null && prstName !== null && prstName !== 'rect';
  const visualBundle = !isTextBox ? extractShapeVisual(spPr) : {};
  const hasMeaningfulShapeVisual =
    visualBundle.visual?.paint != null
    || visualBundle.visual?.border != null
    || visualBundle.visual?.cornerRadius != null
    || visualBundle.visual?.shadow != null;
  const treatAsShape =
    !isTextBox
    && (customGeometry !== null || hasNonRectGeom || (hasMeaningfulShapeVisual && !hasText));

  const position = parsePosition(spPr, transform);
  const xfrm = spPr ? getElementByTag(spPr, 'a:xfrm') : null;
  const rotation = parseRotationDegrees(xfrm);
  const fontSize = txBody ? extractMaxFontSizePt(txBody) : undefined;
  const textBody = txBody ? extractTextBodyInfo(txBody) : undefined;
  const textStyle = txBody ? extractTextStyleInfo(txBody, theme) : undefined;

  return {
    name,
    creationId: creationId ?? undefined,
    type: treatAsShape ? 'shape' : 'text',
    text: hasText ? text : undefined,
    position,
    rotation,
    fontSize,
    textStyle,
    textBody,
    paragraphs: paragraphInfo,
    fill: treatAsShape ? visualBundle.fill : undefined,
    shapeVisual: treatAsShape ? visualBundle.visual : undefined,
  };
}

/**
 * 解析 `p:pic`（图片）。
 * 图片资源路径通过 `slideRelMap` 解析；fitMode 走 §4.5 契约（默认 stretch / 含 a:tile ⇒ fill）。
 */
export function parsePicture(
  pic: XmlElement,
  slideRelMap: Map<string, string>,
  transform?: GroupTransform,
  pictureResources?: SlidePictureResourceContext,
): SlideElementInfo {
  const nvPicPr = getElementByTag(pic, 'p:nvPicPr');
  const cNvPr = nvPicPr ? getElementByTag(nvPicPr, 'p:cNvPr') : null;
  const name = cNvPr ? getAttr(cNvPr, 'name') ?? '' : '';
  const creationId = extractCreationId(cNvPr);

  const blipFill = getElementByTag(pic, 'p:blipFill');
  const blip = blipFill ? getElementByTag(blipFill, 'a:blip') : null;
  const embedId = blip ? getAttr(blip, 'r:embed') : null;
  const imageRef = embedId ? slideRelMap.get(embedId) ?? undefined : undefined;
  const svgBlip = getElementByLocalName(pic, 'svgBlip');
  const svgEmbedId = svgBlip ? getAttr(svgBlip, 'r:embed') : null;

  const spPr = getElementByTag(pic, 'p:spPr');
  const position = parsePosition(spPr, transform);
  const xfrm = spPr ? getElementByTag(spPr, 'a:xfrm') : null;
  const rotation = parseRotationDegrees(xfrm);
  const imageFit = extractImageFitMode(blipFill);
  const altText = cNvPr ? getAttr(cNvPr, 'descr')?.trim() || undefined : undefined;

  if (svgBlip) {
    const svgGraphic = svgEmbedId
      ? pictureResources?.svgGraphicsByRelationshipId.get(svgEmbedId)
      : undefined;
    if (svgGraphic) {
      return {
        name,
        creationId: creationId ?? undefined,
        type: 'svgGraphic',
        svgGraphic: {
          ...svgGraphic,
          fit: 'stretch',
          ...(altText ? { altText, decorative: false } : { decorative: true }),
        },
        position,
        rotation,
      };
    }
    if (!imageRef) {
      throw new Error(`Invalid PPTX: SVG picture ${name || '(unnamed)'} has no usable vector or raster media.`);
    }
    return {
      name,
      creationId: creationId ?? undefined,
      type: 'image',
      imageRef,
      position,
      rotation,
      imageFit,
      importFidelity: {
        status: 'raster-fallback',
        reason: svgEmbedId
          ? pictureResources?.svgFailureReasonsByRelationshipId.get(svgEmbedId)
            ?? 'unavailable_svg'
          : 'unavailable_svg',
      },
    };
  }

  return {
    name,
    creationId: creationId ?? undefined,
    type: 'image',
    imageRef,
    position,
    rotation,
    imageFit,
  };
}

/**
 * 解析 `p:graphicFrame`（chart / table / 其他 OOXML graphic 容器）。
 *
 * 当前实现保持最小语义：识别 chart / table URI，更细的 chart 内容反序列化由后续 import-fidelity 工作覆盖。
 */
export function parseGraphicFrame(
  gf: XmlElement,
  slideRelMap: Map<string, string>,
  transform?: GroupTransform,
): SlideElementInfo {
  void slideRelMap; // chart 数据反序列化在后续工作覆盖，当前仅识别 URI
  const nvGfPr = getElementByTag(gf, 'p:nvGraphicFramePr');
  const cNvPr = nvGfPr ? getElementByTag(nvGfPr, 'p:cNvPr') : null;
  const name = cNvPr ? getAttr(cNvPr, 'name') ?? '' : '';
  const creationId = extractCreationId(cNvPr);

  const xfrm = getElementByTag(gf, 'p:xfrm') ?? getElementByTag(gf, 'a:xfrm');
  const position = xfrm ? parseXfrm(xfrm, transform) : undefined;

  const graphic = getElementByTag(gf, 'a:graphic');
  const graphicData = graphic ? getElementByTag(graphic, 'a:graphicData') : null;
  const uri = graphicData ? getAttr(graphicData, 'uri') : null;

  if (uri === 'http://schemas.openxmlformats.org/drawingml/2006/chart') {
    const chartRef =
      getElementByTag(graphicData!, 'c:chart') ?? getElementByTag(graphicData!, 'r:id');
    let chartType: string | undefined;
    if (chartRef) {
      const chartRelId = getAttr(chartRef, 'r:id');
      if (chartRelId) {
        chartType = 'chart';
      }
    }
    return {
      name,
      creationId: creationId ?? undefined,
      type: 'chart',
      chartType,
      position,
    };
  }

  if (uri === 'http://schemas.openxmlformats.org/drawingml/2006/table') {
    return {
      name,
      creationId: creationId ?? undefined,
      type: 'table',
      position,
    };
  }

  return {
    name,
    creationId: creationId ?? undefined,
    type: 'other',
    position,
  };
}

/**
 * 解析 `p:grpSp`（group）。
 * 自身位置 + 累计 transform，递归解析子元素（与 parseSlideElements 完全等价的 4 类元素）。
 */
export function parseGroup(
  grp: XmlElement,
  slideRelMap: Map<string, string>,
  theme: ThemeInfo,
  parentTransform?: GroupTransform,
  pictureResources?: SlidePictureResourceContext,
): SlideElementInfo {
  const nvGrpSpPr = getElementByTag(grp, 'p:nvGrpSpPr');
  const cNvPr = nvGrpSpPr ? getElementByTag(nvGrpSpPr, 'p:cNvPr') : null;
  const name = cNvPr ? getAttr(cNvPr, 'name') ?? '' : '';
  const creationId = extractCreationId(cNvPr);

  const grpSpPr = getElementByTag(grp, 'p:grpSpPr');
  const xfrm = grpSpPr ? getElementByTag(grpSpPr, 'a:xfrm') : null;
  const position = xfrm ? parseXfrm(xfrm, parentTransform) : undefined;
  const rotation = parseRotationDegrees(xfrm);

  const groupElement: SlideElementInfo = {
    name,
    creationId: creationId ?? undefined,
    type: 'group',
    position,
    rotation,
  };

  const childTransform = xfrm ? buildGroupTransform(xfrm, parentTransform) : parentTransform;
  const childElements: SlideElementInfo[] = [];

  for (let index = 0; index < grp.children.length; index++) {
    const element = grp.children.item(index);
    if (!element) continue;
    switch (element.localName || element.tagName.split(':').pop()) {
      case 'sp':
        childElements.push(parseShape(element, theme, childTransform));
        break;
      case 'pic':
        childElements.push(parsePicture(
          element,
          slideRelMap,
          childTransform,
          pictureResources,
        ));
        break;
      case 'graphicFrame':
        childElements.push(parseGraphicFrame(element, slideRelMap, childTransform));
        break;
      case 'grpSp':
        childElements.push(parseGroup(
          element,
          slideRelMap,
          theme,
          childTransform,
          pictureResources,
        ));
        break;
    }
  }

  return {
    ...groupElement,
    children: childElements,
  };
}
