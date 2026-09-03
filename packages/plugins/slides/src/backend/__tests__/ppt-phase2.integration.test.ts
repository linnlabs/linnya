import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PptCoordinator } from '@plugin/slides/backend-coordinator';
import { pptComposeProfile } from '@plugin/slides/backend-sandbox';
import { DeckAssembler } from '../engine/DeckAssembler.js';
import { FreeformCompiler } from '../engine/FreeformCompiler.js';
import { PatchCompiler } from '../engine/patch/PatchCompiler.js';
import { PptxReader } from '../engine/parser/PptxReader.js';
import { StructuredCompiler } from '../engine/StructuredCompiler.js';
import { TemplateManager } from '../engine/template/TemplateManager.js';
import { PresentationRepository } from '../persistence';
import { PRESENTATION_DOCUMENT_SCHEMAS } from '../persistence/schemas/presentation.schema';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace.js';
import {
  getDefaultSandboxService,
  installDefaultSandboxRunner,
} from 'src/features/sandbox/sandboxCompositionRoot.js';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner.js';
import { WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/node-text-snapshot.schema.js';
import { createInProcessPresentationBuildExecution } from '../features/presentationBuildExecution';

const FIXTURES_DIR = join(__dirname, 'fixtures');

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
  'slide.add(createText("Phase 2 Test"));',
  'slide.add(createText("Testing inspect flow"));',
  'compose({ title: "Phase 2 Test Deck", layout: "16x9", slides: [slide] });',
].join('\n');

function loadFixture(name: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, name));
}

function createStack(db: Database.Database) {
  const workspaceService = new WorkspaceService(db);
  const structuredCompiler = new StructuredCompiler();
  const freeformCompiler = new FreeformCompiler();
  const deckAssembler = new DeckAssembler(structuredCompiler, freeformCompiler);
  const repository = new PresentationRepository(db);
  const pptxReader = new PptxReader();
  const templateManager = new TemplateManager(pptxReader, repository);
  const coordinator = new PptCoordinator(
    deckAssembler,
    new PatchCompiler(structuredCompiler),
    pptxReader,
    templateManager,
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
    undefined,
    { buildExecution: createInProcessPresentationBuildExecution() },
  );
  return { coordinator, deckAssembler, repository, templateManager };
}

describe('Phase 2 integration', () => {
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

  it('inspects a codegen presentation from the current materialized PPTX', async () => {
    const { coordinator, deckAssembler, repository } = createStack(db);
    const assembleSpy = vi.spyOn(deckAssembler, 'assemble');
    const created = await coordinator.getCodegenPresentationService().write(
      { source: testSource },
      { conversationId: 'conversation-1', projectId: 'project-1' },
    );

    const info = await coordinator.inspect(created.presentationId);

    expect(info.slideCount).toBe(1);
    const texts = info.slides[0]?.elements
      .filter((element) => element.type === 'text' && element.text)
      .map((element) => element.text);
    expect(texts).toContain('Phase 2 Test');
    expect(texts).toContain('Testing inspect flow');
    expect(assembleSpy).toHaveBeenCalledTimes(1);
    expect((await repository.getPresentation(created.presentationId))?.pptxBuffer.length)
      .toBeGreaterThan(0);
  });

  it('throws for a missing current presentation', async () => {
    const { coordinator } = createStack(db);

    await expect(coordinator.inspect('no-such-id')).rejects.toThrow('Presentation not found');
  });

  it('imports a PPTX as a template without mixing it into presentation history', async () => {
    const { coordinator, templateManager } = createStack(db);
    const sourcePptx = loadFixture('themed.pptx');

    const template = await coordinator.importTemplate(sourcePptx, 'My Theme', 'A themed template');
    const templates = await coordinator.listTemplates();
    const stored = await templateManager.getTemplate(template.id);

    expect(templates).toEqual([
      expect.objectContaining({ id: template.id, name: 'My Theme' }),
    ]);
    expect(stored?.sourcePptxBuffer.equals(sourcePptx)).toBe(true);
    expect(stored?.spec.theme.fonts?.major).toBe('Calibri Light');
    expect(db.prepare('SELECT COUNT(*) AS count FROM presentation_documents').get())
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM presentation_revisions').get())
      .toEqual({ count: 0 });
  });
});
