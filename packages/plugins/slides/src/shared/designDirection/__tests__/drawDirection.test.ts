import { describe, expect, it } from 'vitest';
import {
  COLOR_LOGIC_IDS,
  DIRECTION_SCENARIOS,
  DirectionDeclarationSchema,
  IMAGE_STRATEGY_IDS,
  TECHNIQUE_CARDS,
  TYPE_STRATEGY_IDS,
  drawDirections,
  formatDirectionDrawForAgent,
} from '../index';

const MOTIFS = [
  { text: '集装箱铭牌', typicality: 0.2 },
  { text: '峰谷电价曲线', typicality: 0.7 },
  { text: '调度台', typicality: 0.4 },
];

describe('签池', () => {
  it('手法卡 id 唯一，轴取值都在定义内', () => {
    const ids = TECHNIQUE_CARDS.map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const card of TECHNIQUE_CARDS) {
      expect(card.colorLogics.every((id) => COLOR_LOGIC_IDS.includes(id))).toBe(true);
      expect(card.typeStrategies.every((id) => TYPE_STRATEGY_IDS.includes(id))).toBe(true);
      expect(card.imageStrategies.every((id) => IMAGE_STRATEGY_IDS.includes(id))).toBe(true);
      // 每张卡至少有一种不依赖生图模型的图片策略。
      expect(card.imageStrategies.some((id) => id !== 'generated-illustration')).toBe(true);
      expect(Object.values(card.scenarios).some((weight) => (weight ?? 0) > 0)).toBe(true);
    }
  });

  it('每个场景至少有 12 张可用卡', () => {
    for (const scenario of DIRECTION_SCENARIOS) {
      const usable = TECHNIQUE_CARDS.filter((card) => (card.scenarios[scenario] ?? 0) > 0);
      expect(usable.length, scenario).toBeGreaterThanOrEqual(12);
    }
  });
});

describe('drawDirections', () => {
  it('同一种子可复现，不同种子会变', () => {
    const first = drawDirections({ scenario: 'business', motifs: MOTIFS, seed: 'abc' })[0]!;
    const again = drawDirections({ scenario: 'business', motifs: MOTIFS, seed: 'abc' })[0]!;
    expect(again.card.id).toBe(first.card.id);
    expect(again.hue?.bin).toBe(first.hue?.bin);
    const seen = new Set(Array.from({ length: 30 }, (_, index) =>
      drawDirections({ scenario: 'business', motifs: MOTIFS, seed: `s${index}` })[0]!.card.id));
    expect(seen.size).toBeGreaterThan(10);
  });

  it('跨用户分布足够分散，并压低藏青这类吸引子', () => {
    const counts = new Map<string, number>();
    let navy = 0;
    const runs = 2000;
    for (let index = 0; index < runs; index += 1) {
      const draw = drawDirections({ scenario: 'business', motifs: MOTIFS, seed: `user-${index}` })[0]!;
      counts.set(draw.card.id, (counts.get(draw.card.id) ?? 0) + 1);
      if (draw.hue && (draw.hue.bin === 7 || draw.hue.bin === 8)) navy += 1;
    }
    const maxShare = Math.max(...counts.values()) / runs;
    expect(maxShare).toBeLessThan(0.1);
    // 商务稿色相总权重 8（七档各 1、紫 0.3、藏青两档共 0.7），藏青约占 8.7%；不降权时约占 21%。
    expect(navy / runs).toBeLessThan(0.1);
  });

  it('投研汇报类稿子不发粉色系色相', () => {
    for (let index = 0; index < 1000; index += 1) {
      const draw = drawDirections({ scenario: 'business', motifs: MOTIFS, seed: `pink-${index}` })[0]!;
      expect([10, 11]).not.toContain(draw.hue?.bin);
    }
  });

  it('封面构图分散，左题右图降权，无图稿不发多格拼贴', () => {
    const counts = new Map<string, number>();
    for (let index = 0; index < 1000; index += 1) {
      const draw = drawDirections({ scenario: 'culture', motifs: MOTIFS, seed: `cover-${index}` })[0]!;
      counts.set(draw.coverComposition.id, (counts.get(draw.coverComposition.id) ?? 0) + 1);
      if (['diagram-only', 'typographic'].includes(draw.imageStrategy.id)) {
        expect(draw.coverComposition.id).not.toBe('mosaic');
      }
    }
    expect(counts.size).toBe(8);
    expect(counts.get('left-title')!).toBeLessThan(80);
  });

  it('本机最近用过的手法会被降权', () => {
    const recent = 'data-journalism';
    let hits = 0;
    for (let index = 0; index < 1000; index += 1) {
      const draw = drawDirections({
        scenario: 'business',
        motifs: MOTIFS,
        seed: `h-${index}`,
        history: { cardIds: [recent], hueBins: [] },
      })[0]!;
      if (draw.card.id === recent) hits += 1;
    }
    expect(hits / 1000).toBeLessThan(0.02);
  });

  it('一批三张互不相同，退回的手法不再发出', () => {
    const batch = drawDirections({ scenario: 'culture', motifs: MOTIFS, seed: 'batch', count: 3 });
    expect(batch).toHaveLength(3);
    expect(new Set(batch.map((draw) => draw.card.id)).size).toBe(3);
    const excluded = batch[0]!.card.id;
    for (let index = 0; index < 200; index += 1) {
      const draw = drawDirections({ scenario: 'culture', motifs: MOTIFS, seed: `x${index}`, excludeCardIds: [excluded] })[0]!;
      expect(draw.card.id).not.toBe(excluded);
    }
  });

  it('没有生图模型时不发“生成插画”', () => {
    for (let index = 0; index < 300; index += 1) {
      const draw = drawDirections({ scenario: 'personal', motifs: MOTIFS, seed: `g${index}` })[0]!;
      expect(draw.imageStrategy.id).not.toBe('generated-illustration');
    }
  });

  it('要求有图片时不发基本无图的策略', () => {
    for (const scenario of DIRECTION_SCENARIOS) {
      for (let index = 0; index < 200; index += 1) {
        const draw = drawDirections({ scenario, motifs: MOTIFS, seed: `i${index}`, requireImages: true })[0]!;
        expect(['diagram-only', 'typographic']).not.toContain(draw.imageStrategy.id);
      }
    }
  });

  it('常见母题更少被挑中', () => {
    let common = 0;
    for (let index = 0; index < 1000; index += 1) {
      const draw = drawDirections({ scenario: 'business', motifs: MOTIFS, seed: `m${index}` })[0]!;
      if (draw.motif === '峰谷电价曲线') common += 1;
    }
    expect(common / 1000).toBeLessThan(0.2);
  });

  it('给 Agent 的说明带上声明方式，且不提“抽签”', () => {
    const draw = drawDirections({ scenario: 'business', motifs: MOTIFS, seed: 'fmt' })[0]!;
    const text = formatDirectionDrawForAgent(draw);
    expect(text).toContain(draw.drawId);
    expect(text).toContain(`cardId 写 "${draw.card.id}"`);
    expect(text).toContain('theme: { ..., direction');
  });

  it('用图的方向先取色，配色逻辑只做退路；不用图的方向不提取色', () => {
    const draw = drawDirections({ scenario: 'business', motifs: MOTIFS, seed: 'fmt' })[0]!;
    const withImages = formatDirectionDrawForAgent({ ...draw, imageStrategy: { ...draw.imageStrategy, id: 'documentary-color' } });
    expect(withImages).toContain('linnya palette suggest');
    expect(withImages).toContain('imagePalette');
    expect(withImages.indexOf('linnya palette suggest')).toBeLessThan(withImages.indexOf('配色逻辑：'));

    const imageless = formatDirectionDrawForAgent({ ...draw, imageStrategy: { ...draw.imageStrategy, id: 'typographic' } });
    expect(imageless).not.toContain('linnya palette');
    expect(imageless).not.toContain('imagePalette');
    expect(imageless).toContain('配色逻辑：');
  });
});

