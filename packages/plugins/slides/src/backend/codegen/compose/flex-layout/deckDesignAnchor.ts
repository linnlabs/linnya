/**
 * Deck Consistency Anchor —— 跨页一致性的最小充分集（Doc 19 §4.1）
 *
 * 把已有 deck 的 `theme`（ThemeSpec 的子集）
 * 映射成一个可直接注入到 deck.js compose sandbox 的 `DECK_DESIGN` 常量，
 * 让弱模型在新增/编辑页面时引用主色 / 主字体，避免跨页漂移。
 *
 * 设计原则：
 * - **最小集**：只暴露主色 + accent + 主字体，不复刻整个 token tree；
 * - **零强制**：值缺失时返回 null，sandbox 端 AI 自由发挥；
 * - **零硬约束**：不会基于 DECK_DESIGN 改写 AI 写出来的代码；
 * - **零语义依赖**：不传 spacing / shadow / borderRadius 等"装饰细节"，避免锁死风格。
 */

import type { ThemeSpec } from '@plugin/slides/shared';

/**
 * 注入到 sandbox 的 DECK_DESIGN 形态。
 *
 * 字段命名使用更直白的“AI 写代码视角”语义
 * （accent1 / accent2 / major / minor），
 * 同时也对应 Doc 19 §4.1 描述的接口。
 */
export interface DeckDesignAnchor {
  palette: {
    /** 第一强调色（对应 theme.colors.accent1） */
    accent1?: string;
    /** 第二强调色（对应 theme.colors.accent2） */
    accent2?: string;
    /** 第三强调色（对应 theme.colors.accent3） */
    accent3?: string;
    /** 页面背景（对应 theme.colors.background） */
    background?: string;
    /** 主文本色（对应 theme.colors.text） */
    text?: string;
    /** 弱文本色 / 辅助色（对应 theme.colors.muted） */
    muted?: string;
  };
  fonts: {
    /** 标题/主字体（对应 theme.fonts.major） */
    major?: string;
    /** 正文/次字体（对应 theme.fonts.minor） */
    minor?: string;
  };
}

/**
 * 把 deck 的 `theme` 映射成 sandbox 可消费的 DECK_DESIGN 常量。
 *
 * 返回值约定（**仅 build 这一步可能返回 null**；序列化阶段会再统一吃掉 null 转空骨架）：
 * - 若 theme 为 undefined / null → 返回 null
 * - 若 theme 存在但所有可映射字段都是空字符串 → 返回 `{ palette: {}, fonts: {} }`
 *
 * 实际暴露给 sandbox 的 `DECK_DESIGN` 永远是非 null 对象（详见 `serializeDeckDesignAnchor`），
 * AI 看到字段非空就"必须复用此色"，看到字段为 undefined 就"无锚点、用 ?? 兜底色"。
 */
export function buildDeckDesignAnchor(
  theme: ThemeSpec | undefined | null,
): DeckDesignAnchor | null {
  if (!theme) return null;

  const palette: DeckDesignAnchor['palette'] = {};
  const fonts: DeckDesignAnchor['fonts'] = {};

  const colors = theme.colors;
  if (colors) {
    assignIfNonEmptyString(palette, 'accent1', colors.accent1);
    assignIfNonEmptyString(palette, 'accent2', colors.accent2);
    assignIfNonEmptyString(palette, 'accent3', colors.accent3);
    assignIfNonEmptyString(palette, 'background', colors.background);
    assignIfNonEmptyString(palette, 'text', colors.text);
    assignIfNonEmptyString(palette, 'muted', colors.muted);
  }

  if (theme.fonts) {
    assignIfNonEmptyString(fonts, 'major', theme.fonts.major);
    assignIfNonEmptyString(fonts, 'minor', theme.fonts.minor);
  }

  return { palette, fonts };
}

function assignIfNonEmptyString<T extends Record<string, string | undefined>, K extends keyof T>(
  target: T,
  key: K,
  value: unknown,
): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed.length === 0) return;
  target[key] = trimmed as T[K];
}

/**
 * 序列化 anchor 内嵌段（palette / fonts）的形态：
 * 仅包含字符串字段，可直接放进 sandbox `inputs`（属于 SandboxJsonValue 子集）。
 */
export type SerializedDeckDesignAnchor = {
  palette: { [key: string]: string };
  fonts: { [key: string]: string };
};

/**
 * 把 DeckDesignAnchor 序列化成 sandbox `inputs` 字段（纯 JSON 对象）。
 *
 * - sandbox 的 `inputs` 要求只包含 SandboxJsonValue（基础类型 / 对象 / 数组）；
 * - 这里显式构造一遍，过滤掉 undefined，避免污染 sandbox global；
 * - 输出的每个嵌套字段值都是 string，直接满足 SandboxJsonObject 约束。
 *
 * **永不返回 null** —— 即便 anchor 为 null，也输出空骨架 `{ palette:{}, fonts:{} }`，
 * 这样 sandbox 端 AI 写 `DECK_DESIGN.palette.accent1` 不会再 NPE，
 * 只会拿到 `undefined`，配合 `??` 兜底色即可（详见 SKILL.md "DECK_DESIGN fallback"）。
 */
export function serializeDeckDesignAnchor(anchor: DeckDesignAnchor | null): SerializedDeckDesignAnchor {
  if (!anchor) return { palette: {}, fonts: {} };
  return {
    palette: pickDefinedStrings(anchor.palette),
    fonts: pickDefinedStrings(anchor.fonts),
  };
}

/** 创建一个空 DECK_DESIGN 骨架。供 sandbox 默认值与外部 fallback 复用，避免散落的 `{ palette:{}, fonts:{} }` 字面量。 */
export function emptyDeckDesignAnchor(): SerializedDeckDesignAnchor {
  return { palette: {}, fonts: {} };
}

function pickDefinedStrings(source: Record<string, string | undefined>): { [key: string]: string } {
  const out: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}
