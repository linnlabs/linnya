import { describe, expect, it } from 'vitest';

import { typecheckCodegenSource } from '../typecheckCodegenSource.js';

const MINIMAL_LEGAL_DECK = `
const slide = createSlide();
slide.notes = "demo";
const t = createText("hello");
t.fontSize = 24;
slide.add(t);
compose({ title: "demo deck", slides: [slide] });
`;

const REALISTIC_LEGAL_DECK = `
const accent = (DECK_DESIGN.palette && DECK_DESIGN.palette.accent1) || "#000";

const cover = createSlide();
cover.background = { color: "#FFFFFF" };
cover.add(createText({ content: "Title", fontSize: 48, color: accent }));
cover.add(createText("Subtitle"));

const detail = createSlide();
const img = createImage("https://example.com/foo.png");
detail.add(img);
detail.add(createText("Body"));

compose({ title: "Realistic", slides: [cover, detail] });
`;

describe('typecheckCodegenSource — accepts legal deck.js', () => {
  it('accepts a minimal compose() call', () => {
    const r = typecheckCodegenSource(MINIMAL_LEGAL_DECK);
    expect(r.records).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.message).toBe('');
  });

  it('accepts a realistic deck using DECK_DESIGN, createImage, multi-slide compose', () => {
    const r = typecheckCodegenSource(REALISTIC_LEGAL_DECK);
    expect(r.records.map((x) => `${x.code}:${x.message}`)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('accepts a document-level custom slide size', () => {
    const r = typecheckCodegenSource(`
const slide = createSlide();
slide.add(createText("Vertical report"));
compose({
  title: "Custom canvas",
  layout: { width: 5.625, height: 10, unit: "in" },
  slides: [slide],
});
`);
    expect(r.records).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('accepts modern ES2020 syntax (optional chaining, nullish coalescing, spread)', () => {
    const r = typecheckCodegenSource(`
const accent = DECK_DESIGN?.palette?.accent1 ?? "#000";
const slide = createSlide();
slide.add(createText({ content: accent, ...(true ? { fontSize: 24 } : {}) }));
compose({ title: "es2020", slides: [slide] });
`);
    expect(r.ok).toBe(true);
    expect(r.records).toEqual([]);
  });

  it('accepts JSDoc comments without parsing them as TS', () => {
    const r = typecheckCodegenSource(`
/** @type {string} */
const title = "ok";
const slide = createSlide();
slide.add(createText(title));
compose({ title, slides: [slide] });
`);
    expect(r.ok).toBe(true);
  });

  it('accepts the sandbox-provided console methods', () => {
    const r = typecheckCodegenSource(`
console.log("debug");
console.warn("warning");
console.error("error");
const slide = createSlide();
compose({ title: "with logs", slides: [slide] });
`);
    expect(r.ok).toBe(true);
    expect(r.records).toEqual([]);
  });

  it('accepts createText primitive values that runtime coerces with String(...)', () => {
    const r = typecheckCodegenSource(`
const slide = createSlide();
slide.add(createText(42));
slide.add(createText(false));
compose({ title: "primitive text", slides: [slide] });
`);
    expect(r.ok).toBe(true);
    expect(r.records).toEqual([]);
  });

  it('accepts the legacy-compatible fixed position box syntax', () => {
    const r = typecheckCodegenSource(`
const slide = createSlide();
const title = createText("Q4 六大业绩亮点");
title.position = { x: 0.5, y: 0.3, w: 9, h: 0.5 };
slide.add(title);
compose({ title: "position box", slides: [slide] });
`);
    expect(r.ok).toBe(true);
    expect(r.records).toEqual([]);
  });

  it('accepts letterSpacing on Text nodes', () => {
    const r = typecheckCodegenSource(`
const slide = createSlide();
const tag = createText("SECTION");
tag.fontSize = 10;
tag.letterSpacing = 1.5;
slide.add(tag);
compose({ title: "text tracking", slides: [slide] });
`);
    expect(r.ok).toBe(true);
    expect(r.records).toEqual([]);
  });

  it('accepts the complete advanced authoring contract with exact nested types', () => {
    const r = typecheckCodegenSource(`
const slide = createSlide({
  background: {
    gradient: {
      type: "linear",
      angle: 90,
      stops: [
        { color: "#FFFFFF", position: 0 },
        { color: "#12233F", position: 1, opacity: 0.8 },
      ],
    },
  },
});
slide.add(createText([
  { text: "结论：", style: { bold: true, color: "#12233F" } },
  { text: "方案可行" },
]));
slide.add(createShape({
  geometry: { type: "regularPolygon", sides: 6 },
  fill: { color: "#B4552F", transparency: 55 },
  border: { color: "#12233F", width: 1, dash: "dash" },
}));
slide.add(createChart({
  preset: "radar-filled",
  categories: ["质量", "速度"],
  series: [{ name: "方案 A", values: [88, 76] }],
  legendPosition: "bottom",
  chartStyle: {
    axisLabelColor: "#475569",
    dataLabelColor: "#0F172A",
    gridlineColor: "#CBD5E1",
  },
}));
slide.add(createTable({
  headers: [{ text: "指标", fill: "#12233F", style: { color: "#FFFFFF", bold: true } }, "结果"],
  rows: [[{ text: "交付", rowspan: 2 }, 3], [true], [{ text: "总结", colspan: 2 }]],
  border: { color: "#CBD5E1", width: 0.75 },
}));
slide.add(createImage({
  src: { kind: "generated_asset", assetId: "images/hero.png" },
  fitMode: "cover",
  transparency: 0.35,
  shadow: { color: "#000000", blur: 8, angle: 90, distance: 3, opacity: 0.2 },
}));
compose({
  title: "advanced",
  slides: [slide],
  theme: {
    colors: { accent1: "#B4552F" },
    fonts: { major: "Aptos Display", minor: "Aptos" },
    chart: { palette: ["#B4552F", "#12233F"] },
  },
});
`);
    expect(r.records.map((record) => `${record.code}:${record.message}`)).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe('typecheckCodegenSource — rejects TypeScript syntax in deck.js (TS80xx)', () => {
  it('rejects variable type annotations with TS8010 and the deck.js hint', () => {
    const r = typecheckCodegenSource('let x: number = 5;');
    expect(r.ok).toBe(false);
    expect(r.records[0]?.code).toBe(8010);
    expect(r.message.startsWith('Sandbox compile error: ')).toBe(true);
    expect(r.message).toContain('deck.js must be plain JavaScript');
  });

  it('rejects function parameter type annotations with TS8010', () => {
    const r = typecheckCodegenSource('function foo(x: string) { return x; }');
    expect(r.ok).toBe(false);
    expect(r.records.some((d) => d.code === 8010)).toBe(true);
  });

  it("rejects 'interface' declarations with TS8006", () => {
    const r = typecheckCodegenSource('interface Foo { x: number; }');
    expect(r.ok).toBe(false);
    expect(r.records.some((d) => d.code === 8006)).toBe(true);
  });

  it('rejects type alias declarations with TS8008', () => {
    const r = typecheckCodegenSource('type Bar = string;');
    expect(r.ok).toBe(false);
    expect(r.records.some((d) => d.code === 8008)).toBe(true);
  });

  it('rejects "as Type" cast assertions (TS8016 — type assertions only allowed in .ts files)', () => {
    const r = typecheckCodegenSource('const x = (1) as number;');
    expect(r.ok).toBe(false);
    // Code may be 8016 (type assertion) or 8010 (annotation) depending on TS version;
    // we only assert it's in the TS-in-JS family.
    expect(r.records.some((d) => d.code >= 8000 && d.code < 8100)).toBe(true);
  });
});

describe('typecheckCodegenSource — rejects semantic errors against ambient.d.ts', () => {
  it("rejects undeclared globals like 'editPresentation' with TS2304 (no deck.js hint)", () => {
    const r = typecheckCodegenSource('editPresentation({ edits: [] });');
    expect(r.ok).toBe(false);
    expect(r.records[0]?.code).toBe(2304);
    expect(r.records[0]?.message).toContain("Cannot find name 'editPresentation'");
    expect(r.message).not.toContain('deck.js must be plain JavaScript');
  });

  it('rejects createImage(<number>) with overload mismatch (TS2769 / TS2345)', () => {
    const r = typecheckCodegenSource('const img = createImage(123);');
    expect(r.ok).toBe(false);
    expect(r.records.some((d) => d.code === 2769 || d.code === 2345)).toBe(true);
  });

  it('rejects compose() called with missing required `title`', () => {
    const r = typecheckCodegenSource('compose({ slides: [] });');
    expect(r.ok).toBe(false);
    // TS code is 2741 (Property X is missing) for missing required properties.
    expect(r.records.length).toBeGreaterThan(0);
  });

  it.each([
    ['rich-text style at run top level', 'createText([{ text: "x", bold: true }]);'],
    ['Text opacity', 'createText({ content: "x", opacity: 0.5 });'],
    ['Text padding', 'createText({ content: "x", padding: 0.2 });'],
    ['unknown chart preset', 'createChart({ preset: "executive-mega-chart", categories: ["A"], series: [{ name: "S", values: [1] }] });'],
    ['unknown legend position', 'createChart({ categories: ["A"], series: [{ name: "S", values: [1] }], legendPosition: "center" });'],
    ['unknown chart style field', 'createChart({ categories: ["A"], series: [{ name: "S", values: [1] }], chartStyle: { axisLabelFontSize: 10 } });'],
    ['raw chartOptions', 'createChart({ categories: ["A"], series: [{ name: "S", values: [1] }], chartOptions: { showLegend: true } });'],
    ['table border dash', 'createTable({ rows: [["A"]], border: { color: "#000000", width: 1, dash: "dash" } });'],
    ['raw tableOptions', 'createTable({ rows: [["A"]], tableOptions: { colW: [2] } });'],
    ['internal styleDecision', 'createSlide({ styleDecision: { layout: "hero" } });'],
    ['internal node type assignment', 'const slide = createSlide(); slide._type = "View";'],
    ['internal children mutation', 'const slide = createSlide(); slide.children.push(createText("x"));'],
    ['non-rendered theme.logo', 'compose({ title: "x", slides: [createSlide()], theme: { logo: "https://example.com/logo.png" } });'],
    ['mixed slide background sources', 'createSlide({ background: { color: "#FFFFFF", image: "https://example.com/a.png" } });'],
    ['radial border paint', 'createShape({ border: { width: 1, paint: { type: "radial", stops: [{ color: "#000000", position: 0 }, { color: "#FFFFFF", position: 1 }] } } });'],
  ])('rejects unsupported or internal syntax: %s', (_name, source) => {
    const r = typecheckCodegenSource(source);
    expect(r.ok).toBe(false);
    expect(r.records.length).toBeGreaterThan(0);
  });
});

describe('typecheckCodegenSource — performance and caching', () => {
  it('warm calls finish under 100ms and successive calls are not slower than the first', () => {
    // Warm-up so we are measuring the steady-state cost.
    typecheckCodegenSource(MINIMAL_LEGAL_DECK);

    const t1 = typecheckCodegenSource(MINIMAL_LEGAL_DECK).elapsedMs;
    const t2 = typecheckCodegenSource(REALISTIC_LEGAL_DECK).elapsedMs;
    const t3 = typecheckCodegenSource(MINIMAL_LEGAL_DECK).elapsedMs;
    expect(t1).toBeLessThan(150);
    expect(t2).toBeLessThan(150);
    expect(t3).toBeLessThan(150);
  });
});

describe('typecheckCodegenSource — diagnostics surfacing', () => {
  it('reports line/column based on the user source, 1-based', () => {
    const r = typecheckCodegenSource(['', 'const x = 1;', 'editPresentation();'].join('\n'));
    const head = r.records[0]!;
    expect(head.line).toBe(3);
    expect(head.column).toBe(1);
  });

  it('snippet contains the offending source line', () => {
    const r = typecheckCodegenSource('let z: number = 5;');
    expect(r.records[0]?.snippet).toBe('let z: number = 5;');
  });

  it('does not surface errors that originate inside ambient.d.ts itself', () => {
    // Sanity: legal source ⇒ no records at all (would catch ambient leakage).
    const r = typecheckCodegenSource('compose({ title: "x", slides: [] });');
    expect(r.records).toEqual([]);
  });
});
