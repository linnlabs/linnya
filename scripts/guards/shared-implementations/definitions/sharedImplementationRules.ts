/**
 * 已经有共享实现的写法名单。名单里的写法只能出现在它的共享位置；别处的存量记在
 * `.baseline/shared-implementations.txt`，只许减少。规范见 docs/development/code-quality.md。
 *
 * 每统一一样东西，就在这里加一条：写清匹配什么、共享实现在哪、该怎么用。
 * 只收“定义了一份本地实现”这类确定的写法，不做近似匹配，避免误报。
 */
export interface SharedImplementationRule {
  readonly id: string;
  /** 逐行匹配；一行算一次。 */
  readonly pattern: RegExp;
  /** 仅完整函数体这类跨行规则使用；不把同样的内联表达式算成本地实现。 */
  readonly wholeSource?: boolean;
  /** 只在这些目录下检查；省略表示全部扫描范围。 */
  readonly scope?: readonly string[];
  /** 明确不参与本条新规则的源码范围；不改动旧规则的存量口径。 */
  readonly exclude?: readonly string[];
  /** 共享实现自己所在的位置，不检查。 */
  readonly owners: readonly string[];
  /** 失败时告诉开发者该用什么。 */
  readonly use: string;
}

/**
 * 颜色公式规则只看代码行：注释里写公式出处和系数不算本地实现。
 * 模式不带 g 标志，逐行匹配时不会残留 lastIndex。
 */
function colorCodeLine(source: string): RegExp {
  return new RegExp(`^(?!\\s*(?:\\*|//|/\\*)).*(?:${source})`, 'u');
}

/** 数字常量按前缀匹配，复制公式时截短小数位也拦得住。 */
function numberPrefixes(prefixes: readonly string[]): string {
  return prefixes.map(prefix => `\\b${prefix.replace('.', '\\.')}`).join('|');
}

/** OKLab 的 LMS 与 Lab 矩阵（Ottosson）。 */
const OKLAB_MATRIX_PREFIXES = [
  '0.412221', '0.536332', '0.051445', '0.211903', '0.680699', '0.107396', '0.088302', '0.281718', '0.629978',
  '0.210454', '0.793617', '0.004072', '1.977998', '2.428592', '0.450593', '0.025904', '0.782771', '0.808675',
  '0.396337', '0.215803', '0.105561', '0.063854', '0.089484', '1.291485',
  '4.076741', '3.307711', '0.230969', '1.268438', '2.609757', '0.341319', '0.004196', '0.703418', '1.707614',
] as const;

/** sRGB 与 XYZ 的转换矩阵（D65）和 CIELab 常量。 */
const CIE_CONSTANT_PATTERN = [
  numberPrefixes([
    '0.412456', '0.357576', '0.180437', '0.212672', '0.715152', '0.072175', '0.019333', '0.119192', '0.950304',
    '3.240454', '1.537138', '0.498531', '0.969266', '1.876010', '0.041556', '0.055643', '0.204025', '1.057225',
  ]),
  String.raw`\b0\.95047\b|\b1\.08883\b|\b95\.047\b|\b108\.883\b|\b0\.008856\b|\b0\.206897\b|\b903\.3\b|\b7\.787\b`,
  String.raw`\b216\s*/\s*24389\b|\b24389\s*/\s*27\b`,
].join('|');

/** Machado、Oliveira、Fernandes 2009 色觉异常矩阵。 */
const COLOR_VISION_MATRIX_PREFIXES = [
  '0.152286', '1.052583', '0.204868', '0.114503', '0.786281', '0.099216', '1.051998',
  '0.367322', '0.860646', '0.227968', '0.280085', '0.672501', '0.047413', '0.968881',
] as const;

