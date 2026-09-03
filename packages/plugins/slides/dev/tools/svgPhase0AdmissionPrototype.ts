import type { Element as XmlElement } from '@xmldom/xmldom';
import {
  SVG_PHASE_0_PROTOTYPE_POLICY,
  SvgPhase0AdmissionError,
  unsupportedSvgPhase0Attribute,
  type SvgPhase0AdmissionPolicy,
  type SvgPhase0AdmissionReport,
  type SvgPhase0Metrics,
} from './svgPhase0AdmissionDefinitions';
import {
  ALLOWED_ELEMENTS,
  CONTAINER_CHILDREN,
  ELEMENT_ATTRIBUTES,
  GEOMETRY_NUMBER_ATTRIBUTES,
  GLOBAL_ATTRIBUTES,
  NON_NEGATIVE_NUMBER_ATTRIBUTES,
  OPACITY_ATTRIBUTES,
  POSITIVE_NUMBER_ATTRIBUTES,
  SVG_NAMESPACE,
  XML_NAMESPACE,
  XMLNS_NAMESPACE,
} from './svgPhase0AdmissionSchema';
import {
  collectElementNames,
  elementName,
  isXmlElement,
  parseSvgDocument,
  serializeCanonicalElement,
  sha256,
  utf8ByteLength,
  walkElements,
} from './svgPhase0XmlPrototype';
import {
  countSvgPathSegments,
  parseFiniteNumber,
  parseNumberList,
  parseNumberOrPercentage,
  parseOffset,
  parseUnitInterval,
  requireOneOf,
  validateDashArray,
  validatePoints,
} from './svgPhase0ValuePrototype';

export {
  SVG_PHASE_0_PROTOTYPE_POLICY,
  SvgPhase0AdmissionError,
} from './svgPhase0AdmissionDefinitions';
export type {
  SvgPhase0AdmissionPolicy,
  SvgPhase0AdmissionReport,
  SvgPhase0FailureCode,
  SvgPhase0Metrics,
} from './svgPhase0AdmissionDefinitions';

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
  textLength: number;
  hasText: boolean;
  hasGradient: boolean;
  hasMarker: boolean;
  hasTransform: boolean;
}

export function admitSvgPhase0(
  source: string,
  policy: SvgPhase0AdmissionPolicy = SVG_PHASE_0_PROTOTYPE_POLICY
): SvgPhase0AdmissionReport {
  const bytes = utf8ByteLength(source);
  if (bytes > policy.maxBytes) {
    throw resourceLimit('bytes', bytes, policy.maxBytes);
  }

  const document = parseSvgDocument(source);
  const root = document.documentElement;
  if (!root || elementName(root) !== 'svg' || root.namespaceURI !== SVG_NAMESPACE) {
    throw new SvgPhase0AdmissionError(
      'slides.svg.invalid_xml',
      'SVG 根元素必须是 SVG namespace 下的单一 <svg>。',
      '/svg'
    );
  }

  const viewBox = parseRequiredViewBox(root.getAttribute('viewBox'));
  const state: AdmissionState = {
    ids: new Map(),
    idElementNames: new Map(),
    references: [],
    elements: 0,
    attributes: 0,
    maxDepth: 0,
    pathSegments: 0,
    textLength: 0,
    hasText: false,
    hasGradient: false,
    hasMarker: false,
    hasTransform: false,
  };

  validateElement(root, '/svg[1]', 1, state, policy);
  validateReferences(state);
  const canonicalSvg = serializeCanonicalElement(root);
  const metrics: SvgPhase0Metrics = {
    bytes: utf8ByteLength(canonicalSvg),
    elements: state.elements,
    attributes: state.attributes,
    maxDepth: state.maxDepth,
    pathSegments: state.pathSegments,
    textLength: state.textLength,
    elementNames: collectElementNames(root),
  };

  return {
    canonicalSvg,
    contentHash: sha256(canonicalSvg),
    viewBox,
    metrics,
    facts: {
      hasText: state.hasText,
      hasGradient: state.hasGradient,
      hasMarker: state.hasMarker,
      hasTransform: state.hasTransform,
    },
  };
}

