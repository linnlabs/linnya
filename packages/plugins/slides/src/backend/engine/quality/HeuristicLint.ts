/**
 * HeuristicLint
 *
 * AestheticLint 的 **第 2 层启发式（Tier-2）** 子模块，独立于纯几何 / 颜色规则的
 * 第 1 层（AestheticLint Tier-1）。
 *
 * 设计原则（来自 Doc 19 §4.3.2）：
 * - 在 Linnya **去语义化**（取消 role=title/footer/source 等标签）的前提下，
 *   仍可通过启发式近似恢复"角色"信号——但**所有规则只能输出 `info` 级**，
 *   因为它们必然存在误判（装饰性大字会被当成 title、封面 chart 不需要 source 等）。
 * - **默认关闭**。仅当调用方（例如 `ppt_inspect({ heuristics: true })`）显式启用时
 *   才合并到 `AestheticLintReport.aesthetic` 中，避免在主流程制造虚假告警噪声。
 * - 输出严格服用 `AestheticLintIssue` 接口，使其能直接复用 P1-C 第 1 批
 *   接通的 diagnostics → suggestion → observation 管道，无需额外管道改造。
 *
 * 加入新规则的门槛：
 * 1. 必须能合理写出 `suggestion`（弱模型才知道怎么修）。
 * 2. 必须列出"可能误判的场景"（写在 JSDoc + message / suggestion 中），让 AI 自审。
 * 3. 不依赖 scene graph 的语义角色字段（保持去语义稳定性）。
 */

import {
  flattenSlideElements,
  type PresentationInfo,
  type SlideElementInfo,
} from '@plugin/slides/shared';
import type { AestheticLintIssue } from './AestheticLint.js';
import { buildDiagnosticNodeRef } from './functions/buildDiagnosticNodeRef.js';

/* ─── 阈值常量 ─────────────────────────────────────────────────────────── */

/** 若单页"最大字号文本"低于该值，提示 probable-title 偏小。Doc 19 §4.3.2 取 14pt。 */
const PROBABLE_TITLE_MIN_PT = 14;

/**
 * 判定 probable-title 启发式时要求页面至少有 N 个文本元素，
 * 否则单条 caption / 单条 footer 等会被错当成"主标题"。
 */
const PROBABLE_TITLE_MIN_TEXT_COUNT = 2;

/** 数据页面"底部区域"占比（0.15 = 画布底部 15%）。 */
const SOURCE_FOOTER_BOTTOM_RATIO = 0.15;

/* ─── Tier-3 文字型启发式阈值 ─────────────────────────────────────────── */

/** 段落过长字符阈值。中英文统一按 char.length 计；> 80 视为偏长。 */
const PARAGRAPH_TOO_LONG_CHARS = 80;

/** 段落过长的"非标题"字号上限。> 该字号视为标题，不参与本规则。 */
const PARAGRAPH_BODY_FONT_CEIL_PT = 18;

/** 主标题问号判定的字号下限。< 该字号视为正文，不当作标题处理。 */
const TITLE_FONT_FLOOR_PT = 20;

/* ─── 公共接口 ──────────────────────────────────────────────────────────── */

export interface HeuristicLintReport {
  /** 启发式产出的 issues，全部 severity=info；调用方决定是否合并到主报告。 */
  issues: AestheticLintIssue[];
}

export class HeuristicLint {
  /**
   * 运行所有启发式规则。返回的 issues 全部为 `info` 级，
   * 由调用方（feedbackPayload.ts）按 `includeHeuristics` 开关决定是否合并。
   */
  lint(info: PresentationInfo): HeuristicLintReport {
    const issues: AestheticLintIssue[] = [];

    for (const slide of info.slides) {
      const flat = flattenSlideElements(slide.elements).filter((e) => e.position);
      issues.push(...this.lintProbableTitleSize(slide.number, flat));
      issues.push(...this.lintDataPageMissingSource(slide.number, info.slideSize, flat));
      issues.push(...this.lintParagraphTextTooLong(slide.number, flat));
      issues.push(...this.lintTitleEndsWithQuestion(slide.number, flat));
    }

    return { issues };
  }