export const SHARED_IMPLEMENTATION_RULES: readonly SharedImplementationRule[] = [
  {
    id: 'FOUNDATION-error-to-string',
    wholeSource: true,
    pattern: /\bfunction\s+(?:getErrorMessage|readErrorMessage|toErrorMessage|errorToString)\s*\(\s*(\w+)\s*:\s*unknown\s*\)\s*:\s*string\s*\{\s*return\s+\1\s+instanceof\s+Error\s*\?\s*\1\.message\s*:\s*String\(\1\)\s*;?\s*\}/gu,
    owners: ['packages/foundation/'],
    use: '原始错误转文字的同体本地函数使用 @linnya/foundation 的 errorToString；翻译、业务默认文案、DTO 错误字段读取仍归各 owner。',
  },
  {
    id: 'SLIDES-image-props',
    pattern: /\b(?:function|const)\s+buildPptxImageProps\b|\bconst\s+imgOpts\s*:\s*PptxGenJS\.ImageProps/u,
    scope: ['packages/plugins/slides/src/backend/engine/'],
    owners: ['packages/plugins/slides/src/backend/engine/assets/pptxImageProps.ts'],
    use: 'Slides 普通图片的 PPTX 参数使用 assets/pptxImageProps 的 buildPptxImageProps；编译器只确定最终位置。',
  },
  {
    id: 'SLIDES-freeform-transform',
    pattern: /\b(?:function|const)\s+(?:buildFreeformGroupTransform|measureFreeformChildrenBounds)\b|\bprivate\s+(?:buildGroupTransform|measureChildrenBounds)\s*\(/u,
    scope: ['packages/plugins/slides/src/backend/engine/'],
    owners: ['packages/plugins/slides/src/backend/engine/shared/freeformTransform.ts'],
    use: 'Freeform 坐标使用 shared/freeformTransform；OOXML parser 自己的 group transform 合同不在此规则内。',
  },
  {
    id: 'SLIDES-resource-consumer',
    pattern: /\bfunction\s+(?:waitForConsumer|waitForResourceConsumer|evictSettledRenderResources)\b/u,
    scope: ['packages/plugins/slides/src/renderer/'],
    owners: ['packages/plugins/slides/src/renderer/shared/renderResourceCache.ts'],
    use: '已完成资源淘汰和消费者等待使用 renderer/shared/renderResourceCache，保留 feature 自己的资源身份、容量与诊断。',
  },
  {
    id: 'MARKDOWN-strict-json',
    pattern: /\bfunction\s+(?:assertKnownAttributes|assertMarkJson|assertNodeJson)\b/u,
    scope: ['apps/renderer/domains/editor/', 'src/domains/markdown/', 'packages/markdown-document-core/'],
    owners: ['packages/markdown-document-core/'],
    use: 'Markdown JSON 严格 node/mark/attrs 校验使用 @linnya/markdown-document-core/validation 的 assertMarkdownDocument。',
  },
  {
    id: 'SCHEMAS-block-reference',
    pattern: /\b(?:(?<!declare )function|const)\s+(?:hashToBase62|refIdFromDigest|normalizeRef|stripRefPrefix|isValidRef|BASE62_CHARSET)\b/u,
    owners: ['packages/schemas/'],
    use: '块引用编码/规范化/校验使用 @app/schemas；平台适配只负责摘要计算和同步/异步调用。',
  },
  {
    id: 'SCHEMAS-text-units',
    pattern: /\b(?:(?<!declare )function|const)\s+(?:countTextUnitsZhEn|sliceTextByUnitsZhEn)\b/u,
    // declare 只描述 Host 合同，不是另一份运行实现。
    owners: ['packages/schemas/'],
    use: '字数与按单位截短使用 @app/schemas 的 countTextUnitsZhEn / sliceTextByUnitsZhEn。',
  },
  {
    id: 'LOCALIZATION-byte-size',
    pattern: /\b(?:function|const)\s+(?:formatFileSize|formatBytes|formatPluginSize|formatStorageBytes)\b/u,
    scope: ['apps/renderer/'],
    owners: ['apps/renderer/app/localization/'],
    use: '界面字节大小用 @app/localization 的 formatStorageBytes(bytes, locale)；未知大小文案由业务调用方保留。',
  },
  {
    id: 'FOUNDATION-object-like',
    pattern: /\b(?:function|const)\s+isObjectLike\b/u,
    owners: ['packages/foundation/'],
    use: '非 null 对象（包含数组和类实例）判断使用 @linnya/foundation 的 isObjectLike；不要与排除数组的 isRecord 混用同名。',
  },
  {
    id: 'FOUNDATION-is-record',
    pattern: /\b(?:function|const)\s+(?:isRecord|isPlainObject)\b/u,
    owners: ['packages/foundation/'],
    use: '用 @linnya/foundation 的 isRecord（非 null、不是数组）。需要保留数组语义时使用 isObjectLike；具体数据形状仍由 schema 校验。',
  },
  {
    id: 'FOUNDATION-clamp',
    pattern: /\b(?:function\s+clamp\s*\(|const\s+clamp\s*=\s*(?:function\b|(?:\([^)]*\)|[\w$]+)\s*(?::[^=]+)?=>))/u,
    owners: ['packages/foundation/'],
    use: '用 @linnya/foundation 的 clamp(value, min, max)。',
  },
  {
    id: 'FOUNDATION-sleep',
    pattern: /\b(?:function\s+(?:sleep|delay)\s*\(|const\s+(?:sleep|delay)\s*=\s*(?:async\s*)?\(?\s*\w+(?::\s*number)?\s*\)?\s*=>)/u,
    owners: ['packages/foundation/'],
    use: '用 @linnya/foundation 的 sleep(milliseconds)。',
  },
  {
    id: 'LOCALIZATION-date-display',
    pattern: /new Intl\.DateTimeFormat\(|\.toLocale(?:Date|Time)String\(/u,
    scope: ['apps/renderer/'],
    owners: ['apps/renderer/app/localization/'],
    use: '界面显示时间用 @app/localization 的 useHistoryTime（historyTime / historyDateTime）；规则在 @app/schemas 的 history-time。',
  },
  {
    id: 'BACKEND-sqlite-preview-rollback',
    pattern: /\bclass\s+DryRun\b|\bthrow\s+(?:ROLLBACK|new\s+DryRun)\b/u,
    scope: ['src/', 'packages/plugins/'],
    owners: ['src/shared/database/previewInRolledBackTransaction.ts'],
    use: '“在事务里试做一次再整体回滚”的预览用 src/shared/database/previewInRolledBackTransaction；不要再定义回滚哨兵。',
  },
  {
    id: 'SEMANTIC-object-versions',
    pattern: /\bconst\s+KEPT_\w*VERSIONS\s*=|INSERT INTO semantic_object_versions\b/u,
    scope: ['src/domains/semantic-layer/'],
    owners: ['src/domains/semantic-layer/infrastructure/sqlite/semanticObjectStorage.ts'],
    use: '语义对象的值与版本写入、版本保留数用 infrastructure/sqlite/semanticObjectStorage（recordSemanticObjectVersion、KEPT_SEMANTIC_VERSIONS）；标签创建者与结构改动的操作者用同文件的 createSemanticActorReader。',
  },
  {
    id: 'COLOR-srgb-transfer',
    pattern: colorCodeLine(String.raw`\b0\.04045\b|\b0\.03928\b|\b0\.0031308\b|\b12\.92\b|\b1\.055\b|Math\.pow\([^,]*255[^,]*,\s*2\.[24]\)|255\s*\)?\s*\*\*\s*2\.[24]`),
    owners: ['packages/color-core/'],
    use: 'sRGB 与线性光互转用 @linnya/color-core 的 srgbChannelToLinear / linearToSrgbChannel；相对亮度、对比度、混色、OKLab 转换已经包含，不要再写传递函数常量。GLSL 等不经过 TypeScript 的着色器不在此规则内。',
  },
  {
    id: 'COLOR-luminance-weights',
    pattern: colorCodeLine(String.raw`\b0\.2126\b|\b0\.7152\b|\b0\.0722\b|\b0\.299\b.*\b0\.587\b|\b0\.587\b.*\b0\.114\b|\b0\.299\b.*\b0\.114\b`),
    owners: ['packages/color-core/'],
    use: '明度与对比度用 @linnya/color-core 的 relativeLuminance / contrastRatio（WCAG 2.x）；不要再手写 Rec.709 或 Rec.601 的明度系数。确需另一种明度口径时加进 color-core 并写清口径。',
  },
  {
    id: 'COLOR-space-constants',
    pattern: colorCodeLine([numberPrefixes(OKLAB_MATRIX_PREFIXES), CIE_CONSTANT_PATTERN, numberPrefixes(COLOR_VISION_MATRIX_PREFIXES)].join('|')),
    owners: ['packages/color-core/'],
    use: 'OKLab / OKLCH、XYZ / CIELab、色觉异常模拟的矩阵与常量只放在 @linnya/color-core（rgbToOklab、oklabToLinearRgb、rgbToOklch、simulateColorVisionDeficiency）；缺少转换时加进 color-core，不在调用方抄一份。',
  },
  {
    id: 'COLOR-hue-math',
    pattern: /\b(?:function|const)\s+(?:\w+To(?:Hsl|Hsv|Hsb|Hwb|Oklab|Oklch|Lab|Lch|Xyz)|(?:hsl|hsv|hsb|hwb|oklab|oklch|lab|lch|xyz)To[A-Z]\w*)\b|Math\.atan2\(\s*(?:[\w.]+\.)?b\s*,\s*(?:[\w.]+\.)?a\s*\)|Math\.atan2\(\s*\w*[sS]in\w*\s*,\s*\w*[cC]os\w*\s*\)/u,
    owners: ['packages/color-core/'],
    use: '色相与色彩空间转换用 @linnya/color-core（rgbToOklch、oklchToRgb、normalizeHue、hueDistance、isHueWithinArc）；不要另写 HSL / HSV / OKLCH 转换或色相圆形平均。需要的运算 color-core 没有时，加进 color-core 再用。',
  },
  {
    id: 'COLOR-delta-e',
    pattern: /\b(?:function|const)\s+(?:\w*[dD]eltaE(?:\d+|OK|Lab|Oklab)?|\w*(?:ciede|CIEDE)\w*)\b|\bdL\b.*\bda\b.*\bdb\b/u,
    owners: ['packages/color-core/'],
    use: '色差用 @linnya/color-core 的 deltaEOK（OKLab 欧氏距离，与色相、中性判断同一口径）；不要另写 ΔE76 / ΔE2000 或自己的 Lab 距离。',
  },
];