export function measureSvgSource(source: string): SvgPhase0Metrics {
  const document = parseSvgDocument(source);
  const root = document.documentElement;
  if (!root) {
    throw new SvgPhase0AdmissionError('slides.svg.invalid_xml', 'SVG 缺少根元素。');
  }
  let elements = 0;
  let attributes = 0;
  let maxDepth = 0;
  let pathSegments = 0;
  let textLength = 0;

  walkElements(root, 1, (element, depth) => {
    elements += 1;
    attributes += element.attributes.length;
    maxDepth = Math.max(maxDepth, depth);
    if (elementName(element) === 'path') {
      pathSegments += (element.getAttribute('d')?.match(/[AaCcHhLlMmQqSsTtVvZz]/g) ?? []).length;
    }
    for (let index = 0; index < element.childNodes.length; index++) {
      const child = element.childNodes.item(index);
      if (child && child.nodeType === child.TEXT_NODE && child.nodeValue) {
        textLength += child.nodeValue.length;
      }
    }
  });

  return {
    bytes: utf8ByteLength(source),
    elements,
    attributes,
    maxDepth,
    pathSegments,
    textLength,
    elementNames: collectElementNames(root),
  };
}

function validateElement(
  element: XmlElement,
  path: string,
  depth: number,
  state: AdmissionState,
  policy: SvgPhase0AdmissionPolicy
): void {
  const name = elementName(element);
  if (
    element.namespaceURI !== SVG_NAMESPACE ||
    !ALLOWED_ELEMENTS.has(name) ||
    (name === 'svg' && depth !== 1)
  ) {
    throw new SvgPhase0AdmissionError(
      'slides.svg.unsupported_element',
      `SVG 元素 <${name}> 不在首期允许范围内。`,
      path
    );
  }

  state.elements += 1;
  state.maxDepth = Math.max(state.maxDepth, depth);
  if (state.elements > policy.maxElements) {
    throw resourceLimit('elements', state.elements, policy.maxElements, path);
  }
  if (depth > policy.maxDepth) {
    throw resourceLimit('depth', depth, policy.maxDepth, path);
  }

  if (name === 'text' || name === 'tspan') state.hasText = true;
  if (name === 'linearGradient' || name === 'radialGradient') state.hasGradient = true;
  if (name === 'marker') state.hasMarker = true;

  validateAttributes(element, path, state, policy);
  const childNameCounts = new Map<string, number>();
  for (let index = 0; index < element.childNodes.length; index++) {
    const child = element.childNodes.item(index);
    if (!child) continue;
    if (isXmlElement(child)) {
      const childElement = child;
      const childName = elementName(childElement);
      const occurrence = (childNameCounts.get(childName) ?? 0) + 1;
      childNameCounts.set(childName, occurrence);
      const childPath = `${path}/${childName}[${occurrence}]`;
      validateChildElement(name, childName, childPath);
      validateElement(childElement, childPath, depth + 1, state, policy);
      continue;
    }
    if (child.nodeType === child.TEXT_NODE) {
      const text = child.nodeValue ?? '';
      if (text.trim().length > 0 && !['text', 'tspan', 'title', 'desc'].includes(name)) {
        throw new SvgPhase0AdmissionError(
          'slides.svg.invalid_xml',
          `元素 <${name}> 中不允许出现正文文本。`,
          path
        );
      }
      if (['text', 'tspan', 'title', 'desc'].includes(name)) {
        state.textLength += text.length;
        if (state.textLength > policy.maxTextLength) {
          throw resourceLimit('textLength', state.textLength, policy.maxTextLength, path);
        }
      }
      continue;
    }
    if (child.nodeType === child.CDATA_SECTION_NODE) {
      throw new SvgPhase0AdmissionError(
        'slides.svg.invalid_xml',
        'SVG canonical source 不允许 CDATA。',
        path
      );
    }
    if (child.nodeType !== child.COMMENT_NODE) {
      throw new SvgPhase0AdmissionError(
        'slides.svg.invalid_xml',
        `SVG 包含不允许的 XML nodeType=${child.nodeType}。`,
        path
      );
    }
  }
}

