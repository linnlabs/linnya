import type { Element as XmlElement } from '@xmldom/xmldom';
import {
  DEFAULT_SVG_GRAPHIC_ADMISSION_POLICY,
  SvgGraphicAdmissionError,
  type SvgGraphicAdmissionPolicy,
  type SvgGraphicAdmissionReport,
  type SvgGraphicMetrics,
  type SvgGraphicViewBox,
} from '@plugin/slides/shared/svgGraphic';
import {
  SVG_GRAPHIC_ALLOWED_ELEMENTS,
  SVG_GRAPHIC_DRAWABLE_ELEMENTS,
  SVG_GRAPHIC_ELEMENT_ATTRIBUTES,
  SVG_GRAPHIC_GEOMETRY_NUMBER_ATTRIBUTES,
  SVG_GRAPHIC_GLOBAL_ATTRIBUTES,
  SVG_GRAPHIC_METADATA_PARENTS,
  SVG_GRAPHIC_NON_NEGATIVE_NUMBER_ATTRIBUTES,
  SVG_GRAPHIC_OPACITY_ATTRIBUTES,
  SVG_GRAPHIC_POSITIVE_NUMBER_ATTRIBUTES,
  SVG_NAMESPACE,
  XML_NAMESPACE,
  XMLNS_NAMESPACE,
} from './svgGraphicSchema';
import {
  collectSvgElementNames,
  hashCanonicalSvg,
  isXmlElement,
  parseSvgGraphicDocument,
  serializeCanonicalSvgElement,
  svgElementName,
  svgUtf8ByteLength,
} from './svgGraphicXml';
import {
  countSvgGraphicPathSegments,
  parseFiniteSvgNumber,
  parseSvgNumberList,
  parseSvgNumberOrPercentage,
  parseSvgOffset,
  parseSvgUnitInterval,
  requireSvgValue,
  unsupportedAttribute,
  validateSvgDashArray,
  validateSvgPoints,
} from './svgGraphicValues';

interface LocalReference {
  readonly sourcePath: string;
  readonly attribute: string;
  readonly targetId: string;
  readonly expectedElementNames: ReadonlySet<string>;
}

interface AdmissionState {
  readonly ids: Map<string, string>;
  readonly idElementNames: Map<string, string>;
  readonly references: LocalReference[];
  elements: number;
  attributes: number;
  maxDepth: number;
  pathSegments: number;
  metadataTextLength: number;
  hasGradient: boolean;
  hasMarker: boolean;
  hasTransform: boolean;
}

/**
 * SVG Graphic 的唯一生产 admission。
 *
 * 返回值中的 canonicalSvg 与 contentHash 是后续 ownership、preview、fallback、PPTX
 * 和回读共同使用的创作事实；consumer 不得再次解释未经 admission 的原始 source。
 */
export function admitSvgGraphic(
  source: string,
  policy: SvgGraphicAdmissionPolicy = DEFAULT_SVG_GRAPHIC_ADMISSION_POLICY
): SvgGraphicAdmissionReport {
  const sourceBytes = svgUtf8ByteLength(source);
  if (sourceBytes > policy.maxBytes) {
    throw resourceLimit('bytes', sourceBytes, policy.maxBytes);
  }

  const document = parseSvgGraphicDocument(source);
  const root = document.documentElement;
  if (!root || svgElementName(root) !== 'svg' || root.namespaceURI !== SVG_NAMESPACE) {
    throw new SvgGraphicAdmissionError(
      'slides.svg.invalid_xml',
      'SVG 根元素必须是 SVG namespace 下的单一 <svg>。',
      '/svg[1]'
    );
  }

  // xmldom 会按 image/svg+xml 为省略声明的根元素补充 namespace 语义，但不会把声明
  // 写回 XML。canonical SVG 还要独立交给浏览器和 Office 解码，因此必须携带声明。
  if (!root.hasAttribute('xmlns')) root.setAttribute('xmlns', SVG_NAMESPACE);

  const viewBox = parseRequiredViewBox(root.getAttribute('viewBox'));
  const state: AdmissionState = {
    ids: new Map(),
    idElementNames: new Map(),
    references: [],
    elements: 0,
    attributes: 0,
    maxDepth: 0,
    pathSegments: 0,
    metadataTextLength: 0,
    hasGradient: false,
    hasMarker: false,
    hasTransform: false,
  };

  validateElement(root, '/svg[1]', 1, state, policy);
  validateReferences(state);
  const canonicalSvg = serializeCanonicalSvgElement(root);
  const canonicalBytes = svgUtf8ByteLength(canonicalSvg);
  if (canonicalBytes > policy.maxBytes) {
    throw resourceLimit('bytes', canonicalBytes, policy.maxBytes);
  }
  const metrics: SvgGraphicMetrics = {
    bytes: canonicalBytes,
    elements: state.elements,
    attributes: state.attributes,
    maxDepth: state.maxDepth,
    pathSegments: state.pathSegments,
    metadataTextLength: state.metadataTextLength,
    elementNames: collectSvgElementNames(root),
  };

  return {
    canonicalSvg,
    contentHash: hashCanonicalSvg(canonicalSvg),
    viewBox,
    metrics,
    facts: {
      hasGradient: state.hasGradient,
      hasMarker: state.hasMarker,
      hasTransform: state.hasTransform,
    },
  };
}

