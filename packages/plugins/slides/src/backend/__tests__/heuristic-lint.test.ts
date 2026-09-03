import { describe, it, expect } from 'vitest';import { HeuristicLint } from '../engine/quality/HeuristicLint.js';
import type { PresentationInfo, SlideElementInfo } from '@plugin/slides/shared';

/* ─── Test fixtures helpers ───────────────────────────────────────────── */

const SLIDE_W = 13.333; // 16:9 inches
const SLIDE_H = 7.5;

function text(opts: Partial<SlideElementInfo> & { fontSize?: number; y?: number; h?: number }): SlideElementInfo {
  return {
    name: 'text',
    type: 'text',
    text: 'Sample',
    fontSize: opts.fontSize ?? 12,
    position: {
      x: 0.5,
      y: opts.y ?? 1,
      w: 4,
      h: opts.h ?? 0.5,
    },
    ...opts,
  };
}

function chart(): SlideElementInfo {
  return {
    name: 'chart',
    type: 'chart',
    chartType: 'bar',
    position: { x: 1, y: 1.5, w: 8, h: 4 },
  };
}

function table(): SlideElementInfo {
  return {
    name: 'table',
    type: 'table',
    position: { x: 1, y: 1.5, w: 8, h: 4 },
  };
}

function image(): SlideElementInfo {
  return {
    name: 'image',
    type: 'image',
    position: { x: 1, y: 1.5, w: 8, h: 4 },
  };
}

function makePresentation(slides: SlideElementInfo[][]): PresentationInfo {
  return {
    slideCount: slides.length,
    slideSize: { width: SLIDE_W, height: SLIDE_H },
    slides: slides.map((elements, idx) => ({ number: idx + 1, elements })),
    theme: { colors: {}, fonts: { major: 'Arial', minor: 'Arial' } },
    masters: [],
  };
}

/* ─── Tests ───────────────────────────────────────────────────────────── */

