import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRESENTATION_IMAGE_BINDING_SCHEMAS } from '../../../../persistence/schemas/presentationImageBinding.schema';
import { PresentationImageBindingRepository } from './PresentationImageBindingRepository';

describe('PresentationImageBindingRepository', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE workspace_nodes (id TEXT PRIMARY KEY)');
    for (const statement of PRESENTATION_IMAGE_BINDING_SCHEMAS) db.exec(statement);
    db.prepare('INSERT INTO workspace_nodes (id) VALUES (?)').run('presentation-1');
  });

  afterEach(() => db.close());

  it('同一源码图片身份首次绑定后保持不可变', () => {
    const repository = new PresentationImageBindingRepository(db);
    const first = repository.bind({
      presentationId: 'presentation-1',
      sourceIdentity: 'local_path:/tmp/image.png',
      assetId: 'asset-first',
      createdAt: 100,
    });
    const repeated = repository.bind({
      presentationId: 'presentation-1',
      sourceIdentity: 'local_path:/tmp/image.png',
      assetId: 'asset-later',
      createdAt: 200,
    });

    expect(first).toEqual({
      presentationId: 'presentation-1',
      sourceIdentity: 'local_path:/tmp/image.png',
      assetId: 'asset-first',
      createdAt: 100,
    });
    expect(repeated).toEqual(first);
  });

  it('workspace 文档删除时级联删除 Slides 图片绑定', () => {
    const repository = new PresentationImageBindingRepository(db);
    repository.bind({
      presentationId: 'presentation-1',
      sourceIdentity: 'data_uri:hash',
      assetId: 'asset-1',
    });

    db.pragma('foreign_keys = ON');
    db.prepare('DELETE FROM workspace_nodes WHERE id = ?').run('presentation-1');

    expect(
      repository.find({
        presentationId: 'presentation-1',
        sourceIdentity: 'data_uri:hash',
      })
    ).toBeNull();
  });
});
