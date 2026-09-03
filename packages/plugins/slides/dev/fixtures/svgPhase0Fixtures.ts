export interface SvgPhase0Fixture {
  readonly id: string;
  readonly description: string;
  readonly source: string;
}

export interface SvgPhase0InvalidFixture extends SvgPhase0Fixture {
  readonly expectedCode:
    | 'slides.svg.invalid_xml'
    | 'slides.svg.missing_viewbox'
    | 'slides.svg.unsupported_element'
    | 'slides.svg.unsupported_attribute'
    | 'slides.svg.external_reference_forbidden'
    | 'slides.svg.resource_limit_exceeded';
}

export const SVG_PHASE_0_VALID_FIXTURES: readonly SvgPhase0Fixture[] = [
  {
    id: 'flow-gradient-marker',
    description: '流程节点、渐变、局部 marker 引用与中英文短标签',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="nodeFill" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1D4ED8"/>
      <stop offset="100%" stop-color="#7C3AED"/>
    </linearGradient>
    <radialGradient id="decisionFill" cx="50%" cy="45%" r="60%">
      <stop offset="0%" stop-color="#FEF3C7"/>
      <stop offset="100%" stop-color="#F59E0B"/>
    </radialGradient>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 Z" fill="#334155"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="640" height="360" fill="#F8FAFC"/>
  <rect x="44" y="130" width="150" height="86" rx="18" fill="url(#nodeFill)"/>
  <text x="119" y="166" fill="#FFFFFF" font-family="Arial, Microsoft YaHei" font-size="18" font-weight="700" text-anchor="middle">收集需求</text>
  <text x="119" y="192" fill="#DBEAFE" font-family="Arial" font-size="13" text-anchor="middle">Discover</text>
  <path d="M 194 173 C 232 173 242 173 276 173" fill="none" stroke="#334155" stroke-width="4" marker-end="url(#arrow)"/>
  <polygon points="330,108 388,173 330,238 272,173" fill="url(#decisionFill)" stroke="#B45309" stroke-width="3"/>
  <text x="330" y="168" fill="#78350F" font-family="Arial, Microsoft YaHei" font-size="16" font-weight="700" text-anchor="middle">可行？</text>
  <text x="330" y="191" fill="#92400E" font-family="Arial" font-size="12" text-anchor="middle">GO / NO-GO</text>
  <path d="M 388 173 C 430 173 438 173 472 173" fill="none" stroke="#334155" stroke-width="4" marker-end="url(#arrow)"/>
  <rect x="472" y="130" width="128" height="86" rx="18" fill="#0F766E"/>
  <text x="536" y="166" fill="#FFFFFF" font-family="Arial, Microsoft YaHei" font-size="18" font-weight="700" text-anchor="middle">交付</text>
  <text x="536" y="192" fill="#CCFBF1" font-family="Arial" font-size="13" text-anchor="middle">Deliver</text>
  <path d="M 330 238 C 330 292 206 292 119 216" fill="none" stroke="#DC2626" stroke-width="3" stroke-dasharray="8 6" marker-end="url(#arrow)"/>
  <text x="288" y="316" fill="#991B1B" font-family="Arial, Microsoft YaHei" font-size="13" text-anchor="middle">补充证据后重试</text>
</svg>`,
  },
  {
    id: 'transforms-and-curves',
    description: 'translate/scale/rotate、曲线路径、透明度与 tspan',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <rect x="0" y="0" width="640" height="360" fill="#07111F"/>
  <g transform="translate(84 58)">
    <ellipse cx="236" cy="122" rx="220" ry="100" fill="#0E7490" opacity="0.16"/>
    <path d="M 18 190 C 110 24 204 250 312 72 S 440 30 454 116" fill="none" stroke="#22D3EE" stroke-width="8" stroke-linecap="round"/>
    <g transform="translate(306 84) rotate(-12) scale(1.08)">
      <rect x="0" y="0" width="150" height="88" rx="16" fill="#172554" stroke="#818CF8" stroke-width="2"/>
      <text x="75" y="37" fill="#E0E7FF" font-family="Arial, Microsoft YaHei" font-size="18" font-weight="700" text-anchor="middle">
        <tspan x="75" dy="0">反馈回路</tspan>
        <tspan x="75" dy="24" fill="#A5B4FC" font-size="13">Feedback loop</tspan>
      </text>
    </g>
    <circle cx="18" cy="190" r="13" fill="#F8FAFC" stroke="#22D3EE" stroke-width="5"/>
    <circle cx="454" cy="116" r="13" fill="#F8FAFC" stroke="#818CF8" stroke-width="5"/>
  </g>
</svg>`,
  },
  {
    id: 'transparent-paths',
    description: '透明背景、arc/quadratic path、dash 与 line join',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <path d="M 80 250 Q 170 58 260 250 T 440 250" fill="none" stroke="#2563EB" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M 440 250 A 78 78 0 0 1 550 140" fill="none" stroke="#7C3AED" stroke-width="14" stroke-dasharray="18 10" stroke-linecap="round"/>
  <circle cx="80" cy="250" r="24" fill="#DBEAFE" stroke="#2563EB" stroke-width="5"/>
  <circle cx="550" cy="140" r="24" fill="#EDE9FE" stroke="#7C3AED" stroke-width="5"/>
  <text x="320" y="318" fill="#334155" font-family="Arial, Microsoft YaHei" font-size="18" font-weight="700" text-anchor="middle">矢量路径 · VECTOR PATH</text>
</svg>`,
  },
  {
    id: 'cjk-font-matrix',
    description: 'SVG text 的中英文字体替换矩阵',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <rect x="0" y="0" width="640" height="360" fill="#F8FAFC"/>
  <text x="36" y="52" fill="#0F172A" font-family="Arial" font-size="22" font-weight="700">Arial · 中文标签 ABC</text>
  <text x="36" y="108" fill="#1E3A8A" font-family="Arial Unicode MS" font-size="22" font-weight="700">Arial Unicode MS · 中文标签 ABC</text>
  <text x="36" y="164" fill="#155E75" font-family="Hiragino Sans GB" font-size="22" font-weight="700">Hiragino Sans GB · 中文标签 ABC</text>
  <text x="36" y="220" fill="#166534" font-family="STHeiti" font-size="22" font-weight="700">STHeiti · 中文标签 ABC</text>
  <text x="36" y="276" fill="#7C2D12" font-family="DengXian" font-size="22" font-weight="700">DengXian · 中文标签 ABC</text>
  <text x="36" y="332" fill="#581C87" font-family="sans-serif" font-size="22" font-weight="700">sans-serif · 中文标签 ABC</text>
</svg>`,
  },
];

