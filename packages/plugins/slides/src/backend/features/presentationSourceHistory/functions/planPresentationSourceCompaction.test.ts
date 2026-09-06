import { describe, expect, it } from 'vitest';
import type { PresentationStoredSourceRevision } from '../definitions/presentationSourceRevision';
import { buildPresentationSourceRevision, reconstructPresentationSource } from './presentationSourceRevisionCodec';
import { planPresentationSourceCompaction } from './planPresentationSourceCompaction';

function buildChain(count: number): PresentationStoredSourceRevision[] {
  const revisions: PresentationStoredSourceRevision[] = [];
  let parentSource: string | null = null;
  let accumulatedPatchBytes = 0;
  for (let revision = 1; revision <= count; revision += 1) {
    const source = `${'// 演示文稿源码\n'.repeat(60)}compose({ title: "版本 ${revision}", slides: [] });`;
    const payload = buildPresentationSourceRevision({ revision, source, parentSource, accumulatedPatchBytes });
    revisions.push({
      ...payload, revision, revisionId: `r-${revision}`, parentRevisionId: revisions.at(-1)?.revisionId ?? null,
    });
    parentSource = source;
    accumulatedPatchBytes = payload.storageKind === 'checkpoint' ? 0 : accumulatedPatchBytes + payload.patchBytes;
  }
  return revisions;
}

describe('Slides 稀疏历史重链', () => {
  it.each([1, 2, 10, 30, 100])('%i 个真实 checkpoint/patch 重链后每个保留源码和身份不变', count => {
    const original = buildChain(count);
    const keep = original.filter(row => row.revision % 7 === 0 || row.revision === count);
    const { retained, removedRevisionIds } = planPresentationSourceCompaction(original, keep.map(row => row.revisionId));
    expect(retained[0].storageKind).toBe('checkpoint');
    expect(retained[0].parentRevisionId).toBeNull();
    expect(retained.map(row => row.revisionId)).toEqual(keep.map(row => row.revisionId));
    expect(retained.length + removedRevisionIds.length).toBe(original.length);
    for (const [index, row] of retained.entries()) {
      expect(reconstructPresentationSource(retained.slice(0, index + 1)))
        .toBe(reconstructPresentationSource(original.slice(0, row.revision)));
      expect(row.sourceHash).toBe(original[row.revision - 1].sourceHash);
      expect(row.parentRevisionId).toBe(retained[index - 1]?.revisionId ?? null);
    }
    expect(planPresentationSourceCompaction(retained, retained.map(row => row.revisionId)).retained).toEqual(retained);
  });

  it('checkpoint 可作为读取起点，但链中间的父身份和 base hash 都必须一致', () => {
    const chain = buildChain(30);
    expect(reconstructPresentationSource(chain.slice(24))).toContain('版本 30');
    const wrongParent = chain.map(row => row.revision === 25 ? { ...row, parentRevisionId: 'other' } : row);
    expect(() => planPresentationSourceCompaction(wrongParent, ['r-30'])).toThrow('父身份或顺序');
    const wrongBase = chain.map(row => row.revision === 25 ? { ...row, baseSourceHash: 'other' } : row);
    expect(() => planPresentationSourceCompaction(wrongBase, ['r-30'])).toThrow('base source hash');
  });

  it('损坏的待删除 patch 仍让计划失败，输入载荷不被修改', () => {
    const chain = buildChain(10).map(row => row.revision === 3 ? { ...row, sourcePatch: 'broken' } : row);
    const before = structuredClone(chain);
    expect(() => planPresentationSourceCompaction(chain, ['r-10'])).toThrow('patch');
    expect(chain).toEqual(before);
  });

  it('拒绝丢弃 current 或传入不属于这份历史的 ID', () => {
    const chain = buildChain(10);
    expect(() => planPresentationSourceCompaction(chain, ['r-1'])).toThrow('当前 revision');
    expect(() => planPresentationSourceCompaction(chain, ['r-10', 'unknown'])).toThrow('不存在');
  });
});
