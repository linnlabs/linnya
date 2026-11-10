import { parseColor, rgbToOklch } from '@linnya/color-core';
import { hueName } from '@linnya/color-core/palette';
import { describe, expect, it } from 'vitest';
import { HUE_BINS, VISIBLE_HUE_MIN_CHROMA, buildDirectionHistory, drawDirections, formatDirectionDrawForAgent } from '../index';
import { findOppositeHueBins } from '../functions/drawDirection';
import { ATTRACTOR_HUE_BINS, SCENARIO_HUE_FACTORS } from '../pool/axes';

function oklch(hex: string) {
  const parsed = parseColor(hex);
  if (!parsed) throw new Error(hex);
  return rgbToOklch(parsed.channels);
}

const nameOf = (bin: number) => HUE_BINS.find((entry) => entry.bin === bin)?.name;

describe('12 档主色相', () => {
  it('对面的档：靛蓝对琥珀、橄榄，湖蓝对朱红、铁锈橙，草绿对紫、梅紫', () => {
    const opposite = (name: string) => findOppositeHueBins(HUE_BINS.find((entry) => entry.name === name)!).map((entry) => entry.name);
    expect(opposite('靛蓝')).toEqual(['琥珀', '橄榄']);
    expect(opposite('湖蓝')).toEqual(['朱红', '铁锈橙']);
    expect(opposite('草绿')).toEqual(['紫', '梅紫']);
    for (const entry of HUE_BINS) {
      const names = opposite(entry.name);
      expect(names.length, entry.name).toBeGreaterThan(0);
      expect(names, entry.name).not.toContain(entry.name);
    }
  });

  it('说明里写出对面的档名', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      for (const draw of drawDirections({ scenario: 'business', count: 3, seed: `opp-${seed}`, motifs: [{ text: '电芯', typicality: 0.3 }] })) {
        if (!draw.hue || draw.colorLogic.id === 'photo-sampled') continue;
        const text = formatDirectionDrawForAgent(draw);
        expect(text).toContain(`不用的颜色：${draw.oppositeHues.map((entry) => entry.name).join('、')}一带`);
        return;
      }
    }
    throw new Error('no draw with hue');
  });

  it('首尾相接铺满色环，分界与 color-core 的色相名一一对应', () => {
    const coreNames = HUE_BINS.map((entry, index) => {
      const next = HUE_BINS[(index + 1) % HUE_BINS.length]!;
      expect(entry.to, entry.name).toBe(next.from);
      const width = (entry.to - entry.from + 360) % 360;
      expect(hueName((entry.from + 1 + 360) % 360), entry.name).toBe(hueName((entry.from + width - 1 + 360) % 360));
      return hueName((entry.from + width / 2 + 360) % 360);
    });
    expect(coreNames).toEqual(['朱', '橙', '琥珀', '黄', '黄绿', '绿', '青', '蓝', '靛', '紫', '品红', '红']);
  });

  it('参考色落在自己这一档，看得出色相', () => {
    for (const entry of HUE_BINS) {
      for (const reference of entry.references) {
        expect(oklch(reference).c, `${entry.name} ${reference}`).toBeGreaterThan(VISIBLE_HUE_MIN_CHROMA);
        expect(buildDirectionHistory([{ cardId: 'c', accent: reference }]).hueBins, `${entry.name} ${reference}`).toEqual([entry.bin]);
      }
      const [deep, , light] = entry.references.map(oklch);
      expect(deep!.l, entry.name).toBeLessThan(light!.l);
    }
  });

  it('按档号写的权重仍指向原来的颜色', () => {
    expect(ATTRACTOR_HUE_BINS.map(nameOf)).toEqual(['湖蓝', '靛蓝']);
    expect(Object.keys(SCENARIO_HUE_FACTORS.business ?? {}).map(Number).map(nameOf)).toEqual(['紫', '梅紫', '胭脂']);
    expect(Object.keys(SCENARIO_HUE_FACTORS.academic ?? {}).map(Number).map(nameOf)).toEqual(['梅紫', '胭脂']);
  });

  it('历史按 OKLCH 归档：看不出色相的强调色和无效值不计', () => {
    expect(buildDirectionHistory([
      { cardId: 'a', accent: '#1F6FC1' },
      { cardId: 'b', accent: '#808080' },
      { cardId: 'c', accent: '#6B7080' },
      { cardId: 'd', accent: 'not-a-color' },
      { cardId: 'e' },
    ])).toEqual({ cardIds: ['a', 'b', 'c', 'd', 'e'], hueBins: [8] });
  });

  it('给 Agent 的是名称和参考色，不写度数', () => {
    let checked = 0;
    for (let seed = 0; seed < 40 && checked === 0; seed += 1) {
      for (const draw of drawDirections({ scenario: 'culture', count: 3, seed: `hue-${seed}`, motifs: [{ text: '铭牌', typicality: 0.2 }] })) {
        if (!draw.hue || draw.colorLogic.id === 'photo-sampled') continue;
        const text = formatDirectionDrawForAgent(draw);
        const line = text.split('\n').find((entry) => entry.startsWith('主色相：'));
        expect(draw.hue.references).toContain(draw.hueReference);
        expect(line).toContain(`主色相：${draw.hue.name}（参考色 ${draw.hueReference}）`);
        expect(line).not.toMatch(/\d+°/u);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