describe('DirectionDeclarationSchema', () => {
  it('接受完整声明，拒绝非法颜色', () => {
    const declaration = {
      drawId: 'abc-1',
      cardId: 'metro-map',
      palette: { backgrounds: ['#FFFFFF'], ink: '#111111', accents: ['#E3332B', '#1F6FC1'] },
      fonts: ['Microsoft YaHei', 'Arial Black'],
    };
    expect(DirectionDeclarationSchema.safeParse(declaration).success).toBe(true);
    expect(DirectionDeclarationSchema.safeParse({ ...declaration, palette: { ...declaration.palette, ink: 'black' } }).success).toBe(false);
  });

  it('接受取色结果的全部角色和配色来源', () => {
    const base = {
      drawId: 'abc-1',
      cardId: 'metro-map',
      fonts: ['Microsoft YaHei'],
    };
    const palette = {
      backgrounds: ['#E8EDDF', '#F4F6EE'],
      ink: '#1F2A1E',
      muted: '#5A6656',
      accents: ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'],
      chart: ['#2F5A30', '#4F7A4A'],
    };
    const parse = (imagePalette: unknown) => DirectionDeclarationSchema.safeParse({ ...base, palette, imagePalette }).success;
    expect(parse({ id: 'pl8f2a-1', excludedHues: [[315, 15]] })).toBe(true);
    expect(parse({ id: 'pl8f2a-1', excludedHues: [] })).toBe(true);
    expect(parse({ unavailable: 'no_subject_color' })).toBe(true);
    expect(parse({ unavailable: 'no_photos' })).toBe(true);
    expect(parse({ id: 'pl8f2a-1' })).toBe(false);
    expect(parse({ id: 'pl8f2a-1', excludedHues: [[400, 15]] })).toBe(false);
    expect(DirectionDeclarationSchema.safeParse({
      ...base,
      palette: { ...palette, accents: [...palette.accents, '#777777'] },
    }).success).toBe(false);
  });
});
