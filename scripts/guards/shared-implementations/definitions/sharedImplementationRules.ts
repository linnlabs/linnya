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
  /** 只在这些目录下检查；省略表示全部扫描范围。 */
  readonly scope?: readonly string[];
  /** 共享实现自己所在的位置，不检查。 */
  readonly owners: readonly string[];
  /** 失败时告诉开发者该用什么。 */
  readonly use: string;
}

export const SHARED_IMPLEMENTATION_RULES: readonly SharedImplementationRule[] = [
  {
    id: 'LOCALIZATION-byte-size',
    pattern: /\b(?:function|const)\s+(?:formatFileSize|formatBytes|formatPluginSize|formatStorageBytes)\b/u,
    scope: ['apps/renderer/'],
    owners: ['apps/renderer/app/localization/'],
    use: '界面字节大小用 @app/localization 的 formatStorageBytes(bytes, locale)；未知大小文案由业务调用方保留。',
  },
  {
    id: 'FOUNDATION-is-record',
    pattern: /\b(?:function|const)\s+(?:isRecord|isPlainObject)\b/u,
    owners: ['packages/foundation/'],
    use: "用 @linnya/foundation 的 isRecord（非 null、不是数组）。要同时接受数组时写 Array.isArray(value) || isRecord(value)。",
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
