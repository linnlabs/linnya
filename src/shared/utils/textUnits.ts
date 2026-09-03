/**
 * @file src/shared/utils/textUnits.ts
 *
 * @description
 * 统一的“文本长度单位”统计与截断工具（用于知识库 chunk 切分 & deep_search 拼装预览）。
 *
 * 设计目标：
 * - 统一口径：同一段文本在不同模块（切分/拼装/展示）长度判断结果一致；
 * - 面向中文/英文：中文按“汉字数”计，英文按“单词数”计；
 * - 稳健：对混合文本、标点、空白、emoji 等字符有确定性行为，且不会陷入死循环。
 *
 * 计数规则（当前版本）：
 * - 中文（汉字，CJK Unified Ideographs）：每个汉字计 1；
 * - 英文/数字：连续的 [A-Za-z0-9] 视为一个“词”，计 1；
 * - 空白与常见标点：不计数（0）；
 * - 其他字符（例如 emoji、其他语种字母）：计 1（保证不会出现“无单位但无限长”的文本）。
 */

export type TextUnitKind = 'han' | 'en_word' | 'other' | 'ignored';

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\v';
}

function isAsciiLetterOrDigit(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) // a-z
  );
}

/**
 * 判断是否为 CJK 统一汉字（覆盖最常见中文汉字区段）。
 *
 * 注意：
 * - 这里以“字符”为单位（Unicode code point）。JS 的 `for...of` 会按 code point 迭代；
 * - 不试图覆盖所有历史汉字扩展区，但已足以满足中文正文场景的稳定计数。
 */
function isHanCodePoint(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Unified Ideographs Extension A
    (cp >= 0x20000 && cp <= 0x2a6df) || // Extension B
    (cp >= 0x2a700 && cp <= 0x2b73f) || // Extension C
    (cp >= 0x2b740 && cp <= 0x2b81f) || // Extension D
    (cp >= 0x2b820 && cp <= 0x2ceaf) || // Extension E
    (cp >= 0x2ceb0 && cp <= 0x2ebef) // Extension F (partial)
  );
}

/**
 * 常见标点判断：不计数。
 * - 这里仅覆盖最常见的一批，避免误把正文符号计入长度；
 * - 对“未覆盖的符号”按 other=1 计，保证稳定。
 */
function isCommonPunctuation(ch: string): boolean {
  // 中英文标点 + 常见符号
  const punct = new Set<string>([
    '。', '，', '、', '；', '：', '？', '！', '（', '）', '【', '】', '《', '》', '“', '”', '‘', '’', '—', '…',
    '.', ',', ';', ':', '?', '!', '(', ')', '[', ']', '{', '}', '"', '\'', '-', '–', '—',
    '/', '\\', '|', '@', '#', '$', '%', '^', '&', '*', '+', '=', '<', '>', '~', '`',
  ]);
  return punct.has(ch);
}

/**
 * 统计文本的“字/词单位数”。
 */
export function countTextUnitsZhEn(text: string): number {
  let count = 0;
  let inAsciiWord = false;

  // 使用 for...of：按 code point 迭代（避免 surrogate pair 被拆成两个 code unit）
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;

    if (isWhitespace(ch) || isCommonPunctuation(ch)) {
      // 空白/标点：不计数，同时结束英文单词序列
      inAsciiWord = false;
      continue;
    }

    if (isHanCodePoint(cp)) {
      // 汉字：每个计 1，同时结束英文单词序列
      count += 1;
      inAsciiWord = false;
      continue;
    }

    // 英文/数字按“连续序列”计 1 个词
    if (isAsciiLetterOrDigit(cp)) {
      if (!inAsciiWord) {
        count += 1;
        inAsciiWord = true;
      }
      continue;
    }

    // 其他字符：计 1，结束英文单词序列
    count += 1;
    inAsciiWord = false;
  }

  return count;
}

/**
 * 将文本截断到最多 maxUnits 个“字/词单位”，返回截断后的字符串。
 *
 * 重要约束：
 * - 尽量保持英文单词整体不被截断（遇到超限则停止，不拆分单词）；
 * - 空白/标点不计数，但为了可读性会被保留（直到遇到超限停止点为止）。
 */
export function sliceTextByUnitsZhEn(text: string, maxUnits: number): string {
  if (maxUnits <= 0) return '';
  if (!text) return '';

  let units = 0;
  let inAsciiWord = false;
  let asciiWordStartedAt = -1; // 用于回退：如果单词计入导致超限，回退到单词开始前

  // 使用“按 code unit 索引”的方式构建 slice 边界：for...of 无法直接拿到索引，因此手动遍历
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i);
    if (cp === undefined) break;
    const ch = String.fromCodePoint(cp);
    const nextI = i + ch.length; // 1 或 2（surrogate pair）

    if (isWhitespace(ch) || isCommonPunctuation(ch)) {
      // 空白/标点：不计数，直接纳入
      inAsciiWord = false;
      asciiWordStartedAt = -1;
      i = nextI;
      continue;
    }

    if (isHanCodePoint(cp)) {
      if (units + 1 > maxUnits) {
        return text.slice(0, i);
      }
      units += 1;
      inAsciiWord = false;
      asciiWordStartedAt = -1;
      i = nextI;
      continue;
    }

    if (isAsciiLetterOrDigit(cp)) {
      if (!inAsciiWord) {
        // 即将开始一个新单词：先检查是否还能容纳 1 个“词单位”
        if (units + 1 > maxUnits) {
          return text.slice(0, i);
        }
        units += 1;
        inAsciiWord = true;
        asciiWordStartedAt = i;
      }
      i = nextI;
      continue;
    }

    // 其他字符：计 1
    if (units + 1 > maxUnits) {
      // 如果刚好处在英文单词内部（理论上不会，因为 ascii 分支已 continue），做一次防御性回退
      if (asciiWordStartedAt >= 0) return text.slice(0, asciiWordStartedAt);
      return text.slice(0, i);
    }
    units += 1;
    inAsciiWord = false;
    asciiWordStartedAt = -1;
    i = nextI;
  }

  return text;
}

