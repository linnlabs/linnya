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

export const SHARED_IMPLEMENTATION_RULES: readonly SharedImplementationRule[] = [
  {
    id: 'FOUNDATION-error-to-string',
    // 退役 Mindmap 不参与本轮迁移；旧规则的 Mindmap 基线仍保留。
    exclude: ['packages/plugins/mindmap/'],
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
    pattern: /\b(?:function\s+clamp\s*\(|const\s+clamp\s*=)/u,
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
];