describe('HeuristicLint', () => {
  describe('Heuristic 1: probable_title_too_small', () => {
    it('emits info when largest text on slide is < 14pt and ≥ 2 text elements present', () => {
      const info = makePresentation([[
        text({ fontSize: 12 }),
        text({ fontSize: 10, y: 2 }),
      ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues).toHaveLength(1);
      expect(report.issues[0].code).toBe('probable_title_too_small');
      expect(report.issues[0].severity).toBe('info');
      expect(report.issues[0].evidence).toMatchObject({
        kind: 'text_pattern',
        pattern: 'probable_title',
        fontSizePt: 12,
        fontSizeThresholdPt: 14,
      });
    });

    it('does NOT emit when largest text ≥ 14pt', () => {
      const info = makePresentation([[
        text({ fontSize: 24 }),
        text({ fontSize: 11, y: 2 }),
      ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues.filter((i) => i.code === 'probable_title_too_small')).toHaveLength(0);
    });

    it('does NOT emit when slide has only 1 text element (likely caption)', () => {
      const info = makePresentation([[ text({ fontSize: 10 }) ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues.filter((i) => i.code === 'probable_title_too_small')).toHaveLength(0);
    });

    it('does NOT emit when text elements have no fontSize info', () => {
      const info = makePresentation([[
        text({ fontSize: undefined }),
        text({ fontSize: undefined, y: 2 }),
      ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues.filter((i) => i.code === 'probable_title_too_small')).toHaveLength(0);
    });

    it('emits per-slide independently for multi-slide deck', () => {
      const info = makePresentation([
        [text({ fontSize: 11 }), text({ fontSize: 10, y: 2 })],
        [text({ fontSize: 28 }), text({ fontSize: 14, y: 2 })],
        [text({ fontSize: 12 }), text({ fontSize: 12, y: 2 })],
      ]);
      const report = new HeuristicLint().lint(info);
      const titleIssues = report.issues.filter((i) => i.code === 'probable_title_too_small');
      expect(titleIssues).toHaveLength(2);
      expect(titleIssues.map((i) => i.slides[0]).sort()).toEqual([1, 3]);
    });

    it('boundary: exactly 14pt → no issue', () => {
      const info = makePresentation([[
        text({ fontSize: 14 }),
        text({ fontSize: 10, y: 2 }),
      ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues.filter((i) => i.code === 'probable_title_too_small')).toHaveLength(0);
    });
  });

  describe('Heuristic 2: data_page_missing_source', () => {
    it('emits info when chart present and bottom 15% has no text', () => {
      const info = makePresentation([[
        text({ fontSize: 18, y: 0.3 }),
        chart(),
      ]]);
      const report = new HeuristicLint().lint(info);
      const issues = report.issues.filter((i) => i.code === 'data_page_missing_source');
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('info');
      expect(issues[0].evidence).toMatchObject({
        kind: 'content_presence',
        expectedContent: 'source_annotation',
        observedCount: 0,
      });
    });

    it('emits for table elements as well', () => {
      const info = makePresentation([[
        text({ fontSize: 18, y: 0.3 }),
        table(),
      ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues.filter((i) => i.code === 'data_page_missing_source')).toHaveLength(1);
    });

    it('does NOT emit when bottom 15% has a footer text', () => {
      /* slide_h = 7.5; 85% threshold = 6.375 */
      const info = makePresentation([[
        text({ fontSize: 18, y: 0.3 }),
        chart(),
        text({ fontSize: 8, y: 6.5, h: 0.3 }),
      ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues.filter((i) => i.code === 'data_page_missing_source')).toHaveLength(0);
    });

    it('does NOT emit when no chart/table on slide', () => {
      const info = makePresentation([[
        text({ fontSize: 18, y: 0.3 }),
        image(),
      ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues.filter((i) => i.code === 'data_page_missing_source')).toHaveLength(0);
    });

    it('boundary: footer text exactly at 85% threshold is considered a footer', () => {
      const info = makePresentation([[
        chart(),
        text({ fontSize: 8, y: SLIDE_H * 0.85, h: 0.2 }),
      ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues.filter((i) => i.code === 'data_page_missing_source')).toHaveLength(0);
    });

    it('handles multi-slide deck independently', () => {
      const info = makePresentation([
        [chart()], // missing source
        [chart(), text({ fontSize: 8, y: 6.7 })], // has footer
        [image()], // no chart
      ]);
      const report = new HeuristicLint().lint(info);
      const issues = report.issues.filter((i) => i.code === 'data_page_missing_source');
      expect(issues).toHaveLength(1);
      expect(issues[0].slides).toEqual([1]);
    });
  });

  /* ─── Tier-3 文字型规则（P1-C 第 2 批） ─────────────────────────────── */

  describe('Heuristic 3: paragraph_text_too_long', () => {
    it('emits info when body text > 80 chars at ≤ 18pt', () => {
      const long = 'a'.repeat(120);
      const info = makePresentation([[
        text({ fontSize: 12, text: long }),
      ]]);
      const report = new HeuristicLint().lint(info);
      const issues = report.issues.filter((i) => i.code === 'paragraph_text_too_long');
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('info');
      expect(issues[0].evidence).toMatchObject({
        kind: 'text_pattern',
        pattern: 'long_body',
        characterCount: 120,
        characterThreshold: 80,
      });
    });

    it('does NOT emit when font is title-sized (> 18pt) even if long', () => {
      const long = 'a'.repeat(120);
      const info = makePresentation([[
        text({ fontSize: 24, text: long }),
      ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues.filter((i) => i.code === 'paragraph_text_too_long')).toHaveLength(0);
    });

    it('does NOT emit when body text ≤ 80 chars', () => {
      const info = makePresentation([[
        text({ fontSize: 12, text: 'a'.repeat(80) }),
      ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues.filter((i) => i.code === 'paragraph_text_too_long')).toHaveLength(0);
    });

    it('boundary: > 80 chars triggers (e.g., 81 chars)', () => {
      const info = makePresentation([[
        text({ fontSize: 12, text: 'a'.repeat(81) }),
      ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues.filter((i) => i.code === 'paragraph_text_too_long')).toHaveLength(1);
    });

    it('does NOT emit when fontSize is undefined', () => {
      const info = makePresentation([[
        text({ fontSize: undefined, text: 'a'.repeat(120) }),
      ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues.filter((i) => i.code === 'paragraph_text_too_long')).toHaveLength(0);
    });
  });

  describe('Heuristic 4: title_ends_with_question', () => {
    it('emits info when largest text ≥ 20pt ends with "?"', () => {
      const info = makePresentation([[
        text({ fontSize: 28, text: 'Why does growth matter?' }),
        text({ fontSize: 14, y: 2, text: 'Body content here.' }),
      ]]);
      const report = new HeuristicLint().lint(info);
      const issues = report.issues.filter((i) => i.code === 'title_ends_with_question');
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('info');
      expect(issues[0].evidence).toMatchObject({
        kind: 'text_pattern',
        pattern: 'question_title',
      });
    });

    it('emits info on Chinese full-width "？"', () => {
      const info = makePresentation([[
        text({ fontSize: 32, text: '为什么我们要这样做？' }),
        text({ fontSize: 14, y: 2, text: '正文内容' }),
      ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues.filter((i) => i.code === 'title_ends_with_question')).toHaveLength(1);
    });

    it('does NOT emit when title is conclusion-style (no question mark)', () => {
      const info = makePresentation([[
        text({ fontSize: 28, text: 'Growth accelerated 35% in Q3' }),
      ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues.filter((i) => i.code === 'title_ends_with_question')).toHaveLength(0);
    });

    it('does NOT emit when largest text is < 20pt (no real title)', () => {
      const info = makePresentation([[
        text({ fontSize: 16, text: 'A small caption?' }),
      ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues.filter((i) => i.code === 'title_ends_with_question')).toHaveLength(0);
    });

    it('boundary: exactly 20pt counts as title', () => {
      const info = makePresentation([[
        text({ fontSize: 20, text: 'What is next?' }),
      ]]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues.filter((i) => i.code === 'title_ends_with_question')).toHaveLength(1);
    });

    it('emits per-slide independently in multi-slide deck', () => {
      const info = makePresentation([
        [text({ fontSize: 28, text: 'Q1 results?' })],
        [text({ fontSize: 28, text: 'Q2 was strong.' })],
        [text({ fontSize: 28, text: '展望 Q3？' })],
      ]);
      const report = new HeuristicLint().lint(info);
      const issues = report.issues.filter((i) => i.code === 'title_ends_with_question');
      expect(issues.map((i) => i.slides[0]).sort()).toEqual([1, 3]);
    });
  });

  describe('integration: HeuristicLint runs independently of Tier-1', () => {
    it('outputs only info severity (never warning/error)', () => {
      const info = makePresentation([
        [text({ fontSize: 8 }), text({ fontSize: 6, y: 2 }), chart()], // would trigger many tier-1 too
      ]);
      const report = new HeuristicLint().lint(info);
      for (const issue of report.issues) {
        expect(issue.severity).toBe('info');
      }
    });

    it('returns empty issues when no slides present', () => {
      const info = makePresentation([]);
      const report = new HeuristicLint().lint(info);
      expect(report.issues).toEqual([]);
    });
  });
});
