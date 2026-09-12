import type {
  RenderChartAxis,
  RenderChartDataLabels,
  RenderChartSeries,
  SlideRenderModel,
} from './renderModel';
import type { Paint } from '../visual/paint';
import { isPresetShapeName } from '../shapeGeometry';
import { isGeneratedLayoutConstraintEvidence } from '../generatedLayoutConstraints';

const NODE_BASE_KEYS = [
  'id',
  'kind',
  'box',
  'editableTarget',
  'rotation',
  'opacity',
  'visible',
  'zIndex',
  'locked',
  'interactive',
  'sourceSpan',
  'layoutConstraintEvidence',
  'diagnosticsRefIds',
] as const;

export function isSlideRenderModel(value: unknown): value is SlideRenderModel {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'slideId',
      'index',
      'layoutKey',
      'background',
      'elements',
      'diagnostics',
      'referencePreview',
    ])
    && isNonEmptyString(value.slideId)
    && isFiniteNumber(value.index)
    && typeof value.layoutKey === 'string'
    && isSlideBackground(value.background)
    && isArrayOf(value.elements, isRenderNode)
    && isOptional(value.diagnostics, isSlideDiagnostics)
    && isOptional(value.referencePreview, isSlideReferencePreview);
}

/** 只定位失败合同，不回显未知字段名、节点内容或资源路径。 */
export function findSlideRenderModelFailurePath(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.elements)) return 'slide';
  return findNodeFailurePath(value.elements, 'slide.elements') ?? 'slide';
}

function findNodeFailurePath(nodes: readonly unknown[], path: string): string | undefined {
  for (const [index, node] of nodes.entries()) {
    if (isRenderNode(node)) continue;
    const nodePath = `${path}[${index}]`;
    if (!isRecord(node)) return nodePath;
    if (node.kind === 'group' && Array.isArray(node.children)) {
      return findNodeFailurePath(node.children, `${nodePath}.children`) ?? nodePath;
    }
    if (node.kind === 'chart') {
      if (!Array.isArray(node.series)) return `${nodePath}.series`;
      const seriesIndex = node.series.findIndex(series => !isRenderChartSeries(series));
      if (seriesIndex !== -1) return `${nodePath}.series[${seriesIndex}]`;
      if (!isOptional(node.axes, isRenderChartAxes)) return `${nodePath}.axes`;
      if (!isOptional(node.dataLabels, isRenderChartDataLabels)) return `${nodePath}.dataLabels`;
    }
    return nodePath;
  }
  return undefined;
}

function isSlideBackground(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['paint', 'imageSrc', 'imageFit'])
    && isPaint(value.paint)
    && isOptional(value.imageSrc, isString)
    && isOptional(value.imageFit, imageFit => isOneOf(imageFit, ['cover', 'contain', 'stretch', 'tile']));
}

function isPaint(value: unknown): value is Paint {
  if (!isRecord(value)) return false;
  if (value.type === 'none') return hasOnlyKeys(value, ['type']);
  if (value.type === 'solid') {
    return hasOnlyKeys(value, ['type', 'color', 'opacity'])
      && isString(value.color)
      && isOptional(value.opacity, isFiniteNumber);
  }
  if (value.type === 'linear') {
    return hasOnlyKeys(value, ['type', 'angle', 'stops', 'rotateWithShape'])
      && isFiniteNumber(value.angle)
      && isGradientStops(value.stops)
      && isOptional(value.rotateWithShape, isBoolean);
  }
  if (value.type === 'radial') {
    return hasOnlyKeys(value, ['type', 'stops', 'center', 'radius', 'rotateWithShape'])
      && isGradientStops(value.stops)
      && isOptional(value.center, isNormalizedPoint)
      && isOptional(value.radius, isNormalizedPoint)
      && isOptional(value.rotateWithShape, isBoolean);
  }
  return false;
}

function isGradientStops(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 2 && value.every(isGradientStop);
}

function isGradientStop(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['color', 'position', 'opacity'])
    && isString(value.color)
    && isFiniteNumber(value.position)
    && isOptional(value.opacity, isFiniteNumber);
}

