import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectLifecycle, PROJECT_SCHEMAS } from 'src/domains/projects';
import { createBackendRendererRequestRegistry } from 'src/app-hosts/linnya/adapters/backend-renderer-requests/orchestration/createBackendRendererRequestRegistry';
import { createBackendRendererIpcStyleRegistrar } from 'src/app-hosts/linnya/adapters/backend-renderer-requests/orchestration/createBackendRendererIpcStyleRegistrar';
import { projectGateway } from '@/shared/ipc/projectGateway';
import { registerProjectHandlers } from './project-ipc';

describe('Project Renderer gateway → Backend IPC → SQLite', () => {
  let db: Database.Database;
  let registry: ReturnType<typeof createBackendRendererRequestRegistry>;

  beforeEach(() => {
    db = new Database(':memory:');
    PROJECT_SCHEMAS.forEach(sql => db.exec(sql));
    registry = createBackendRendererRequestRegistry();
    registerProjectHandlers(
      () => createProjectLifecycle(db),
      createBackendRendererIpcStyleRegistrar(registry)
    );
    vi.stubGlobal('window', {
      electronAPI: {
        invoke: (channel: string, ...args: unknown[]) => registry.invoke(channel, args),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
  });

  it('creates, lists, renames and deletes ordinary projects through the existing Desktop channels', async () => {
    const created = await projectGateway.create({ name: ' Research ', description: 'Notes' });
    if (!created.success) throw new Error(created.error);
    const projectId = created.data.projectId;
    const listed = await projectGateway.list();
    if (!listed.success) throw new Error(listed.error);
    expect(listed.data.projects).toHaveLength(1);
    expect(listed.data.projects[0]).toMatchObject({
      id: projectId,
      name: 'Research',
      can_delete: true,
    });
    expect(await projectGateway.update({ projectId, name: 'Renamed' })).toEqual({ success: true });
    expect(createProjectLifecycle(db).get(projectId)).toMatchObject({
      name: 'Renamed',
      description: 'Notes',
    });
    expect(await projectGateway.delete(projectId)).toEqual({ success: true });
    expect(await projectGateway.list()).toEqual({ success: true, data: { projects: [] } });
  });

  it('returns domain failures and rejects invalid input before changing project data', async () => {
    const created = await projectGateway.ensureDefault();
    if (!created.success) throw new Error(created.error);
    const projectId = created.data.projectId;
    expect(await projectGateway.delete(projectId)).toMatchObject({
      success: false,
      userMessage: { key: 'workspace.project.operation.defaultProjectDeleteBlocked' },
    });
    expect(await projectGateway.update({ projectId: 'missing', name: 'New' })).toMatchObject({
      success: false,
      userMessage: { key: 'workspace.project.operation.projectNotFound' },
    });
    expect(
      await registry.invoke('workspace:create-project', [
        { name: 'Ordinary', system_role: 'default' },
      ])
    ).toMatchObject({ success: false });
    expect(await projectGateway.create({ name: ' ' })).toMatchObject({ success: false });
    expect(await projectGateway.update({ projectId })).toMatchObject({ success: false });
    expect(createProjectLifecycle(db).list()).toHaveLength(1);
  });
});
