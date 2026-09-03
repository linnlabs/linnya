export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
export const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';

/** 首期 canonical write 子集；文字继续由原生 Text 承担。 */
export const SVG_GRAPHIC_ALLOWED_ELEMENTS = new Set([
  'svg',
  'defs',
  'g',
  'title',
  'desc',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'linearGradient',
  'radialGradient',
  'stop',
  'marker',
]);

export const SVG_GRAPHIC_GLOBAL_ATTRIBUTES = new Set([
  'id',
  'fill',
  'stroke',
  'stroke-width',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'marker-start',
  'marker-mid',
  'marker-end',
  'transform',
]);

export const SVG_GRAPHIC_ELEMENT_ATTRIBUTES: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  svg: new Set(['xmlns', 'viewBox', 'width', 'height', 'preserveAspectRatio', 'version']),
  defs: new Set(),
  g: new Set(),
  title: new Set(['xml:space']),
  desc: new Set(['xml:space']),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'ry']),
  circle: new Set(['cx', 'cy', 'r']),
  ellipse: new Set(['cx', 'cy', 'rx', 'ry']),
  line: new Set(['x1', 'y1', 'x2', 'y2']),
  polyline: new Set(['points']),
  polygon: new Set(['points']),
  path: new Set(['d']),
  linearGradient: new Set([
    'x1',
    'y1',
    'x2',
    'y2',
    'gradientUnits',
    'gradientTransform',
    'spreadMethod',
  ]),
  radialGradient: new Set([
    'cx',
    'cy',
    'r',
    'fx',
    'fy',
    'fr',
    'gradientUnits',
    'gradientTransform',
    'spreadMethod',
  ]),
  stop: new Set(['offset', 'stop-color', 'stop-opacity']),
  marker: new Set([
    'viewBox',
    'refX',
    'refY',
    'markerWidth',
    'markerHeight',
    'markerUnits',
    'orient',
    'preserveAspectRatio',
  ]),
};

export const SVG_GRAPHIC_GEOMETRY_NUMBER_ATTRIBUTES = new Set([
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'rx',
  'ry',
  'cx',
  'cy',
  'r',
  'fx',
  'fy',
  'fr',
  'refX',
  'refY',
  'markerWidth',
  'markerHeight',
  'stroke-width',
]);

export const SVG_GRAPHIC_OPACITY_ATTRIBUTES = new Set([
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'stop-opacity',
]);

export const SVG_GRAPHIC_NON_NEGATIVE_NUMBER_ATTRIBUTES = new Set([
  'rx',
  'ry',
  'stroke-width',
]);

export const SVG_GRAPHIC_POSITIVE_NUMBER_ATTRIBUTES = new Set([
  'width',
  'height',
  'r',
  'markerWidth',
  'markerHeight',
]);

export const SVG_GRAPHIC_DRAWABLE_ELEMENTS = new Set([
  'g',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
]);

export const SVG_GRAPHIC_METADATA_PARENTS = new Set([
  'svg',
  'g',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'marker',
]);
