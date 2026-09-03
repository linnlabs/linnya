/**
 * @file refIdGenerator.parity.test.ts
 * @description 前后端 ref 生成一致性校验
 *
 * 背景：
 * - ref（短引用）用于在 AI 输出中定位文档块
 * - ref 必须由 blockId 确定性生成，且前后端算法必须一致
 *
 * 该测试的目标：
 * - 固化“同一 blockId -> 同一 ref”这一契约
 * - 防止未来改动导致前后端算法漂移（用户点击引用无法跳转）
 */

import { describe, it, expect } from 'vitest';
import { webcrypto } from 'crypto';

import { generateRefId as backendGenerateRefId } from '../../../../shared/utils/refIdGenerator';
import { generateRefId as frontendGenerateRefId } from '../../../../../apps/renderer/shared/utils/refIdGenerator';

describe('refIdGenerator 前后端一致性', () => {
  it('同一 blockId 应生成完全一致的 ref（默认长度=6，包含#前缀）', async () => {
    // Node 环境下补齐 WebCrypto，供前端实现使用（crypto.subtle）
    if (!globalThis.crypto) {
      Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
    }

    const blockIds = [
      '550e8400-e29b-41d4-a716-446655440000',
      '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ];

    for (const blockId of blockIds) {
      const backendRef = backendGenerateRefId(blockId);
      const frontendRef = await frontendGenerateRefId(blockId);
      expect(frontendRef).toBe(backendRef);
    }
  });
});









