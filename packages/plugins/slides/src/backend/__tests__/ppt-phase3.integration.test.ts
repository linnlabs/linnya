import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PptCoordinator } from '@plugin/slides/backend-coordinator';
import { pptComposeProfile } from '@plugin/slides/backend-sandbox';
import { DeckAssembler } from '../engine/DeckAssembler.js';
import { FreeformCompiler } from '../engine/FreeformCompiler.js';
import { PatchCompiler } from '../engine/patch/PatchCompiler.js';
import { PptxReader } from '../engine/parser/PptxReader.js';
import { StructuredCompiler } from '../engine/StructuredCompiler.js';
import { TemplateManager } from '../engine/template/TemplateManager.js';
import { PresentationDraftRepository, PresentationRepository } from '../persistence';
import { PRESENTATION_DOCUMENT_SCHEMAS } from '../persistence/schemas/presentation.schema';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace.js';
import {
  getDefaultSandboxService,
  installDefaultSandboxRunner,
} from 'src/features/sandbox/sandboxCompositionRoot.js';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner.js';
import { WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/node-text-snapshot.schema.js';
import { createInProcessPresentationBuildExecution } from '../features/presentationBuildExecution';

const WORKSPACE_NODES_DDL = `
  CREATE TABLE IF NOT EXISTS workspace_nodes (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    parent_id TEXT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    last_opened_at INTEGER,
    access_count INTEGER DEFAULT 0,
    tags TEXT
  )
`;

const initialSource = [
  'const slide = createSlide();',
  'slide.add(createText("Original Title"));',
  'slide.add(createText("Original Body"));',
  'compose({ title: "Revision Deck", layout: "16x9", slides: [slide] });',
].join('\n');

function createStack(db: Database.Database) {
  const workspaceService = new WorkspaceService(db);
  const structuredCompiler = new StructuredCompiler();
  const freeformCompiler = new FreeformCompiler();
  const deckAssembler = new DeckAssembler(structuredCompiler, freeformCompiler);
  const repository = new PresentationRepository(db);
  const draftRepository = new PresentationDraftRepository(db);
  const pptxReader = new PptxReader();
  const coordinator = new PptCoordinator(
    deckAssembler,
    new PatchCompiler(structuredCompiler),
    pptxReader,
    new TemplateManager(pptxReader, repository),
    repository,
    {
      async createPresentationNode(options) {
        return workspaceService.createNode({
          type: 'presentation',
          name: options.title,
          projectId: options.projectId,
          parentId: options.parentId ?? null,
        }).id;
      },
      async deletePresentationNode(nodeId) {
        workspaceService.deleteNode(nodeId);
      },
      async getPresentationProjectId(nodeId) {
        return workspaceService.getNode(nodeId)?.project_id ?? null;
      },
    },
    undefined,
    draftRepository,
    { buildExecution: createInProcessPresentationBuildExecution() },
  );
  return { coordinator, draftRepository, pptxReader, repository };
}

describe('Phase 3 source revision integration', () => {
  let db: Database.Database;

  beforeAll(() => {
    installDefaultSandboxRunner(createSandboxEvaluatorTestRunner());
    getDefaultSandboxService().registerProfile(pptComposeProfile, { replace: true });
  });

  afterAll(() => {
    getDefaultSandboxService().unregisterProfile(pptComposeProfile.id);
  });

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(WORKSPACE_NODES_DDL);
    for (const ddl of [...WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS, ...PRESENTATION_DOCUMENT_SCHEMAS]) {
      db.exec(ddl);
    }
  });

  afterEach(() => {
    db.close();
  });

  it('runs create -> source edit -> inspect -> export while preserving reconstructable history', async () => {
    const { coordinator, pptxReader, repository } = createStack(db);
    const service = coordinator.getCodegenPresentationService();
    const created = await service.write(
      { source: initialSource },
      { conversationId: 'conversation-1', projectId: 'project-1' }
    );

    const edited = await service.edit(
      {
        presentation_id: created.presentationId,
        old_string: 'Original Title',
        new_string: 'Updated Title',
      },
      { conversationId: 'conversation-1' }
    );

    const document = await repository.getPresentation(created.presentationId);
    const revisions = await repository.listRevisions(created.presentationId);
    expect(document).toMatchObject({
      currentRevisionId: edited.versionId,
      currentRevision: 2,
      slideCount: 1,
    });
    expect(document?.deckSource).toContain('Updated Title');
    expect(revisions.map(revision => revision.revision)).toEqual([2, 1]);
    expect(await repository.getRevisionSource(created.presentationId, 1)).toBe(initialSource);
    expect(await repository.getRevisionSource(created.presentationId, 2)).toBe(
      initialSource.replace('Original Title', 'Updated Title')
    );

    const info = await coordinator.inspect(created.presentationId);
    const texts = info.slides[0]?.elements
      .filter(element => element.type === 'text' && element.text)
      .map(element => element.text);
    expect(texts).toContain('Updated Title');
    const exported = await coordinator.export(created.presentationId);
    expect((await pptxReader.parse(exported.buffer)).slideCount).toBe(1);

    const restored = await coordinator.restoreRevision(created.presentationId, 1);
    const restoredDocument = await repository.getPresentation(created.presentationId);
    expect(restored).toMatchObject({
      nodeId: created.presentationId,
      versionNumber: 3,
    });
    expect(restoredDocument?.deckSource).toBe(initialSource);
    expect((await repository.listRevisions(created.presentationId))[0]).toMatchObject({
      revisionId: restored.versionId,
      revision: 3,
      origin: 'restore',
    });
  });

  it('returns a saved draft while keeping current materialization and revision history unchanged', async () => {
    const { coordinator, draftRepository, repository } = createStack(db);
    const service = coordinator.getCodegenPresentationService();
    const created = await service.write(
      { source: initialSource },
      { conversationId: 'conversation-1', projectId: 'project-1' }
    );
    const before = await repository.getPresentation(created.presentationId);

    const pending = await service.write(
      {
        presentation_id: created.presentationId,
        source: 'interface InvalidDeck { title: string; }',
      },
      { conversationId: 'conversation-1', projectId: 'project-1' }
    );
    expect(pending).toMatchObject({
      buildStatus: 'draft',
      buildFailure: {
        code: 'slides.codegen.typecheck',
        draftSaved: true,
        presentationId: created.presentationId,
      },
    });

    const after = await repository.getPresentation(created.presentationId);
    expect(after?.currentRevisionId).toBe(before?.currentRevisionId);
    expect(after?.deckSource).toBe(initialSource);
    expect(await repository.listRevisions(created.presentationId)).toHaveLength(1);
    expect(draftRepository.get(created.presentationId)).toMatchObject({
      baseRevisionId: before?.currentRevisionId,
      baseRevision: 1,
      lastErrorKind: 'slides.codegen.typecheck',
    });
  });
});