function isNormalizedPoint(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['x', 'y'])
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y);
}

function isSlideDiagnostics(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['warningCount', 'errorCount', 'diagnosticIds'])
    && isFiniteNumber(value.warningCount)
    && isFiniteNumber(value.errorCount)
    && isArrayOf(value.diagnosticIds, isString);
}

function isSlideReferencePreview(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['kind', 'src', 'width', 'height', 'generatedAt'])
    && isOneOf(value.kind, ['image', 'pdf-page', 'none'])
    && isOptional(value.src, isString)
    && isOptional(value.width, isFiniteNumber)
    && isOptional(value.height, isFiniteNumber)
    && isOptional(value.generatedAt, isString);
}

function isRenderNode(value: unknown): boolean {
  if (!hasRenderNodeBase(value)) return false;
  switch (value.kind) {
    case 'text':
      return isTextRenderNode(value);
    case 'shape':
      return isShapeRenderNode(value);
    case 'image':
      return isImageRenderNode(value);
    case 'svgGraphic':
      return isSvgGraphicRenderNode(value);
    case 'formula':
      return isMathFormulaRenderNode(value);
    case 'table':
      return isTableRenderNode(value);
    case 'chart':
      return isChartRenderNode(value);
    case 'group':
      return isGroupRenderNode(value);
    default:
      return false;
  }
}

function hasRenderNodeBase(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isString(value.kind)
    && isRenderBox(value.box)
    && isFiniteNumber(value.zIndex)
    && isOptional(value.editableTarget, isEditableTarget)
    && isOptional(value.rotation, isFiniteNumber)
    && isOptional(value.opacity, isFiniteNumber)
    && isOptional(value.visible, isBoolean)
    && isOptional(value.locked, isBoolean)
    && isOptional(value.interactive, isBoolean)
    && isOptional(value.sourceSpan, isSourceSpan)
    && isOptional(value.layoutConstraintEvidence, isGeneratedLayoutConstraintEvidence)
    && isOptional(value.diagnosticsRefIds, value => isArrayOf(value, isString));
}

function hasNodeKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return hasOnlyKeys(value, [...NODE_BASE_KEYS, ...keys]);
}

function isEditableTarget(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'slideNumber',
      'elementId',
      'creationId',
      'elementName',
      'semanticNodeId',
      'semanticRole',
      'operations',
      'imageEditCapabilities',
      'relayoutCapabilities',
    ])
    && isOptional(value.slideNumber, isFiniteNumber)
    && isOptional(value.elementId, isString)
    && isOptional(value.creationId, isString)
    && isOptional(value.elementName, isString)
    && isOptional(value.semanticNodeId, isString)
    && isOptional(value.semanticRole, isString)
    && isArrayOf(value.operations, operation => isOneOf(operation, [
      'modify_text',
      'edit_image',
      'update_chart',
      'update_table',
      'modify_style',
      'modify_geometry',
      'reorder_layer',
      'relayout_slide',
    ]))
    && isOptional(value.imageEditCapabilities, isImageEditCapabilities)
    && isOptional(value.relayoutCapabilities, capabilities => isArrayOf(
      capabilities,
      capability => isOneOf(capability, [
        'promote',
        'demote',
        'expand',
        'shrink',
        'swap_primary',
        'move_to_region',
      ]),
    ));
}

function isImageEditCapabilities(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['replaceSource', 'editVisuals'])
    && isBoolean(value.replaceSource)
    && isBoolean(value.editVisuals);
}

function isSourceSpan(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['startLine', 'endLine'])
    && isFiniteNumber(value.startLine)
    && isFiniteNumber(value.endLine);
}