function validateElement(
  element: XmlElement,
  elementPath: string,
  depth: number,
  state: AdmissionState,
  policy: SvgGraphicAdmissionPolicy
): void {
  const name = svgElementName(element);
  if (
    element.namespaceURI !== SVG_NAMESPACE ||
    !SVG_GRAPHIC_ALLOWED_ELEMENTS.has(name) ||
    (name === 'svg' && depth !== 1)
  ) {
    throw new SvgGraphicAdmissionError(
      'slides.svg.unsupported_element',
      `SVG 元素 <${name}> 不在首期允许范围内。`,
      elementPath
    );
  }

  state.elements += 1;
  state.maxDepth = Math.max(state.maxDepth, depth);
  if (state.elements > policy.maxElements) {
    throw resourceLimit('elements', state.elements, policy.maxElements, elementPath);
  }
  if (depth > policy.maxDepth) {
    throw resourceLimit('depth', depth, policy.maxDepth, elementPath);
  }
  if (name === 'linearGradient' || name === 'radialGradient') state.hasGradient = true;
  if (name === 'marker') state.hasMarker = true;

  validateAttributes(element, elementPath, state, policy);
  const childNameCounts = new Map<string, number>();
  for (let index = 0; index < element.childNodes.length; index++) {
    const child = element.childNodes.item(index);
    if (!child) continue;
    if (isXmlElement(child)) {
      const childName = svgElementName(child);
      const occurrence = (childNameCounts.get(childName) ?? 0) + 1;
      childNameCounts.set(childName, occurrence);
      const childPath = `${elementPath}/${childName}[${occurrence}]`;
      validateChildElement(name, childName, childPath);
      validateElement(child, childPath, depth + 1, state, policy);
      continue;
    }
    if (child.nodeType === child.TEXT_NODE) {
      const text = child.nodeValue ?? '';
      if (text.trim().length > 0 && name !== 'title' && name !== 'desc') {
        throw new SvgGraphicAdmissionError(
          'slides.svg.invalid_xml',
          `元素 <${name}> 中不允许出现正文文本。`,
          elementPath
        );
      }
      if (name === 'title' || name === 'desc') {
        state.metadataTextLength += text.length;
        if (state.metadataTextLength > policy.maxMetadataTextLength) {
          throw resourceLimit(
            'metadataTextLength',
            state.metadataTextLength,
            policy.maxMetadataTextLength,
            elementPath
          );
        }
      }
      continue;
    }
    if (child.nodeType === child.CDATA_SECTION_NODE) {
      throw new SvgGraphicAdmissionError(
        'slides.svg.invalid_xml',
        'SVG canonical source 不允许 CDATA。',
        elementPath
      );
    }
    if (child.nodeType !== child.COMMENT_NODE) {
      throw new SvgGraphicAdmissionError(
        'slides.svg.invalid_xml',
        `SVG 包含不允许的 XML nodeType=${child.nodeType}。`,
        elementPath
      );
    }
  }
}

