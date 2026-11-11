import { expect, test } from 'vitest';
import { countTextUnitsZhEn, sliceTextByUnitsZhEn } from '@app/schemas';
import { TEXT_UNIT_CASES } from '../../../../../packages/schemas/__tests__/fixtures/textUnitCases';

test('Renderer 公开合同解析与后端使用同一组固定计量结果', () => {
  for (const sample of TEXT_UNIT_CASES) {
    expect(countTextUnitsZhEn(sample.text)).toBe(sample.count);
    expect(sliceTextByUnitsZhEn(sample.text, sample.limit)).toBe(sample.slice);
  }
});
