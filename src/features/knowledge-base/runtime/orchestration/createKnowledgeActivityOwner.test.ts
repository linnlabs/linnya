import { describe, expect, it } from 'vitest';
import { createKnowledgeActivityOwner } from './createKnowledgeActivityOwner';

describe('knowledge task ownership', () => {
  it('同库摄入期间不允许维护/重建；读和跨库仍可用，任务真正结束后才解除互斥', async () => {
    const owner = createKnowledgeActivityOwner();
    const ingest = owner.begin('a', 'ingestion');
    const query = owner.begin('a', 'search');
    expect(() => owner.begin('a', 'maintenance')).toThrow('正在执行');
    expect(() => owner.begin('a', 'rebuild')).toThrow('正在执行');
    const other = owner.begin('b', 'rebuild');
    other.release(); query.release(); ingest.release();
    const rebuild = owner.begin('a', 'rebuild');
    expect(() => owner.begin('a', 'search')).toThrow('正在执行');
    expect(() => owner.begin('a', 'graph')).toThrow('正在执行');
    rebuild.release();
    expect(owner.hasActivity()).toBe(false);
    await owner.drain();
  });

  it('停用立即停止准入并传播取消，等待自己的任务收口，不干扰其他 owner', async () => {
    const owner = createKnowledgeActivityOwner();
    const independent = createKnowledgeActivityOwner();
    const task = owner.begin('a', 'ingestion');
    const unrelated = independent.begin('a', 'ingestion');
    let stopped = false;
    const draining = owner.drain().then(() => { stopped = true; });
    expect(task.signal.aborted).toBe(true);
    expect(unrelated.signal.aborted).toBe(false);
    expect(() => owner.begin('b', 'search')).toThrow('正在停用');
    await Promise.resolve();
    expect(stopped).toBe(false);
    task.release();
    await draining;
    expect(stopped).toBe(true);
    unrelated.release(); await independent.drain();
  });
});