function validateAttributes(
  element: XmlElement,
  elementPath: string,
  state: AdmissionState,
  policy: SvgGraphicAdmissionPolicy
): void {
  const name = svgElementName(element);
  const allowedForElement = SVG_GRAPHIC_ELEMENT_ATTRIBUTES[name];
  for (let index = 0; index < element.attributes.length; index++) {
    const attribute = element.attributes.item(index);
    if (!attribute) continue;
    const attributeName = attribute.name;
    const value = attribute.value.trim();
    state.attributes += 1;
    if (state.attributes > policy.maxAttributes) {
      throw resourceLimit('attributes', state.attributes, policy.maxAttributes, elementPath);
    }

    if (attributeName.toLowerCase().startsWith('on')) {
      throw unsupportedAttribute(
        elementPath,
        attributeName,
        '事件属性不允许进入 SVG Graphic。'
      );
    }
    if (
      attribute.namespaceURI &&
      attribute.namespaceURI !== XML_NAMESPACE &&
      attribute.namespaceURI !== XMLNS_NAMESPACE
    ) {
      throw unsupportedAttribute(
        elementPath,
        attributeName,
        '未知 namespace 属性不在允许范围内。'
      );
    }
    if (
      !SVG_GRAPHIC_GLOBAL_ATTRIBUTES.has(attributeName) &&
      !allowedForElement?.has(attributeName)
    ) {
      throw unsupportedAttribute(
        elementPath,
        attributeName,
        '属性未登记在首期 SVG 子集中。'
      );
    }

    validateAttributeValue(name, attributeName, value, elementPath, state, policy);
  }
}

function validateAttributeValue(
  elementName: string,
  attributeName: string,
  value: string,
  elementPath: string,
  state: AdmissionState,
  policy: SvgGraphicAdmissionPolicy
): void {
  if (attributeName === 'xmlns') {
    if (value !== SVG_NAMESPACE) {
      throw unsupportedAttribute(elementPath, attributeName, 'SVG namespace 不正确。');
    }
    return;
  }
  if (attributeName === 'viewBox') {
    parseViewBox(value, elementPath);
    return;
  }
  if (attributeName === 'id') {
    validateId(value, elementName, elementPath, state);
    return;
  }
  if (attributeName === 'd') {
    state.pathSegments += countSvgGraphicPathSegments(value, elementPath);
    if (state.pathSegments > policy.maxPathSegments) {
      throw resourceLimit(
        'pathSegments',
        state.pathSegments,
        policy.maxPathSegments,
        elementPath
      );
    }
    return;
  }
  if (attributeName === 'points') {
    validateSvgPoints(value, elementPath);
    return;
  }
  if (attributeName === 'transform' || attributeName === 'gradientTransform') {
    validateTransform(value, elementPath, attributeName);
    state.hasTransform = true;
    return;
  }
  if (attributeName === 'fill' || attributeName === 'stroke') {
    validatePaint(value, elementPath, attributeName, state);
    return;
  }
  if (attributeName.startsWith('marker-')) {
    if (value === 'none') return;
    state.references.push(
      parseLocalReference(value, elementPath, attributeName, new Set(['marker']))
    );
    return;
  }
  if (attributeName === 'stop-color') {
    validateColor(value, elementPath, attributeName);
    return;
  }
  if (
    (elementName === 'linearGradient' || elementName === 'radialGradient') &&
    ['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'fx', 'fy', 'fr'].includes(attributeName)
  ) {
    parseSvgNumberOrPercentage(value, elementPath, attributeName);
    return;
  }
  if (SVG_GRAPHIC_GEOMETRY_NUMBER_ATTRIBUTES.has(attributeName)) {
    validateGeometryNumber(value, elementPath, attributeName);
    return;
  }
  if (SVG_GRAPHIC_OPACITY_ATTRIBUTES.has(attributeName)) {
    parseSvgUnitInterval(value, elementPath, attributeName);
    return;
  }
  if (attributeName === 'offset') {
    parseSvgOffset(value, elementPath);
    return;
  }
  if (attributeName === 'stroke-dasharray') {
    validateSvgDashArray(value, elementPath);
    return;
  }
  if (attributeName === 'stroke-linecap') {
    requireSvgValue(value, ['butt', 'round', 'square'], elementPath, attributeName);
    return;
  }
  if (attributeName === 'stroke-linejoin') {
    requireSvgValue(value, ['miter', 'round', 'bevel'], elementPath, attributeName);
    return;
  }
  if (attributeName === 'gradientUnits') {
    requireSvgValue(
      value,
      ['objectBoundingBox', 'userSpaceOnUse'],
      elementPath,
      attributeName
    );
    return;
  }
  if (attributeName === 'spreadMethod') {
    requireSvgValue(value, ['pad', 'reflect', 'repeat'], elementPath, attributeName);
    return;
  }
  if (attributeName === 'markerUnits') {
    requireSvgValue(value, ['strokeWidth', 'userSpaceOnUse'], elementPath, attributeName);
    return;
  }
  if (attributeName === 'orient') {
    if (!['auto', 'auto-start-reverse'].includes(value)) {
      parseFiniteSvgNumber(value, elementPath, attributeName);
    }
    return;
  }
  if (attributeName === 'preserveAspectRatio') {
    if (!/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(value)) {
      throw unsupportedAttribute(
        elementPath,
        attributeName,
        'preserveAspectRatio 不是登记形式。'
      );
    }
    return;
  }
  if (attributeName === 'xml:space') {
    requireSvgValue(value, ['default', 'preserve'], elementPath, attributeName);
    return;
  }
  if (attributeName === 'version') {
    requireSvgValue(value, ['1.1', '2.0'], elementPath, attributeName);
  }
}

function validateId(
  value: string,
  elementName: string,
  elementPath: string,
  state: AdmissionState
): void {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value)) {
    throw unsupportedAttribute(elementPath, 'id', 'id 不是稳定的本地标识符。');
  }
  if (state.ids.has(value)) {
    throw unsupportedAttribute(elementPath, 'id', `id "${value}" 重复。`);
  }
  state.ids.set(value, elementPath);
  state.idElementNames.set(value, elementName);
}