function isTextRenderNode(value: Record<string, unknown>): boolean {
  return value.kind === 'text'
    && hasNodeKeys(value, [
      'paragraphs',
      'verticalAlign',
      'wrap',
      'overflow',
      'autoFitPolicy',
      'padding',
      'layout',
    ])
    && isArrayOf(value.paragraphs, isRenderParagraph)
    && isOptional(value.verticalAlign, align => isOneOf(align, ['top', 'middle', 'bottom']))
    && isOptional(value.wrap, wrap => isOneOf(wrap, ['word', 'char', 'none']))
    && isOptional(value.overflow, overflow => isOneOf(overflow, ['clip', 'ellipsis', 'visible']))
    && isOptional(value.autoFitPolicy, policy => isOneOf(policy, ['none', 'shrink-text', 'resize-shape']))
    && isOptional(value.padding, isRenderPadding)
    && isOptional(value.layout, isTextLayoutResult);
}

function isRenderParagraph(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'runs',
      'align',
      'lineSpacing',
      'lineSpacingResolution',
      'spacingBefore',
      'spacingAfter',
      'indent',
      'bullet',
    ])
    && isArrayOf(value.runs, isRenderInlineRun)
    && isOptional(value.align, align => isOneOf(align, ['left', 'center', 'right', 'justify']))
    && isOptional(value.lineSpacing, isRenderLineSpacing)
    && isOptional(value.lineSpacingResolution, isTextLineSpacingResolution)
    && isOptional(value.spacingBefore, isFiniteNumber)
    && isOptional(value.spacingAfter, isFiniteNumber)
    && isOptional(value.indent, isFiniteNumber)
    && isOptional(value.bullet, isRenderBullet);
}

function isTextLineSpacingResolution(value: unknown): boolean {
  if (!isRecord(value) || typeof value.source !== 'string') return false;
  if (value.source === 'unresolved') {
    return hasOnlyKeys(value, ['source', 'reason'])
      && value.reason === 'layout-master-context-unavailable';
  }
  return hasOnlyKeys(value, ['source'])
    && isOneOf(value.source, ['paragraph', 'list-style', 'default']);
}

function isRenderTextRun(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'text',
      'fontFamily',
      'resolvedFontFamily',
      'fontScript',
      'fontResolution',
      'fontFaceFingerprint',
      'resolvedFontWeight',
      'resolvedFontStyle',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'underline',
      'strikethrough',
      'color',
      'letterSpacing',
    ])
    && isString(value.text)
    && isOptional(value.fontFamily, isString)
    && isOptional(value.resolvedFontFamily, isString)
    && isOptional(value.fontScript, script => isOneOf(script, ['latin', 'eastAsian', 'complex']))
    && isOptional(
      value.fontResolution,
      resolution => isOneOf(resolution, ['not-ready', 'exact', 'substituted', 'unresolved']),
    )
    && isOptional(value.fontFaceFingerprint, isSha256)
    && isOptional(value.resolvedFontWeight, weight => isOneOf(weight, ['normal', 'bold']))
    && isOptional(value.resolvedFontStyle, style => isOneOf(style, ['normal', 'italic']))
    && isOptional(value.fontSize, isFiniteNumber)
    && isOptional(value.fontWeight, weight => isOneOf(weight, ['normal', 'bold']))
    && isOptional(value.fontStyle, style => isOneOf(style, ['normal', 'italic']))
    && isOptional(value.underline, isBoolean)
    && isOptional(value.strikethrough, isBoolean)
    && isOptional(value.color, isString)
    && isOptional(value.letterSpacing, isFiniteNumber);
}

function isRenderInlineRun(value: unknown): boolean {
  return isRenderTextRun(value) || isRenderFormulaRun(value);
}

function isRenderFormulaRun(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['kind', 'projection'])
    && value.kind === 'formula'
    && isMathFormulaRenderProjection(value.projection);
}

function isSha256(value: unknown): boolean {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isRenderLineSpacing(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['kind', 'value'])
    && isOneOf(value.kind, ['multiple', 'exactPt'])
    && isFiniteNumber(value.value)
    && value.value > 0;
}

function isRenderBullet(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['type', 'char', 'level', 'color', 'fontSize'])
    && isOneOf(value.type, ['disc', 'circle', 'square', 'decimal', 'alpha', 'roman', 'custom'])
    && isOptional(value.char, isString)
    && isOptional(value.level, isFiniteNumber)
    && isOptional(value.color, isString)
    && isOptional(value.fontSize, isFiniteNumber);
}