  /* ─── Heuristic 1: probable-title 字号偏小 ───────────────────────────── */

  /**
   * **启发式**：把单页字号最大的文本视作"主标题"（去语义近似）。
   * 若该字号 < {@link PROBABLE_TITLE_MIN_PT}pt 且页面文本数 ≥
   * {@link PROBABLE_TITLE_MIN_TEXT_COUNT}，则提示主标题字号偏小。
   *
   * **可能误判的场景**：
   * - 极简风格刻意把所有字号统一为 12pt（设计选择）
   * - 单页只有装饰性 hero 数字，没有真正"标题"
   *
   * 故 message / suggestion 显式提示 AI "若是刻意可忽略"。
   */
  private lintProbableTitleSize(
    slideNumber: number,
    elements: SlideElementInfo[],
  ): AestheticLintIssue[] {
    const textElements = elements.filter((e) => e.type === 'text' && (e.fontSize ?? 0) > 0);
    if (textElements.length < PROBABLE_TITLE_MIN_TEXT_COUNT) {
      return [];
    }

    let maxFontSize = 0;
    let probableTitle: SlideElementInfo | undefined;
    for (const el of textElements) {
      const size = el.fontSize ?? 0;
      if (size > maxFontSize) {
        maxFontSize = size;
        probableTitle = el;
      }
    }

    if (!probableTitle?.position || maxFontSize === 0 || maxFontSize >= PROBABLE_TITLE_MIN_PT) {
      return [];
    }

    return [{
      code: 'probable_title_too_small',
      severity: 'info',
      confidence: 'low',
      slides: [slideNumber],
      evidence: {
        kind: 'text_pattern',
        pattern: 'probable_title',
        node: buildDiagnosticNodeRef(probableTitle),
        textPreview: abbreviateText(probableTitle.text ?? probableTitle.name),
        characterCount: (probableTitle.text ?? '').length,
        fontSizePt: maxFontSize,
        fontSizeThresholdPt: PROBABLE_TITLE_MIN_PT,
      },
    }];
  }

  /* ─── Heuristic 2: 数据页面缺来源标注 ─────────────────────────────────── */

  /**
   * **启发式**：页面含 `chart` 或 `table` 元素 → 视作"数据型页面"；
   * 若画布底部 {@link SOURCE_FOOTER_BOTTOM_RATIO} 区域内**无任何 text 元素**，
   * 提示可能缺数据来源标注。
   *
   * **可能误判的场景**：
   * - 封面 chart（hero visual），不需要 source
   * - 已用图片 watermark 标注来源（lint 看不到图片中的文字）
   *
   * 故 suggestion 强调"按需"。
   */
  private lintDataPageMissingSource(
    slideNumber: number,
    slideSize: { width: number; height: number },
    elements: SlideElementInfo[],
  ): AestheticLintIssue[] {
    const dataElements = elements.filter((e) => e.type === 'chart' || e.type === 'table');
    if (dataElements.length === 0) return [];

    const footerThresholdY = slideSize.height * (1 - SOURCE_FOOTER_BOTTOM_RATIO);
    const hasFooterText = elements.some((e) => {
      if (e.type !== 'text' || !e.position) return false;
      const elementTopY = e.position.y;
      return elementTopY >= footerThresholdY;
    });

    if (hasFooterText) return [];

    return [{
      code: 'data_page_missing_source',
      severity: 'info',
      confidence: 'low',
      slides: [slideNumber],
      evidence: {
        kind: 'content_presence',
        expectedContent: 'source_annotation',
        inspectedRegion: {
          x: 0,
          y: footerThresholdY,
          w: slideSize.width,
          h: slideSize.height - footerThresholdY,
          unit: 'in',
        },
        observedCount: 0,
        triggeringNodeIds: dataElements.map((element) => element.nodeId ?? element.elementId ?? element.name),
      },
    }];
  }

  /* ─── Heuristic 3 (Tier-3 文字型): 段落文字过长 ──────────────────────── */

