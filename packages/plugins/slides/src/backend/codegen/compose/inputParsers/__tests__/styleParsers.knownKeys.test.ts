/**
 * styleParsers 的"已知字段集"必须与 `parseTextStyle` / `parseShapeStyle` 实际识别的字段
 * 严格同步——element_management reader 在错误消息里直接回灌 `KNOWN_TEXT_STYLE_KEYS`
 * / `KNOWN_SHAPE_STYLE_KEYS` 给 AI 看，如果两者发生漂移：
 *   - 加了新字段但没更新常量 → AI 在错误消息里看不到，依旧错；
 *   - 删了字段但没更新常量 → reader 把它当合法，下游 parser 默默丢弃。
 *
 * 通过往 parser 喂"全集"探针 + "全集 + 1"反例，把这个不变量钉死。
 */

import { describe, expect, it } from 'vitest';
import {
  KNOWN_SHAPE_STYLE_KEYS,
  KNOWN_TEXT_STYLE_KEYS,
  parseShapeStyle,
  parseTextStyle,
} from '../styleParsers.js';

describe('styleParsers / 已知字段集与 parser 实际识别字段同步', () => {
  it('parseTextStyle 必须识别 KNOWN_TEXT_STYLE_KEYS 列出的全部字段', () => {
    const probe: Record<string, unknown> = {
      fontSize: 18,
      fontFamily: 'Inter',
      bold: true,
      italic: false,
      underline: false,
      color: '#FFFFFF',
      align: 'center',
      valign: 'middle',
      lineSpacing: 1.4,
      letterSpacing: 0.5,
    };
    const parsed = parseTextStyle(probe);
    expect(parsed).not.toBeNull();
    for (const key of KNOWN_TEXT_STYLE_KEYS) {
      expect(parsed, `parseTextStyle 丢了字段 ${key}`).toHaveProperty(key);
    }
  });

  it('parseShapeStyle 必须识别 KNOWN_SHAPE_STYLE_KEYS 列出的全部字段', () => {
    const probe: Record<string, unknown> = {
      fill: '#000000',
      paint: { type: 'solid', color: '#123456' },
      gradient: {
        type: 'linear',
        angle: 90,
        stops: [
          { color: '#FFFFFF', position: 0 },
          { color: '#000000', position: 1 },
        ],
      },
      border: { color: '#000000', width: 1 },
      borderRadius: 4,
      shadow: { color: '#000', blur: 4, offsetX: 0, offsetY: 2, opacity: 0.5 },
      opacity: 0.4,
      rotate: 12,
    };
    const parsed = parseShapeStyle(probe);
    expect(parsed).not.toBeNull();
    for (const key of KNOWN_SHAPE_STYLE_KEYS) {
      expect(parsed, `parseShapeStyle 丢了字段 ${key}`).toHaveProperty(key);
    }
  });

  it('parseTextStyle 不会偷偷接受 KNOWN_TEXT_STYLE_KEYS 之外的字段', () => {
    const parsed = parseTextStyle({
      fontSize: 18,
      fontWeight: 700, // CSS 风格，TextStyle 不支持，应被 parser 忽略
      textTransform: 'uppercase',
    });
    expect(parsed).toMatchObject({ fontSize: 18 });
    expect(parsed).not.toHaveProperty('fontWeight');
    expect(parsed).not.toHaveProperty('textTransform');
  });

  it('parseShapeStyle 不会偷偷接受 KNOWN_SHAPE_STYLE_KEYS 之外的字段', () => {
    const parsed = parseShapeStyle({
      fill: '#000',
      backgroundColor: '#fff', // CSS 风格，应被 parser 忽略
    });
    expect(parsed).toMatchObject({ fill: '#000' });
    expect(parsed).not.toHaveProperty('backgroundColor');
  });
});