function isTextLayoutResult(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'lines',
      'contentHeightInches',
      'requiredHeightInches',
      'appliedFontScale',
      'appliedLineSpacingReduction',
      'advanceSource',
      'overflow',
    ])
    && isArrayOf(value.lines, isRenderTextLine)
    && isFiniteNumber(value.contentHeightInches)
    && isOptional(value.requiredHeightInches, isFiniteNumber)
    && isFiniteNumber(value.appliedFontScale)
    && isFiniteNumber(value.appliedLineSpacingReduction)
    && isOneOf(value.advanceSource, ['pretext', 'heuristic', 'harfbuzz'])
    && isTextLayoutOverflow(value.overflow);
}

function isTextLayoutOverflow(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['horizontal', 'vertical', 'hiddenLineCount'])
    && isBoolean(value.horizontal)
    && isBoolean(value.vertical)
    && isFiniteNumber(value.hiddenLineCount)
    && value.hiddenLineCount >= 0;
}

function isRenderTextLine(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['paragraphIndex', 'slices', 'y', 'baseline', 'height', 'width', 'align'])
    && isFiniteNumber(value.paragraphIndex)
    && isArrayOf(value.slices, isRenderInlineLineSlice)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.baseline)
    && isFiniteNumber(value.height)
    && isFiniteNumber(value.width)
    && isOneOf(value.align, ['left', 'center', 'right', 'justify']);
}

function isRenderInlineLineSlice(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'inlineBox') {
    return hasOnlyKeys(value, [
      'kind',
      'paragraphIndex',
      'runIndex',
      'identity',
      'projection',
      'x',
      'width',
      'boxY',
      'height',
    ])
      && isFiniteNumber(value.paragraphIndex)
      && isFiniteNumber(value.runIndex)
      && isNonEmptyString(value.identity)
      && isMathFormulaRenderProjection(value.projection)
      && isFiniteNumber(value.x)
      && isFiniteNumber(value.width)
      && isFiniteNumber(value.boxY)
      && isFiniteNumber(value.height);
  }
  return hasOnlyKeys(value, [
    'kind',
    'paragraphIndex',
    'runIndex',
    'text',
    'x',
    'width',
    'textY',
    'isBulletMarker',
  ])
    && isOptional(value.kind, kind => kind === 'text')
    && isFiniteNumber(value.paragraphIndex)
    && isFiniteNumber(value.runIndex)
    && isString(value.text)
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.width)
    && isFiniteNumber(value.textY)
    && isOptional(value.isBulletMarker, isBoolean);
}

function isShapeRenderNode(value: Record<string, unknown>): boolean {
  return value.kind === 'shape'
    && hasNodeKeys(value, [
      'geometry',
      'fill',
      'stroke',
      'cornerRadius',
      'shadow',
      'innerText',
    ])
    && isResolvedShapeGeometry(value.geometry)
    && isOptional(value.fill, isRenderFill)
    && isOptional(value.stroke, isRenderStroke)
    && isOptional(value.cornerRadius, isFiniteNumber)
    && isOptional(value.shadow, isRenderShadow)
    && isOptional(value.innerText, innerText => isRecord(innerText) && isTextRenderNode(innerText));
}

function isResolvedShapeGeometry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type === 'preset') {
    return hasOnlyKeys(value, ['type', 'name']) && isPresetShapeName(value.name);
  }
  return value.type === 'path'
    && hasOnlyKeys(value, ['type', 'viewBox', 'commands', 'closed'])
    && isShapeViewBox(value.viewBox)
    && isArrayOf(value.commands, isShapePathCommand)
    && typeof value.closed === 'boolean';
}

function isShapeViewBox(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['width', 'height'])
    && isFiniteNumber(value.width)
    && value.width > 0
    && isFiniteNumber(value.height)
    && value.height > 0;
}