function validateAttributes(
  element: XmlElement,
  path: string,
  state: AdmissionState,
  policy: SvgPhase0AdmissionPolicy
): void {
  const name = elementName(element);
  const allowedForElement = ELEMENT_ATTRIBUTES[name];
  for (let index = 0; index < element.attributes.length; index++) {
    const attribute = element.attributes.item(index);
    if (!attribute) continue;
    const attributeName = attribute.name;
    const value = attribute.value.trim();
    state.attributes += 1;
    if (state.attributes > policy.maxAttributes) {
      throw resourceLimit('attributes', state.attributes, policy.maxAttributes, path);
    }

    if (attributeName.toLowerCase().startsWith('on')) {
      throw unsupportedAttribute(path, attributeName, '事件属性不允许进入 SVG Graphic。');
    }
    if (
      attribute.namespaceURI &&
      attribute.namespaceURI !== XML_NAMESPACE &&
      attribute.namespaceURI !== XMLNS_NAMESPACE
    ) {
      throw unsupportedAttribute(path, attributeName, '未知 namespace 属性不在允许范围内。');
    }
    if (!GLOBAL_ATTRIBUTES.has(attributeName) && !allowedForElement?.has(attributeName)) {
      throw unsupportedAttribute(path, attributeName, '属性未登记在首期 SVG 子集中。');
    }

    validateAttributeValue(name, attributeName, value, path, state, policy);
  }
}

