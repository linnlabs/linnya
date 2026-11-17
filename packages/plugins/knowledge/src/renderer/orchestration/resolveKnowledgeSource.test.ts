import { describe, expect, it, vi } from 'vitest';
import { resolveKnowledgeSource, type KnowledgeSourceLookup } from './resolveKnowledgeSource';

describe('knowledge source project scope', () => {
  const signal = () => new AbortController().signal;
  it('known container still requires project binding; unknown container only scans bound libraries', async () => {
    const lookup: KnowledgeSourceLookup = {
      listProjectKnowledgeBaseIds: vi.fn(async () => ['project-library']),
      listDocumentIds: vi.fn(async () => ['source']),
    };
    await expect(resolveKnowledgeSource({ sourceId: 'source', containerId: 'other-library', projectId: 'project' }, signal(), lookup)).rejects.toThrow('范围');
    expect(lookup.listDocumentIds).not.toHaveBeenCalled();
    await expect(resolveKnowledgeSource({ sourceId: 'source', projectId: 'project' }, signal(), lookup)).resolves.toBe('project-library');
    expect(lookup.listDocumentIds).toHaveBeenCalledExactlyOnceWith('project-library');
  });

  it('only confirmed absence of bindings allows default; permission or transport failure never expands scope', async () => {
    const lookup: KnowledgeSourceLookup = {
      listProjectKnowledgeBaseIds: vi.fn(async () => []),
      listDocumentIds: vi.fn(async () => ['source']),
    };
    await expect(resolveKnowledgeSource({ sourceId: 'source', projectId: 'unbound' }, signal(), lookup)).resolves.toBe('default');
    expect(lookup.listDocumentIds).toHaveBeenCalledExactlyOnceWith('default');
    const denied = { ...lookup, listProjectKnowledgeBaseIds: vi.fn(async () => { throw new Error('permission denied'); }) };
    await expect(resolveKnowledgeSource({ sourceId: 'source', projectId: 'denied' }, signal(), denied)).rejects.toThrow('permission denied');
    expect(lookup.listDocumentIds).toHaveBeenCalledTimes(1);
  });

  it('scene change or disable cancels a late lookup before it can select a library', async () => {
    const controller = new AbortController();
    const lookup: KnowledgeSourceLookup = {
      listProjectKnowledgeBaseIds: async () => ['project-library'],
      listDocumentIds: async () => { controller.abort(); return ['source']; },
    };
    await expect(resolveKnowledgeSource({ sourceId: 'source', projectId: 'project' }, controller.signal, lookup)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('missing project is not an empty binding list and cannot open even a known default source', async () => {
    const lookup: KnowledgeSourceLookup = {
      listProjectKnowledgeBaseIds: vi.fn(async () => []),
      listDocumentIds: vi.fn(async () => ['source']),
    };
    await expect(resolveKnowledgeSource({ sourceId: 'source', containerId: 'default', projectId: null }, signal(), lookup)).rejects.toThrow('项目上下文');
    expect(lookup.listProjectKnowledgeBaseIds).not.toHaveBeenCalled();
    expect(lookup.listDocumentIds).not.toHaveBeenCalled();
  });
});
