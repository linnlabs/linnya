import { expect, test } from 'vitest';
import {
  generateRefId,
  generateRefMapWithCollisionCheck,
  resolveBlockIdFromRef,
  checkRefCollision,
} from '../../../../shared/utils/refIdGenerator';
import {
  generateRefId as frontendGenerateRefId,
  resolveIdFromRef,
} from '../../../../../apps/renderer/shared/utils/refIdGenerator';
import { isValidRef, normalizeRef, stripRefPrefix } from '@app/schemas';
import { BLOCK_REFERENCE_CASES } from '../../../../../packages/schemas/__tests__/fixtures/blockReferenceCases';

test('两端真实摘要适配对同一组旧版固定结果一致，包含 Unicode 身份和自定义选项', async () => {
  for (const sample of BLOCK_REFERENCE_CASES) {
    for (const [options, expected] of [
      [{}, sample.ref],
      [{ includePrefix: false }, sample.unprefixed],
      [{ length: 10 }, sample.long],
    ] as const) {
      expect(generateRefId(sample.id, options)).toBe(expected);
      expect(await frontendGenerateRefId(sample.id, options)).toBe(expected);
    }
    expect(isValidRef(sample.ref)).toBe(true);
    expect(normalizeRef(sample.unprefixed)).toBe(sample.ref);
    expect(stripRefPrefix(sample.ref)).toBe(sample.unprefixed);
  }
});

test('批量生成、候选反查和碰撞检测保持调用方原有行为', async () => {
  const ids = BLOCK_REFERENCE_CASES.map(sample => sample.id);
  const refs = generateRefMapWithCollisionCheck(ids);
  for (const sample of BLOCK_REFERENCE_CASES) {
    expect(refs.get(sample.id)).toBe(sample.ref);
    expect(resolveBlockIdFromRef(sample.ref, ids)).toBe(sample.id);
    expect(await resolveIdFromRef(sample.ref, ids)).toBe(sample.id);
  }
  const sample = BLOCK_REFERENCE_CASES[0];
  expect(checkRefCollision(sample.ref, [sample.id, sample.id]).hasCollision).toBe(true);
  expect(isValidRef('#000000')).toBe(false);
  expect(await resolveIdFromRef('#000000', ids)).toBeNull();
});