function isShapePathCommand(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'close') return hasOnlyKeys(value, ['type']);
  if (value.type === 'moveTo' || value.type === 'lineTo') {
    return hasOnlyKeys(value, ['type', 'x', 'y'])
      && isFiniteNumber(value.x)
      && isFiniteNumber(value.y);
  }
  if (value.type === 'quadraticTo') {
    return hasOnlyKeys(value, ['type', 'x1', 'y1', 'x', 'y'])
      && isFiniteNumber(value.x1)
      && isFiniteNumber(value.y1)
      && isFiniteNumber(value.x)
      && isFiniteNumber(value.y);
  }
  return value.type === 'cubicTo'
    && hasOnlyKeys(value, ['type', 'x1', 'y1', 'x2', 'y2', 'x', 'y'])
    && isFiniteNumber(value.x1)
    && isFiniteNumber(value.y1)
    && isFiniteNumber(value.x2)
    && isFiniteNumber(value.y2)
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y);
}

function isRenderFill(value: unknown): boolean {
  return isPaint(value);
}

function isImageRenderNode(value: Record<string, unknown>): boolean {
  return value.kind === 'image'
    && hasNodeKeys(value, [
      'assetRef',
      'naturalSize',
      'fitMode',
      'crop',
      'maskShape',
      'borderRadius',
      'shadow',
      'alt',
      'flipH',
      'flipV',
    ])
    && isRenderAssetRef(value.assetRef)
    && isOptional(value.naturalSize, isNaturalSize)
    && isOptional(value.fitMode, mode => isOneOf(mode, ['fill', 'contain', 'cover', 'stretch']))
    && isOptional(value.crop, isCrop)
    && isOptional(value.maskShape, shape => isOneOf(shape, ['rect', 'circle']))
    && isOptional(value.borderRadius, isFiniteNumber)
    && isOptional(value.shadow, isRenderShadow)
    && isOptional(value.alt, isString)
    && isOptional(value.flipH, isBoolean)
    && isOptional(value.flipV, isBoolean);
}

function isSvgGraphicRenderNode(value: Record<string, unknown>): boolean {
  return value.kind === 'svgGraphic'
    && hasNodeKeys(value, [
      'canonicalSvg',
      'contentHash',
      'viewBox',
      'fit',
      'altText',
      'decorative',
    ])
    && isNonEmptyString(value.canonicalSvg)
    && isSha256(value.contentHash)
    && isSvgGraphicViewBox(value.viewBox)
    && isOneOf(value.fit, ['contain', 'stretch'])
    && isOptional(value.altText, isNonEmptyString)
    && isBoolean(value.decorative)
    && (value.decorative === true
      ? value.altText === undefined
      : isNonEmptyString(value.altText));
}

function isMathFormulaRenderNode(value: Record<string, unknown>): boolean {
  return value.kind === 'formula'
    && hasNodeKeys(value, ['canonicalSvg', 'contentHash', 'viewBox', 'contentViewBox', 'metrics', 'altText', 'align'])
    && hasMathFormulaRenderProjectionValues(value);
}

function isMathFormulaRenderProjection(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'canonicalSvg',
      'contentHash',
      'viewBox',
      'contentViewBox',
      'metrics',
      'altText',
      'align',
    ])
    && hasMathFormulaRenderProjectionValues(value);
}

function hasMathFormulaRenderProjectionValues(value: Record<string, unknown>): boolean {
  return isNonEmptyString(value.canonicalSvg)
    && isSha256(value.contentHash)
    && isFormulaViewBox(value.viewBox)
    && isFormulaViewBox(value.contentViewBox)
    && isFormulaMetrics(value.metrics)
    && isNonEmptyString(value.altText)
    && isOneOf(value.align, ['left', 'center', 'right']);
}

function isFormulaViewBox(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['x', 'y', 'width', 'height'])
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.width)
    && value.width > 0
    && isFiniteNumber(value.height)
    && value.height > 0;
}

