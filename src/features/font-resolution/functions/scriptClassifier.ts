import type { ScriptClass } from '../definitions/types.js';

const EAST_ASIAN_PRIORITY_RATIO = 0.3;

interface ScriptCounts {
  latin: number;
  eastAsian: number;
  complex: number;
}

export function classifyDominantScript(text: string): ScriptClass {
  const counts: ScriptCounts = {
    latin: 0,
    eastAsian: 0,
    complex: 0,
  };

  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint == null) {
      continue;
    }

    const script = classifyCodePoint(codePoint);
    if (script != null) {
      counts[script] += 1;
    }
  }

  const totalClassified = counts.latin + counts.eastAsian + counts.complex;
  if (totalClassified === 0) {
    return 'latin';
  }

  // CJK 字形通常接近 1em，少量汉字也会显著改变行宽和 fallback 字体选择；
  // 因此混排文本只要 eastAsian 超过 30%，就优先按东亚脚本处理。
  if (counts.eastAsian / totalClassified > EAST_ASIAN_PRIORITY_RATIO) {
    return 'eastAsian';
  }

  if (counts.complex > counts.latin) {
    return 'complex';
  }

  if (counts.eastAsian > counts.latin && counts.eastAsian >= counts.complex) {
    return 'eastAsian';
  }

  return 'latin';
}

function classifyCodePoint(codePoint: number): ScriptClass | null {
  if (isEastAsianCodePoint(codePoint)) {
    return 'eastAsian';
  }
  if (isComplexCodePoint(codePoint)) {
    return 'complex';
  }
  if (isLatinCodePoint(codePoint)) {
    return 'latin';
  }
  return null;
}

function isEastAsianCodePoint(codePoint: number): boolean {
  return isInRange(codePoint, 0x2E80, 0x2EFF) // CJK Radicals Supplement
    || isInRange(codePoint, 0x3000, 0x303F) // CJK Symbols and Punctuation
    || isInRange(codePoint, 0x3040, 0x309F) // Hiragana
    || isInRange(codePoint, 0x30A0, 0x30FF) // Katakana
    || isInRange(codePoint, 0x3100, 0x312F) // Bopomofo
    || isInRange(codePoint, 0x3130, 0x318F) // Hangul Compatibility Jamo
    || isInRange(codePoint, 0x31A0, 0x31BF) // Bopomofo Extended
    || isInRange(codePoint, 0x31F0, 0x31FF) // Katakana Phonetic Extensions
    || isInRange(codePoint, 0x3400, 0x4DBF) // CJK Unified Ideographs Extension A
    || isInRange(codePoint, 0x4E00, 0x9FFF) // CJK Unified Ideographs
    || isInRange(codePoint, 0xAC00, 0xD7AF) // Hangul Syllables
    || isInRange(codePoint, 0xF900, 0xFAFF) // CJK Compatibility Ideographs
    || isInRange(codePoint, 0x20000, 0x2A6DF) // CJK Unified Ideographs Extension B
    || isInRange(codePoint, 0x2A700, 0x2B73F) // CJK Unified Ideographs Extension C
    || isInRange(codePoint, 0x2B740, 0x2B81F) // CJK Unified Ideographs Extension D
    || isInRange(codePoint, 0x2B820, 0x2CEAF); // CJK Unified Ideographs Extensions E/F
}

function isComplexCodePoint(codePoint: number): boolean {
  return isInRange(codePoint, 0x0590, 0x05FF) // Hebrew
    || isInRange(codePoint, 0x0600, 0x06FF) // Arabic
    || isInRange(codePoint, 0x0750, 0x077F) // Arabic Supplement
    || isInRange(codePoint, 0x08A0, 0x08FF) // Arabic Extended-A
    || isInRange(codePoint, 0x0900, 0x097F) // Devanagari
    || isInRange(codePoint, 0x0980, 0x09FF) // Bengali
    || isInRange(codePoint, 0x0A00, 0x0A7F) // Gurmukhi
    || isInRange(codePoint, 0x0A80, 0x0AFF) // Gujarati
    || isInRange(codePoint, 0x0B00, 0x0B7F) // Oriya
    || isInRange(codePoint, 0x0B80, 0x0BFF) // Tamil
    || isInRange(codePoint, 0x0C00, 0x0C7F) // Telugu
    || isInRange(codePoint, 0x0C80, 0x0CFF) // Kannada
    || isInRange(codePoint, 0x0D00, 0x0D7F) // Malayalam
    || isInRange(codePoint, 0x0E00, 0x0E7F) // Thai
    || isInRange(codePoint, 0x0E80, 0x0EFF); // Lao
}

function isLatinCodePoint(codePoint: number): boolean {
  return isInRange(codePoint, 0x0041, 0x005A)
    || isInRange(codePoint, 0x0061, 0x007A)
    || isInRange(codePoint, 0x00C0, 0x024F); // Latin-1 Supplement + Latin Extended-A/B
}

function isInRange(codePoint: number, start: number, end: number): boolean {
  return codePoint >= start && codePoint <= end;
}