  /**
   * **启发式**：text 元素纯文本字符数 > {@link PARAGRAPH_TOO_LONG_CHARS}
   * 且字号 ≤ {@link PARAGRAPH_BODY_FONT_CEIL_PT}pt（避开标题）即认为可能是
   * 一段过长的"项目符号文字 / 段落"，超出 PPT 单条阅读舒适区。
   *
   * **限制**：
   * - 由于 `extractParagraphsPlainText` 把段落 join 成单串、不保留换行，
   *   字符数判定的是"整体文本量"而非"单条 bullet 长度"。后续若引入换行
   *   保留可升级为更精细判定，这里先给"总量过长"的弱提示。
   *
   * **可能误判的场景**：
   * - 法律免责声明 / 引用段落，刻意做长
   * - 学术 deck 的论点解释段
   */
  private lintParagraphTextTooLong(
    slideNumber: number,
    elements: SlideElementInfo[],
  ): AestheticLintIssue[] {
    const issues: AestheticLintIssue[] = [];
    for (const el of elements) {
      if (el.type !== 'text') continue;
      if (!el.position) continue;
      const raw = (el.text ?? '').trim();
      if (raw.length <= PARAGRAPH_TOO_LONG_CHARS) continue;
      const fontSize = el.fontSize ?? 0;
      if (fontSize <= 0 || fontSize > PARAGRAPH_BODY_FONT_CEIL_PT) continue;
      issues.push({
        code: 'paragraph_text_too_long',
        severity: 'info',
        confidence: 'low',
        slides: [slideNumber],
        evidence: {
          kind: 'text_pattern',
          pattern: 'long_body',
          node: buildDiagnosticNodeRef(el),
          textPreview: abbreviateText(raw),
          characterCount: raw.length,
          fontSizePt: fontSize,
          characterThreshold: PARAGRAPH_TOO_LONG_CHARS,
          fontSizeThresholdPt: PARAGRAPH_BODY_FONT_CEIL_PT,
        },
      });
    }
    return issues;
  }

  /* ─── Heuristic 4 (Tier-3 文字型): 主标题以问号结尾 ──────────────────── */

  /**
   * **启发式**：单页字号最大的 text 元素（且 ≥ {@link TITLE_FONT_FLOOR_PT}pt）
   * trim 后以 `?` / `？` 结尾，即认为"标题以问句陈述"，违反"标题应为结论式
   * 断言"的 PPT 设计原则。
   *
   * **可能误判的场景**：
   * - 章节过渡页 / 议题页有意用问句引出讨论
   * - 教学 / 思辨型内容刻意以问题驱动
   *
   * 故 message / suggestion 显式提示"过渡页可忽略"。
   */
  private lintTitleEndsWithQuestion(
    slideNumber: number,
    elements: SlideElementInfo[],
  ): AestheticLintIssue[] {
    const textElements = elements.filter((e) => e.type === 'text' && (e.fontSize ?? 0) > 0);
    if (textElements.length === 0) return [];

    let titleEl: SlideElementInfo | undefined;
    let maxFontSize = 0;
    for (const el of textElements) {
      const size = el.fontSize ?? 0;
      if (size > maxFontSize) {
        maxFontSize = size;
        titleEl = el;
      }
    }

    if (!titleEl?.position || maxFontSize < TITLE_FONT_FLOOR_PT) return [];
    const raw = (titleEl.text ?? '').trim();
    if (!raw) return [];
    const lastChar = raw[raw.length - 1];
    if (lastChar !== '?' && lastChar !== '？') return [];

    return [{
      code: 'title_ends_with_question',
      severity: 'info',
      confidence: 'low',
      slides: [slideNumber],
      evidence: {
        kind: 'text_pattern',
        pattern: 'question_title',
        node: buildDiagnosticNodeRef(titleEl),
        textPreview: abbreviateText(raw),
        characterCount: raw.length,
        fontSizePt: maxFontSize,
        fontSizeThresholdPt: TITLE_FONT_FLOOR_PT,
      },
    }];
  }
}

function abbreviateText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= 40 ? normalized : `${normalized.slice(0, 39)}…`;
}
