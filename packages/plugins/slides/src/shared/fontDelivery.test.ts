import { describe, expect, it } from 'vitest';
import {
  OFFICE_FONT_FAMILIES,
  assessFontDelivery,
  resolveDeckFontDeliveryTarget,
} from './fontDelivery';

describe('fontDelivery', () => {
  it('本地化名称与大小写归一到规范 family', () => {
    expect(assessFontDelivery('微软雅黑', 'office')).toMatchObject({ status: 'core', officeFamily: 'Microsoft YaHei' });
    expect(assessFontDelivery(' microsoft yahei ', 'office')).toMatchObject({ status: 'core', officeFamily: 'Microsoft YaHei' });
    expect(assessFontDelivery('华文行楷', 'office')).toMatchObject({ status: 'cloud', officeFamily: 'STXingkai' });
  });

  it('不可交付字体给出替换方向，未收录字体按脚本兜底', () => {
    expect(assessFontDelivery('PingFang SC', 'office').alternatives).toEqual(['Microsoft YaHei', 'DengXian', 'SimHei']);
    expect(assessFontDelivery('Some Brand Serif', 'office', 'eastAsian'))
      .toEqual({ target: 'office', status: 'unavailable', alternatives: ['Microsoft YaHei', 'SimSun', 'KaiTi'] });
    expect(assessFontDelivery('Songti SC', 'local')).toEqual({ target: 'local', status: 'core', alternatives: [] });
  });

  it('替换建议本身都在 Office 表里', () => {
    const known = new Set(OFFICE_FONT_FAMILIES.map((entry) => entry.family));
    for (const family of ['PingFang SC', 'Songti SC', 'Kaiti SC', 'Baskerville', 'Helvetica', 'Futura', 'Menlo', 'Ma Shan Zheng', 'x-latin']) {
      for (const alternative of assessFontDelivery(family, 'office').alternatives) {
        expect(known.has(alternative), `${family} -> ${alternative}`).toBe(true);
      }
    }
  });

  it('只有生成稿有目标环境，缺省为 Office', () => {
    expect(resolveDeckFontDeliveryTarget('generated', undefined)).toBe('office');
    expect(resolveDeckFontDeliveryTarget('generated', { fontTarget: 'local' })).toBe('local');
    expect(resolveDeckFontDeliveryTarget('imported', { fontTarget: 'office' })).toBeUndefined();
  });
});