function isFormulaMetrics(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['advanceWidth', 'ascent', 'descent', 'inkBounds', 'nativeEnvelope'])
    && isFiniteNumber(value.advanceWidth)
    && isFiniteNumber(value.ascent)
    && isFiniteNumber(value.descent)
    && isRecord(value.inkBounds)
    && hasOnlyKeys(value.inkBounds, ['x', 'y', 'width', 'height'])
    && isFiniteNumber(value.inkBounds.x)
    && isFiniteNumber(value.inkBounds.y)
    && isFiniteNumber(value.inkBounds.width)
    && isFiniteNumber(value.inkBounds.height)
    && isRecord(value.nativeEnvelope)
    && hasOnlyKeys(value.nativeEnvelope, ['ascentEm', 'descentEm'])
    && isFiniteNumber(value.nativeEnvelope.ascentEm)
    && isFiniteNumber(value.nativeEnvelope.descentEm);
}

function isSvgGraphicViewBox(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['width', 'height'])
    && isFiniteNumber(value.width)
    && value.width > 0
    && isFiniteNumber(value.height)
    && value.height > 0;
}

function isRenderAssetRef(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type === 'data') {
    return hasOnlyKeys(value, ['type', 'dataUri']) && isNonEmptyString(value.dataUri);
  }
  if (value.type === 'external') {
    return hasOnlyKeys(value, ['type', 'url']) && isNonEmptyString(value.url);
  }
  return value.type === 'embedded'
    && hasOnlyKeys(value, ['type', 'partPath'])
    && isNonEmptyString(value.partPath);
}

function isNaturalSize(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['width', 'height'])
    && isFiniteNumber(value.width)
    && isFiniteNumber(value.height);
}

function isCrop(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['top', 'right', 'bottom', 'left'])
    && isFiniteNumber(value.top)
    && isFiniteNumber(value.right)
    && isFiniteNumber(value.bottom)
    && isFiniteNumber(value.left);
}

function isTableRenderNode(value: Record<string, unknown>): boolean {
  return value.kind === 'table'
    && hasNodeKeys(value, [
      'columns',
      'rows',
      'cells',
      'headerRows',
      'footerRows',
      'pptxHints',
    ])
    && isArrayOf(value.columns, isFiniteNumber)
    && isArrayOf(value.rows, isFiniteNumber)
    && isArrayOf(value.cells, isRenderTableCell)
    && isOptional(value.headerRows, isFiniteNumber)
    && isOptional(value.footerRows, isFiniteNumber)
    && isOptional(value.pptxHints, isTablePptxHints);
}

function isRenderTableCell(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'row',
      'col',
      'rowSpan',
      'colSpan',
      'paragraphs',
      'fill',
      'borders',
      'padding',
      'verticalAlign',
      'textLayout',
    ])
    && isFiniteNumber(value.row)
    && isFiniteNumber(value.col)
    && isOptional(value.rowSpan, isFiniteNumber)
    && isOptional(value.colSpan, isFiniteNumber)
    && isArrayOf(value.paragraphs, isRenderParagraph)
    && isOptional(value.fill, isString)
    && isOptional(value.borders, isRenderTableCellBorders)
    && isOptional(value.padding, isRenderPadding)
    && isOptional(value.verticalAlign, align => isOneOf(align, ['top', 'middle', 'bottom']))
    && isOptional(value.textLayout, isTextLayoutResult);
}

function isRenderTableCellBorders(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['top', 'right', 'bottom', 'left'])
    && isOptional(value.top, isRenderStroke)
    && isOptional(value.right, isRenderStroke)
    && isOptional(value.bottom, isRenderStroke)
    && isOptional(value.left, isRenderStroke);
}

function isTablePptxHints(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['tableFill', 'headerFill', 'borderColor'])
    && isOptional(value.tableFill, isString)
    && isOptional(value.headerFill, isString)
    && isOptional(value.borderColor, isString);
}