function validateGeometryNumber(
  value: string,
  elementPath: string,
  attributeName: string
): void {
  const number = parseFiniteSvgNumber(value, elementPath, attributeName);
  if (SVG_GRAPHIC_NON_NEGATIVE_NUMBER_ATTRIBUTES.has(attributeName) && number < 0) {
    throw unsupportedAttribute(elementPath, attributeName, '属性不能为负数。');
  }
  if (SVG_GRAPHIC_POSITIVE_NUMBER_ATTRIBUTES.has(attributeName) && number <= 0) {
    throw unsupportedAttribute(elementPath, attributeName, '属性必须是正数。');
  }
}

function validateReferences(state: AdmissionState): void {
  for (const reference of state.references) {
    const targetElementName = state.idElementNames.get(reference.targetId);
    if (!targetElementName || !reference.expectedElementNames.has(targetElementName)) {
      throw new SvgGraphicAdmissionError(
        'slides.svg.external_reference_forbidden',
        `${reference.attribute} 引用了缺失或类型不正确的本地 id "${reference.targetId}"。`,
        reference.sourcePath
      );
    }
  }
}

function validatePaint(
  value: string,
  elementPath: string,
  attributeName: string,
  state: AdmissionState
): void {
  if (value === 'none' || value === 'transparent') return;
  if (/^url\s*\(/i.test(value)) {
    state.references.push(
      parseLocalReference(
        value,
        elementPath,
        attributeName,
        new Set(['linearGradient', 'radialGradient'])
      )
    );
    return;
  }
  validateColor(value, elementPath, attributeName);
}

function validateColor(value: string, elementPath: string, attributeName: string): void {
  if (/^#[0-9A-Fa-f]{3,4}(?:[0-9A-Fa-f]{3,4})?$/.test(value)) return;
  const match =
    /^rgb(a)?\(\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)(?:\s*,\s*([-+]?\d+(?:\.\d+)?))?\s*\)$/.exec(
      value
    );
  if (match) {
    const hasAlphaFunction = match[1] === 'a';
    const red = Number(match[2]);
    const green = Number(match[3]);
    const blue = Number(match[4]);
    const alphaSource = match[5];
    const channelsValid = [red, green, blue].every(channel => channel >= 0 && channel <= 255);
    const alphaValid = hasAlphaFunction
      ? alphaSource !== undefined && Number(alphaSource) >= 0 && Number(alphaSource) <= 1
      : alphaSource === undefined;
    if (channelsValid && alphaValid) return;
  }
  throw unsupportedAttribute(elementPath, attributeName, '颜色只允许 hex 或数值 rgb/rgba。');
}

function validateChildElement(
  parentName: string,
  childName: string,
  childPath: string
): void {
  const isMetadata =
    (childName === 'title' || childName === 'desc') &&
    SVG_GRAPHIC_METADATA_PARENTS.has(parentName);
  const isDrawableChild =
    (parentName === 'svg' || parentName === 'g') &&
    SVG_GRAPHIC_DRAWABLE_ELEMENTS.has(childName);
  const isDefinition =
    parentName === 'defs' &&
    ['linearGradient', 'radialGradient', 'marker'].includes(childName);
  const isGradientStop =
    (parentName === 'linearGradient' || parentName === 'radialGradient') &&
    childName === 'stop';
  const isMarkerDrawing =
    parentName === 'marker' && SVG_GRAPHIC_DRAWABLE_ELEMENTS.has(childName);
  const isRootDefinitions = parentName === 'svg' && childName === 'defs';
  if (
    !isMetadata &&
    !isDrawableChild &&
    !isDefinition &&
    !isGradientStop &&
    !isMarkerDrawing &&
    !isRootDefinitions
  ) {
    throw new SvgGraphicAdmissionError(
      'slides.svg.unsupported_element',
      `SVG 首期子集不允许 <${parentName}> 包含 <${childName}>。`,
      childPath
    );
  }
}

function parseLocalReference(
  value: string,
  elementPath: string,
  attributeName: string,
  expectedElementNames: ReadonlySet<string>
): LocalReference {
  const match = /^url\(\s*#([A-Za-z_][A-Za-z0-9_.-]*)\s*\)$/.exec(value);
  if (!match?.[1]) {
    throw new SvgGraphicAdmissionError(
      'slides.svg.external_reference_forbidden',
      `${attributeName} 只允许同一 SVG 内的 url(#id) 引用。`,
      elementPath
    );
  }
  return {
    sourcePath: elementPath,
    attribute: attributeName,
    targetId: match[1],
    expectedElementNames,
  };
}

function validateTransform(
  value: string,
  elementPath: string,
  attributeName: string
): void {
  const functionPattern = /([A-Za-z]+)\s*\(([^)]*)\)/g;
  let matched = '';
  let count = 0;
  for (const match of value.matchAll(functionPattern)) {
    count += 1;
    matched += match[0];
    const kind = match[1];
    const args = parseSvgNumberList(match[2] ?? '', elementPath, attributeName);
    if (kind === 'translate' && (args.length === 1 || args.length === 2)) continue;
    if (kind === 'scale' && (args.length === 1 || args.length === 2)) continue;
    if (kind === 'rotate' && (args.length === 1 || args.length === 3)) continue;
    throw unsupportedAttribute(
      elementPath,
      attributeName,
      `transform 函数 ${kind} 不在允许范围或参数数量不正确。`
    );
  }
  const normalizedInput = value.replace(/[\s,]+/g, '');
  const normalizedMatched = matched.replace(/[\s,]+/g, '');
  if (count === 0 || normalizedInput !== normalizedMatched) {
    throw unsupportedAttribute(
      elementPath,
      attributeName,
      'transform 只能组合 translate、scale、rotate。'
    );
  }
}

function parseRequiredViewBox(value: string | null): SvgGraphicViewBox {
  if (!value) {
    throw new SvgGraphicAdmissionError(
      'slides.svg.missing_viewbox',
      'SVG 必须声明 viewBox。',
      '/svg[1]'
    );
  }
  const [x, y, width, height] = parseViewBox(value, '/svg[1]');
  if (x !== 0 || y !== 0 || width <= 0 || height <= 0) {
    throw new SvgGraphicAdmissionError(
      'slides.svg.missing_viewbox',
      'SVG viewBox 必须使用 0 0 原点和有限正数宽高。',
      '/svg[1]'
    );
  }
  return { width, height };
}

function parseViewBox(
  value: string,
  elementPath: string
): readonly [number, number, number, number] {
  const values = parseSvgNumberList(value, elementPath, 'viewBox');
  if (values.length !== 4 || values[2] === undefined || values[3] === undefined) {
    throw unsupportedAttribute(
      elementPath,
      'viewBox',
      'viewBox 必须包含四个数且宽高为正数。'
    );
  }
  const [x, y, width, height] = values;
  if (x === undefined || y === undefined || width <= 0 || height <= 0) {
    throw unsupportedAttribute(
      elementPath,
      'viewBox',
      'viewBox 必须包含四个数且宽高为正数。'
    );
  }
  return [x, y, width, height];
}

function resourceLimit(
  metric: string,
  actual: number,
  limit: number,
  elementPath?: string
): SvgGraphicAdmissionError {
  return new SvgGraphicAdmissionError(
    'slides.svg.resource_limit_exceeded',
    `SVG ${metric}=${actual} 超过上限 ${limit}。`,
    elementPath
  );
}
