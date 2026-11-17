import { expect, it, vi } from 'vitest';
import { createKnowledgeBaseSession } from './createKnowledgeBaseSession';

it('关联失败后重试同一个实体，应用修订的名称；新表单才创建新身份', async () => {
  const create = vi.fn().mockResolvedValueOnce({ knowledge_base: { id: 'one' } }).mockResolvedValueOnce({ knowledge_base: { id: 'two' } });
  const update = vi.fn(async () => {});
  const replaceProjects = vi.fn().mockRejectedValueOnce(new Error('project unavailable')).mockResolvedValue(undefined);
  const refresh = vi.fn(async () => {});
  const session = createKnowledgeBaseSession({ create, update, replaceProjects, refresh });
  const input = { name: 'First', description: '', tags: ['draft'], projectIds: ['p'] };
  await expect(session.save(input)).rejects.toThrow('project unavailable');
  await expect(session.save({ ...input, name: 'Revised', description: 'saved', tags: [] })).resolves.toBe('one');
  expect(create).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenLastCalledWith('one', { name: 'Revised', description: 'saved', tags: [] });
  expect(replaceProjects).toHaveBeenLastCalledWith('one', ['p']);
  session.reset();
  await expect(session.save(input)).resolves.toBe('two');
  expect(create).toHaveBeenCalledTimes(2);
});