function isChartRenderNode(value: Record<string, unknown>): boolean {
  return value.kind === 'chart'
    && hasNodeKeys(value, [
      'chartType',
      'categories',
      'series',
      'palette',
      'axes',
      'legend',
      'dataLabels',
      'gridlines',
      'plotBackgroundColor',
      'seriesLineWidth',
      'stacking',
      'labelStyle',
      'pptxHints',
    ])
    && isChartType(value.chartType)
    && isArrayOf(value.categories, isString)
    && isArrayOf(value.series, isRenderChartSeries)
    && Array.isArray(value.palette)
    && value.palette.length > 0
    && value.palette.every(isString)
    && isOptional(value.axes, isRenderChartAxes)
    && isOptional(value.legend, isRenderChartLegend)
    && isOptional(value.dataLabels, isRenderChartDataLabels)
    && isOptional(value.plotBackgroundColor, isString)
    && isOptional(value.seriesLineWidth, width => isFiniteNumber(width) && width > 0)
    && isOptional(value.gridlines, isRenderChartGridlines)
    && isOptional(value.stacking, stacking => isOneOf(stacking, ['none', 'stacked', 'percent']))
    && isOptional(value.labelStyle, isRenderChartLabelStyle)
    && isOptional(value.pptxHints, isChartPptxHints);
}

function isChartType(value: unknown): boolean {
  return isOneOf(value, ['bar', 'column', 'line', 'pie', 'doughnut', 'scatter', 'area', 'radar', 'combo']);
}

// 字段集合同时是严格准入和类型穷尽检查；新增正式控制必须补 validator，不能再次静默漂移。
type FieldValidators<T> = { [Key in keyof T]-?: (value: unknown) => boolean };

const CHART_SERIES_FIELDS = {
  name: isString,
  values: (value: unknown) => isArrayOf(value, isFiniteNumber),
  chartType: (value: unknown) => isOptional(value, isChartType),
  color: (value: unknown) => isOptional(value, isString),
  axis: (value: unknown) => isOptional(value, axis => isOneOf(axis, ['primary', 'secondary'])),
  lineWidth: (value: unknown) => isOptional(value, width => isFiniteNumber(width) && width > 0),
  lineDash: (value: unknown) => isOptional(value, dash => isOneOf(dash, ['solid', 'dash', 'dot'])),
  marker: (value: unknown) => isOptional(value, marker => isOneOf(marker, ['none', 'circle', 'square', 'diamond', 'triangle'])),
  pointColors: (value: unknown) => isOptional(value, colors => isArrayOf(colors, color => color === null || isString(color))),
  showDataLabels: (value: unknown) => isOptional(value, isBoolean),
  dataLabelFormat: (value: unknown) => isOptional(value, isString),
} satisfies FieldValidators<RenderChartSeries>;

function isRenderChartSeries(value: unknown): boolean {
  return hasValidatedFields(value, CHART_SERIES_FIELDS);
}

function isRenderChartAxes(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['x', 'y', 'y2'])
    && isOptional(value.x, isRenderChartAxis)
    && isOptional(value.y, isRenderChartAxis)
    && isOptional(value.y2, isRenderChartAxis);
}

const CHART_AXIS_FIELDS = {
  title: (value: unknown) => isOptional(value, isString),
  visible: (value: unknown) => isOptional(value, isBoolean),
  min: (value: unknown) => isOptional(value, isFiniteNumber),
  max: (value: unknown) => isOptional(value, isFiniteNumber),
  majorUnit: (value: unknown) => isOptional(value, unit => isFiniteNumber(unit) && unit > 0),
  labelRotation: (value: unknown) => isOptional(value, isFiniteNumber),
  showGridlines: (value: unknown) => isOptional(value, isBoolean),
  format: (value: unknown) => isOptional(value, isString),
  labelStyle: (value: unknown) => isOptional(value, isRenderChartLabelStyle),
} satisfies FieldValidators<RenderChartAxis>;

function isRenderChartAxis(value: unknown): boolean {
  return hasValidatedFields(value, CHART_AXIS_FIELDS);
}

function isRenderChartLegend(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['visible', 'position', 'labelStyle'])
    && isOptional(value.visible, isBoolean)
    && isOptional(value.position, position => isOneOf(position, ['top', 'bottom', 'left', 'right']))
    && isOptional(value.labelStyle, isRenderChartLabelStyle);
}

