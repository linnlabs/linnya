import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PptCoordinator } from '@plugin/slides/backend-coordinator';import { DeckAssembler } from '../engine/DeckAssembler.js';import { FreeformCompiler } from '../engine/FreeformCompiler.js';import { PatchCompiler } from '../engine/patch/PatchCompiler.js';import { PptxReader } from '../engine/parser/PptxReader.js';import { StructuredCompiler } from '../engine/StructuredCompiler.js';import { TemplateManager } from '../engine/template/TemplateManager.js';
import { PresentationRepository } from '../persistence';
import { PRESENTATION_DOCUMENT_SCHEMAS } from '../persistence/schemas/presentation.schema';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace.js';
import { WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/node-text-snapshot.schema.js';
import {
  getDefaultSandboxService,
  installDefaultSandboxRunner,
} from 'src/features/sandbox/sandboxCompositionRoot.js';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner.js';
import { pptComposeProfile } from '@plugin/slides/backend-sandbox';
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

const testSource = [
  'const slide = createSlide();',
  'slide.add(createText("Integration Deck"));',
  'slide.add(createText("phase 1 end-to-end path"));',
  'compose({ title: "Integration Deck", layout: "16x9", slides: [slide] });',
].join('\n');

describe('Phase 1 end-to-end chain', () => {
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
    for (const ddl of [
      ...WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS,
      ...PRESENTATION_DOCUMENT_SCHEMAS,
    ]) {
      db.exec(ddl);
    }
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('runs codegen create -> preview -> export with real compiler, repository, and sqlite storage', async () => {
    const workspaceService = new WorkspaceService(db);
    const structuredCompiler = new StructuredCompiler();
    const freeformCompiler = new FreeformCompiler();
    const deckAssembler = new DeckAssembler(structuredCompiler, freeformCompiler);
    const assembleSpy = vi.spyOn(deckAssembler, 'assemble');
    const repository = new PresentationRepository(db);
    const pptxReader = new PptxReader();
    const templateManager = new TemplateManager(pptxReader, repository);
    const patchCompiler = new PatchCompiler(structuredCompiler);

    const coordinator = new PptCoordinator(
      deckAssembler,
      patchCompiler,
      pptxReader,
      templateManager,
      repository,
      {
        async createPresentationNode(options) {
          const node = workspaceService.createNode({
            type: 'presentation',
            name: options.title,
            projectId: options.projectId,
            parentId: options.parentId ?? null,
          });
          return node.id;
        },
        async deletePresentationNode(nodeId) {
          workspaceService.deleteNode(nodeId);
        },
      },
      undefined,
      undefined,
      { buildExecution: createInProcessPresentationBuildExecution() },
    );

    const created = await coordinator.getCodegenPresentationService().write(
      { source: testSource },
      {
        conversationId: 'conversation-1',
        projectId: 'project-1',
        parentId: 'folder-1',
      },
    );
    const nodeId = created.presentationId;

    const node = workspaceService.getNode(nodeId);
    expect(node).not.toBeNull();
    expect(node?.type).toBe('presentation');
    expect(node?.name).toBe('Integration Deck');

    const document = await repository.getPresentation(nodeId);
    expect(document?.currentRevisionId).toBe(created.versionId);
    expect(document?.deckSource).toBe(testSource);
    expect(document?.pptxBuffer).toBeInstanceOf(Buffer);
    expect(await repository.getRevisionSource(nodeId, 1)).toBe(testSource);
    expect(await repository.listRevisions(nodeId)).toHaveLength(1);

    const exported = await coordinator.export(nodeId);
    expect(exported.fileName).toBe('Integration Deck.pptx');
    expect(exported.buffer.equals(document?.pptxBuffer ?? Buffer.alloc(0))).toBe(true);
    expect(assembleSpy).toHaveBeenCalledTimes(1);

    const zip = await JSZip.loadAsync(exported.buffer);
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    expect(Object.keys(zip.files).some((file) => file === 'ppt/slides/slide1.xml')).toBe(true);
  });

  it('creates a previewable empty presentation for generic create-document flows', async () => {
    const workspaceService = new WorkspaceService(db);
    const structuredCompiler = new StructuredCompiler();
    const freeformCompiler = new FreeformCompiler();
    const repository = new PresentationRepository(db);
    const pptxReader = new PptxReader();
    const templateManager = new TemplateManager(pptxReader, repository);
    const patchCompiler = new PatchCompiler(structuredCompiler);
    const deckAssembler = new DeckAssembler(structuredCompiler, freeformCompiler);

    const coordinator = new PptCoordinator(
      deckAssembler,
      patchCompiler,
      pptxReader,
      templateManager,
      repository,
      {
        async createPresentationNode(options) {
          const node = workspaceService.createNode({
            type: 'presentation',
            name: options.title,
            projectId: options.projectId,
            parentId: options.parentId ?? null,
          });
          return node.id;
        },
        async deletePresentationNode(nodeId) {
          workspaceService.deleteNode(nodeId);
        },
      },
      undefined,
      undefined,
      { buildExecution: createInProcessPresentationBuildExecution() },
    );

    const result = await coordinator.createEmptyPresentation({
      projectId: 'project-1',
      title: 'Blank Deck',
    });

    const preview = await coordinator.getPreview(result.nodeId);
    expect(preview.title).toBe('Blank Deck');
    expect(preview.slides).toHaveLength(1);
    expect(preview.slides[0]?.elements).toEqual([]);
  });
});