export const SVG_PHASE_0_INVALID_FIXTURES: readonly SvgPhase0InvalidFixture[] = [
  {
    id: 'doctype-entity',
    description: 'DOCTYPE 与自定义实体',
    expectedCode: 'slides.svg.invalid_xml',
    source: `<!DOCTYPE svg [<!ENTITY leak SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text x="0" y="8">&leak;</text></svg>`,
  },
  {
    id: 'processing-instruction',
    description: '非 XML declaration 的 processing instruction',
    expectedCode: 'slides.svg.invalid_xml',
    source: `<?xml-stylesheet href="https://example.com/a.css"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>`,
  },
  {
    id: 'malformed-xml',
    description: '标签未闭合的 XML',
    expectedCode: 'slides.svg.invalid_xml',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g><rect width="10" height="10"/></svg>`,
  },
  {
    id: 'cdata',
    description: 'CDATA 文本节点',
    expectedCode: 'slides.svg.invalid_xml',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title><![CDATA[hidden]]></title></svg>`,
  },
  {
    id: 'missing-viewbox',
    description: '缺少 viewBox',
    expectedCode: 'slides.svg.missing_viewbox',
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>`,
  },
  {
    id: 'non-zero-viewbox-origin',
    description: '非零 viewBox 原点',
    expectedCode: 'slides.svg.missing_viewbox',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 2 10 10"><rect width="10" height="10"/></svg>`,
  },
  {
    id: 'script-event',
    description: 'script 与事件属性',
    expectedCode: 'slides.svg.unsupported_attribute',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" onload="alert(1)"/><script>alert(1)</script></svg>`,
  },
  {
    id: 'foreign-object',
    description: 'foreignObject 与 HTML',
    expectedCode: 'slides.svg.unsupported_element',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>`,
  },
  {
    id: 'external-image',
    description: '外部图片引用',
    expectedCode: 'slides.svg.unsupported_element',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="https://example.com/a.png" width="10" height="10"/></svg>`,
  },
  {
    id: 'external-paint',
    description: '外部 paint URL',
    expectedCode: 'slides.svg.external_reference_forbidden',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="url(https://example.com/p.svg#x)"/></svg>`,
  },
  {
    id: 'style-class',
    description: 'CSS style 与 class',
    expectedCode: 'slides.svg.unsupported_element',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>.x{fill:red}</style><rect class="x" width="10" height="10"/></svg>`,
  },
  {
    id: 'use-symbol',
    description: 'use/symbol 间接实例化',
    expectedCode: 'slides.svg.unsupported_element',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><symbol id="x"><circle cx="5" cy="5" r="5"/></symbol></defs><use href="#x"/></svg>`,
  },
  {
    id: 'matrix-transform',
    description: 'matrix transform',
    expectedCode: 'slides.svg.unsupported_attribute',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" transform="matrix(1 0 0 1 0 0)"/></svg>`,
  },
  {
    id: 'non-finite-number',
    description: '非有限几何数值',
    expectedCode: 'slides.svg.unsupported_attribute',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="NaN" cy="5" r="2"/></svg>`,
  },
  {
    id: 'invalid-path-arity',
    description: '参数数量不完整的 path',
    expectedCode: 'slides.svg.unsupported_attribute',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M 0 0 L 4"/></svg>`,
  },
  {
    id: 'nested-svg',
    description: '会引入第二 viewport 的嵌套 svg',
    expectedCode: 'slides.svg.unsupported_element',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><svg viewBox="0 0 5 5"><rect width="5" height="5"/></svg></svg>`,
  },
  {
    id: 'invalid-child-model',
    description: 'gradient 中混入绘图元素',
    expectedCode: 'slides.svg.unsupported_element',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><rect width="2" height="2"/></linearGradient></defs></svg>`,
  },
  {
    id: 'negative-radius',
    description: '负半径',
    expectedCode: 'slides.svg.unsupported_attribute',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="-1"/></svg>`,
  },
  {
    id: 'out-of-range-rgba',
    description: '越界 rgba 通道',
    expectedCode: 'slides.svg.unsupported_attribute',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="rgba(300,0,0,2)"/></svg>`,
  },
  {
    id: 'missing-local-reference',
    description: '缺失的本地 gradient 引用',
    expectedCode: 'slides.svg.external_reference_forbidden',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="url(#missing)"/></svg>`,
  },
  {
    id: 'duplicate-id',
    description: '重复本地 id',
    expectedCode: 'slides.svg.unsupported_attribute',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"/><radialGradient id="g"/></defs></svg>`,
  },
  {
    id: 'unknown-attribute',
    description: '未登记属性',
    expectedCode: 'slides.svg.unsupported_attribute',
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" data-surprise="1"/></svg>`,
  },
  {
    id: 'unknown-namespace',
    description: '未知 namespace 属性',
    expectedCode: 'slides.svg.unsupported_attribute',
    source: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:evil="urn:evil" viewBox="0 0 10 10"><rect evil:x="1" width="10" height="10"/></svg>`,
  },
];