const CHART_DATA_LABEL_FIELDS = {
  visible: (value: unknown) => isOptional(value, isBoolean),
  content: (value: unknown) => isOptional(value, content => isOneOf(content, ['value', 'percentage', 'category'])),
  format: (value: unknown) => isOptional(value, isString),
  position: (value: unknown) => isOptional(value, position => isOneOf(position, ['inside', 'outside', 'center'])),
  labelStyle: (value: unknown) => isOptional(value, isRenderChartLabelStyle),
} satisfies FieldValidators<RenderChartDataLabels>;

function isRenderChartDataLabels(value: unknown): boolean {
  return hasValidatedFields(value, CHART_DATA_LABEL_FIELDS);
}

function hasValidatedFields(
  value: unknown,
  validators: Record<string, (entry: unknown) => boolean>,
): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, Object.keys(validators))
    && Object.entries(validators).every(([key, predicate]) => predicate(value[key]));
}

function isRenderChartGridlines(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['x', 'y'])
    && isOptional(value.x, isGridline)
    && isOptional(value.y, isGridline);
}

function isGridline(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['visible', 'color'])
    && isOptional(value.visible, isBoolean)
    && isOptional(value.color, isString);
}

function isRenderChartLabelStyle(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['fontFamily', 'fontSize', 'color'])
    && isOptional(value.fontFamily, isString)
    && isOptional(value.fontSize, isFiniteNumber)
    && isOptional(value.color, isString);
}

function isChartPptxHints(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'barGapWidthPct',
      'barOverlapPct',
      'radarStyle',
      'lineSize',
      'lineSmooth',
      'holeSize',
      'catAxisOrientation',
      'dataLabelColor',
    ])
    && isOptional(value.barGapWidthPct, isFiniteNumber)
    && isOptional(value.barOverlapPct, isFiniteNumber)
    && isOptional(value.radarStyle, style => isOneOf(style, ['standard', 'marker', 'filled']))
    && isOptional(value.lineSize, isFiniteNumber)
    && isOptional(value.lineSmooth, isBoolean)
    && isOptional(value.holeSize, isFiniteNumber)
    && isOptional(value.catAxisOrientation, orientation => isOneOf(orientation, ['minMax', 'maxMin']))
    && isOptional(value.dataLabelColor, isString);
}

function isGroupRenderNode(value: Record<string, unknown>): boolean {
  return value.kind === 'group'
    && hasNodeKeys(value, ['children'])
    && isArrayOf(value.children, isRenderNode);
}

function isRenderStroke(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['paint', 'width', 'dash'])
    && isPaint(value.paint)
    && value.paint.type !== 'radial'
    && isFiniteNumber(value.width)
    && isOptional(value.dash, dash => isOneOf(dash, ['solid', 'dash', 'dot', 'dashDot']));
}

function isRenderShadow(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['color', 'blur', 'offsetX', 'offsetY', 'opacity'])
    && isString(value.color)
    && isFiniteNumber(value.blur)
    && isFiniteNumber(value.offsetX)
    && isFiniteNumber(value.offsetY)
    && isOptional(value.opacity, isFiniteNumber);
}

function isRenderPadding(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['top', 'right', 'bottom', 'left'])
    && isOptional(value.top, isFiniteNumber)
    && isOptional(value.right, isFiniteNumber)
    && isOptional(value.bottom, isFiniteNumber)
    && isOptional(value.left, isFiniteNumber);
}

function isRenderBox(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['x', 'y', 'w', 'h', 'unit'])
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.w)
    && isFiniteNumber(value.h)
    && value.unit === 'in';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every(key => allowed.has(key));
}

function isArrayOf(value: unknown, predicate: (entry: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(predicate);
}

function isOptional(value: unknown, predicate: (entry: unknown) => boolean): boolean {
  return value === undefined || predicate(value);
}

function isOneOf(value: unknown, values: readonly string[]): boolean {
  return typeof value === 'string' && values.includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}