function validateAttributeValue(
  elementNameValue: string,
  attributeName: string,
  value: string,
  path: string,
  state: AdmissionState,
  policy: SvgPhase0AdmissionPolicy
): void {
  if (attributeName === 'xmlns') {
    if (value !== SVG_NAMESPACE)
      throw unsupportedAttribute(path, attributeName, 'SVG namespace 不正确。');
    return;
  }
  if (attributeName === 'viewBox') {
    parseViewBox(value, path);
    return;
  }
  if (attributeName === 'id') {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value)) {
      throw unsupportedAttribute(path, attributeName, 'id 不是稳定的本地标识符。');
    }
    if (state.ids.has(value)) {
      throw unsupportedAttribute(path, attributeName, `id "${value}" 重复。`);
    }
    state.ids.set(value, path);
    state.idElementNames.set(value, elementNameValue);
    return;
  }
  if (attributeName === 'd') {
    const segments = countSvgPathSegments(value, path);
    state.pathSegments += segments;
    if (state.pathSegments > policy.maxPathSegments) {
      throw resourceLimit('pathSegments', state.pathSegments, policy.maxPathSegments, path);
    }
    return;
  }
  if (attributeName === 'points') {
    validatePoints(value, path);
    return;
  }
  if (attributeName === 'transform' || attributeName === 'gradientTransform') {
    validateTransform(value, path, attributeName);
    state.hasTransform = true;
    return;
  }
  if (attributeName === 'fill' || attributeName === 'stroke') {
    validatePaint(value, path, attributeName, state);
    return;
  }
  if (attributeName.startsWith('marker-')) {
    if (value === 'none') return;
    state.references.push(parseLocalReference(value, path, attributeName, new Set(['marker'])));
    return;
  }
  if (attributeName === 'stop-color') {
    validateColor(value, path, attributeName);
    return;
  }
  if (
    ['linearGradient', 'radialGradient'].includes(elementNameValue) &&
    ['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'fx', 'fy', 'fr'].includes(attributeName)
  ) {
    parseNumberOrPercentage(value, path, attributeName);
    return;
  }
  if (GEOMETRY_NUMBER_ATTRIBUTES.has(attributeName)) {
    const number = parseFiniteNumber(value, path, attributeName);
    if (NON_NEGATIVE_NUMBER_ATTRIBUTES.has(attributeName) && number < 0) {
      throw unsupportedAttribute(path, attributeName, '属性不能为负数。');
    }
    if (POSITIVE_NUMBER_ATTRIBUTES.has(attributeName) && number <= 0) {
      throw unsupportedAttribute(path, attributeName, '属性必须是正数。');
    }
    return;
  }
  if (OPACITY_ATTRIBUTES.has(attributeName)) {
    parseUnitInterval(value, path, attributeName);
    return;
  }
  if (attributeName === 'offset') {
    parseOffset(value, path);
    return;
  }
  if (attributeName === 'stroke-dasharray') {
    validateDashArray(value, path);
    return;
  }
  if (attributeName === 'stroke-linecap') {
    requireOneOf(value, ['butt', 'round', 'square'], path, attributeName);
    return;
  }
  if (attributeName === 'stroke-linejoin') {
    requireOneOf(value, ['miter', 'round', 'bevel'], path, attributeName);
    return;
  }
  if (attributeName === 'font-weight') {
    if (!['normal', 'bold'].includes(value) && !/^[1-9]00$/.test(value)) {
      throw unsupportedAttribute(
        path,
        attributeName,
        'font-weight 只允许 normal、bold 或 100–900。'
      );
    }
    return;
  }
  if (attributeName === 'font-style') {
    requireOneOf(value, ['normal', 'italic'], path, attributeName);
    return;
  }
  if (attributeName === 'text-anchor') {
    requireOneOf(value, ['start', 'middle', 'end'], path, attributeName);
    return;
  }
  if (attributeName === 'dominant-baseline') {
    requireOneOf(
      value,
      ['auto', 'alphabetic', 'central', 'middle', 'hanging'],
      path,
      attributeName
    );
    return;
  }
  if (attributeName === 'gradientUnits') {
    requireOneOf(value, ['objectBoundingBox', 'userSpaceOnUse'], path, attributeName);
    return;
  }
  if (attributeName === 'spreadMethod') {
    requireOneOf(value, ['pad', 'reflect', 'repeat'], path, attributeName);
    return;
  }
  if (attributeName === 'markerUnits') {
    requireOneOf(value, ['strokeWidth', 'userSpaceOnUse'], path, attributeName);
    return;
  }
  if (attributeName === 'orient') {
    if (!['auto', 'auto-start-reverse'].includes(value))
      parseFiniteNumber(value, path, attributeName);
    return;
  }
  if (attributeName === 'preserveAspectRatio') {
    if (!/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(value)) {
      throw unsupportedAttribute(path, attributeName, 'preserveAspectRatio 不是登记形式。');
    }
    return;
  }
  if (attributeName === 'xml:space') {
    requireOneOf(value, ['default', 'preserve'], path, attributeName);
    return;
  }
  if (attributeName === 'version') {
    requireOneOf(value, ['1.1', '2.0'], path, attributeName);
    return;
  }
  if (attributeName === 'font-family') {
    if (value.length === 0 || /[<>]|url\s*\(/i.test(value)) {
      throw unsupportedAttribute(path, attributeName, 'font-family 不是安全的纯字体族声明。');
    }
  }
}

function validateReferences(state: AdmissionState): void {
  for (const reference of state.references) {
    const targetElementName = state.idElementNames.get(reference.targetId);
    if (!targetElementName || !reference.expectedElementNames.has(targetElementName)) {
      throw new SvgPhase0AdmissionError(
        'slides.svg.external_reference_forbidden',
        `${reference.attribute} 引用了缺失或类型不正确的本地 id "${reference.targetId}"。`,
        reference.sourcePath
      );
    }
  }
}

function validatePaint(
  value: string,
  path: string,
  attributeName: string,
  state: AdmissionState
): void {
  if (value === 'none' || value === 'transparent') return;
  if (/^url\s*\(/i.test(value)) {
    state.references.push(
      parseLocalReference(value, path, attributeName, new Set(['linearGradient', 'radialGradient']))
    );
    return;
  }
  validateColor(value, path, attributeName);
}

function validateColor(value: string, path: string, attributeName: string): void {
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
  throw unsupportedAttribute(path, attributeName, '颜色只允许 hex 或数值 rgb/rgba。');
}

function validateChildElement(parentName: string, childName: string, childPath: string): void {
  if (childName === 'title' || childName === 'desc') return;
  const valid =
    ((parentName === 'svg' || parentName === 'g') && CONTAINER_CHILDREN.has(childName)) ||
    (parentName === 'defs' && ['linearGradient', 'radialGradient', 'marker'].includes(childName)) ||
    ((parentName === 'linearGradient' || parentName === 'radialGradient') &&
      childName === 'stop') ||
    (parentName === 'marker' && CONTAINER_CHILDREN.has(childName) && childName !== 'defs') ||
    ((parentName === 'text' || parentName === 'tspan') && childName === 'tspan');
  if (!valid) {
    throw new SvgPhase0AdmissionError(
      'slides.svg.unsupported_element',
      `SVG 首期子集不允许 <${parentName}> 包含 <${childName}>。`,
      childPath
    );
  }
}

function parseLocalReference(
  value: string,
  path: string,
  attributeName: string,
  expectedElementNames: ReadonlySet<string>
): LocalReference {
  const match = /^url\(\s*#([A-Za-z_][A-Za-z0-9_.-]*)\s*\)$/.exec(value);
  if (!match) {
    throw new SvgPhase0AdmissionError(
      'slides.svg.external_reference_forbidden',
      `${attributeName} 只允许同一 SVG 内的 url(#id) 引用。`,
      path
    );
  }
  const targetId = match[1];
  if (!targetId) {
    throw new SvgPhase0AdmissionError(
      'slides.svg.external_reference_forbidden',
      `${attributeName} 缺少本地引用 id。`,
      path
    );
  }
  return { sourcePath: path, attribute: attributeName, targetId, expectedElementNames };
}

function validateTransform(value: string, path: string, attributeName: string): void {
  const functionPattern = /([A-Za-z]+)\s*\(([^)]*)\)/g;
  let matched = '';
  let count = 0;
  for (const match of value.matchAll(functionPattern)) {
    count += 1;
    matched += match[0];
    const kind = match[1];
    const args = parseNumberList(match[2], path, attributeName);
    if (kind === 'translate' && (args.length === 1 || args.length === 2)) continue;
    if (kind === 'scale' && (args.length === 1 || args.length === 2)) continue;
    if (kind === 'rotate' && (args.length === 1 || args.length === 3)) continue;
    throw unsupportedAttribute(
      path,
      attributeName,
      `transform 函数 ${kind} 不在允许范围或参数数量不正确。`
    );
  }
  const normalizedInput = value.replace(/[\s,]+/g, '');
  const normalizedMatched = matched.replace(/[\s,]+/g, '');
  if (count === 0 || normalizedInput !== normalizedMatched) {
    throw unsupportedAttribute(
      path,
      attributeName,
      'transform 只能组合 translate、scale、rotate。'
    );
  }
}

function parseRequiredViewBox(value: string | null): { width: number; height: number } {
  if (!value) {
    throw new SvgPhase0AdmissionError(
      'slides.svg.missing_viewbox',
      'SVG 必须声明 viewBox。',
      '/svg[1]'
    );
  }
  const [x, y, width, height] = parseViewBox(value, '/svg[1]');
  if (x !== 0 || y !== 0 || width <= 0 || height <= 0) {
    throw new SvgPhase0AdmissionError(
      'slides.svg.missing_viewbox',
      'SVG viewBox 必须使用 0 0 原点和有限正数宽高。',
      '/svg[1]'
    );
  }
  return { width, height };
}

function parseViewBox(value: string, path: string): readonly [number, number, number, number] {
  const values = parseNumberList(value, path, 'viewBox');
  if (values.length !== 4 || values[2] <= 0 || values[3] <= 0) {
    throw unsupportedAttribute(path, 'viewBox', 'viewBox 必须包含四个数且宽高为正数。');
  }
  return [values[0], values[1], values[2], values[3]];
}

function unsupportedAttribute(
  path: string,
  attributeName: string,
  detail: string
): SvgPhase0AdmissionError {
  return unsupportedSvgPhase0Attribute(path, attributeName, detail);
}

function resourceLimit(
  metric: string,
  actual: number,
  limit: number,
  path?: string
): SvgPhase0AdmissionError {
  return new SvgPhase0AdmissionError(
    'slides.svg.resource_limit_exceeded',
    `SVG ${metric}=${actual} 超过 Phase 0 上限 ${limit}。`,
    path
  );
}
