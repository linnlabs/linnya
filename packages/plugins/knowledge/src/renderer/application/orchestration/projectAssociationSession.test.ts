import { describe, expect, it, vi } from 'vitest';
import { createProjectAssociationSession } from './projectAssociationSession';

function port() {
  return { loadCatalog: vi.fn(async () => undefined), readLinks: vi.fn(async () => ['kb-old']),
    replaceLinks: vi.fn(async (_project: string, _ids: string[]) => undefined),
    loadFailed: vi.fn(), saveFailed: vi.fn(), saved: vi.fn() };
}
describe('project association session', () => {
  it('读取失败不冒充空关联，不能提交清空；保存失败保留用户草稿', async () => {
    const gateway = port();
    gateway.readLinks.mockRejectedValueOnce(new Error('unavailable'));
    const failed = createProjectAssociationSession('project-a', gateway);
    await failed.load();
    await failed.save();
    expect(failed.status.value).toBe('failed');
    expect(gateway.replaceLinks).not.toHaveBeenCalled();

    const session = createProjectAssociationSession('project-b', gateway);
    await session.load();
    session.unlink('kb-old'); session.link('kb-new');
    gateway.replaceLinks.mockRejectedValueOnce(new Error('write failed'));
    await session.save();
    expect(gateway.replaceLinks).toHaveBeenCalledWith('project-b', ['kb-new']);
    expect(session.linkedIds.value).toEqual(['kb-new']);
    expect(gateway.saved).not.toHaveBeenCalled();
    expect(gateway.saveFailed).toHaveBeenCalledOnce();
  });
  it('切项目后的迟到读取和保存不回写新页面、不误关闭新弹层', async () => {
    const gateway = port();
    let finishRead: ((ids: string[]) => void) | undefined;
    gateway.readLinks.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    const old = createProjectAssociationSession('project-a', gateway);
    const loading = old.load();
    await Promise.resolve();
    old.dispose(); finishRead?.(['kb-a']); await loading;
    expect(old.linkedIds.value).toEqual([]);
    await old.save(); expect(gateway.replaceLinks).not.toHaveBeenCalled();

    const current = createProjectAssociationSession('project-b', gateway);
    await current.load();
    let finishSave: (() => void) | undefined;
    gateway.replaceLinks.mockImplementationOnce(() => new Promise(resolve => { finishSave = () => resolve(undefined); }));
    const saving = current.save();
    current.dispose(); finishSave?.(); await saving;
    expect(gateway.replaceLinks).toHaveBeenCalledWith('project-b', ['kb-old']);
    expect(gateway.saved).not.toHaveBeenCalled();
  });
});
