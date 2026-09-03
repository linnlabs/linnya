import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SandboxExecutionResult } from '@plugin/backend/sandboxRuntime';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema.js';
import { WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/node-text-snapshot.schema.js';
import { PRESENTATION_DOCUMENT_SCHEMAS } from '../../persistence/schemas/presentation.schema';
import { PresentationRepository } from '../../persistence';
import { CodegenDeckBuilder, type CodegenDeckBuildInput } from '../CodegenDeckBuilder';
import {
  CodegenPresentationService,
  type CodegenPresentationBuilderPort,
} from '../CodegenPresentationService';
import { createInProcessPresentationBuildExecution } from '../../features/presentationBuildExecution';

const SOURCE = [
  'const slide = createSlide();',
  'slide.add(createText("Original"));',
  'compose({ title: "Deck", slides: [slide] });',
].join('\n');

describe('CodegenPresentationService optimistic concurrency', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    for (const ddl of [
      ...CORE_SCHEMAS,
      ...WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS,
      ...PRESENTATION_DOCUMENT_SCHEMAS,
    ]) {
      db.exec(ddl);
    }
    db.prepare(
      `
      INSERT INTO projects (id, name, created_at, updated_at)
      VALUES ('project-1', 'Project', 1, 1)
    `
    ).run();
    db.prepare(
      `
      INSERT INTO workspace_nodes (
        id, project_id, parent_id, type, name, created_at, updated_at, deleted_at
      ) VALUES ('deck-1', 'project-1', NULL, 'presentation', 'deck.slides', 1, 1, NULL)
    `
    ).run();
    await new PresentationRepository(db).createPresentation(
      'deck-1',
      { title: 'Deck', slides: [] },
      { pptxBuffer: Buffer.from('pptx-1'), deckSource: SOURCE, origin: 'codegen' }
    );
  });

  afterEach(() => db.close());

  it('同一 revision 发起的旧编辑不会覆盖先完成的新编辑', async () => {
    const repository = new PresentationRepository(db);
    const sandbox = { execute: vi.fn(async () => sandboxResult()) };
    const engine = { assembleDeck: vi.fn(async () => Buffer.from('pptx')) };
    const builder = new CodegenDeckBuilder({
      presentationRepo: repository,
      sandbox,
      engine,
      buildExecution: createInProcessPresentationBuildExecution(),
    });
    const firstBuildStarted = createSignal();
    const releaseFirstBuild = createSignal();
    const delayedBuilder: CodegenPresentationBuilderPort = {
      buildNewPresentation: input => builder.buildNewPresentation(input),
      async buildFromSource(input: CodegenDeckBuildInput) {
        firstBuildStarted.resolve();
        await releaseFirstBuild.promise;
        return builder.buildFromSource(input);
      },
    };
    const firstService = new CodegenPresentationService({
      presentationRepo: repository,
      builder: delayedBuilder,
      buildExecution: createInProcessPresentationBuildExecution(),
    });
    const secondService = new CodegenPresentationService({
      presentationRepo: repository,
      builder,
      buildExecution: createInProcessPresentationBuildExecution(),
    });

    const staleEdit = firstService.edit(
      {
        presentation_id: 'deck-1',
        old_string: 'Original',
        new_string: 'First edit',
      },
      { conversationId: 'conversation-1' }
    );
    await firstBuildStarted.promise;

    await secondService.edit(
      {
        presentation_id: 'deck-1',
        old_string: 'Original',
        new_string: 'Second edit',
      },
      { conversationId: 'conversation-2' }
    );
    releaseFirstBuild.resolve();

    await expect(staleEdit).rejects.toMatchObject({
      errorCode: 9,
      message: expect.stringContaining('Use read_file to reload'),
    });
    const current = await repository.getPresentation('deck-1');
    expect(current?.currentRevision).toBe(2);
    expect(current?.deckSource).toContain('Second edit');
    expect(current?.deckSource).not.toContain('First edit');
    expect(sandbox.execute).toHaveBeenCalledOnce();
  });
});

function createSignal(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolver: (() => void) | null = null;
  const promise = new Promise<void>(resolve => {
    resolver = resolve;
  });
  return {
    promise,
    resolve() {
      if (!resolver) throw new Error('Deferred resolver was not initialized');
      resolver();
    },
  };
}

function sandboxResult(): SandboxExecutionResult {
  return {
    success: true,
    value: {
      mode: 'create',
      composeCallCount: 1,
      composeInput: {
        title: 'Deck',
        slides: [
          {
            _type: 'Slide',
            children: [{ _type: 'Text', content: 'Edited' }],
          },
        ],
      },
      layoutTrace: {
        version: 1,
        truncated: false,
        roots: [1],
        nodes: [
          {
            id: 1,
            type: 'Slide',
            startLine: 1,
            endLine: 3,
            children: [2],
            configured: false,
            content: false,
          },
          {
            id: 2,
            type: 'Text',
            startLine: 2,
            endLine: 2,
            children: [],
            configured: false,
            content: true,
          },
        ],
      },
    },
    logs: [],
    usage: {
      elapsedMs: 1,
      logLines: 0,
      logBytes: 0,
      resultBytes: 0,
      capabilityCallCount: 1,
      capabilityCallsByName: { 'host.compose': 1 },
      deniedActions: [],
    },
    telemetry: {
      runId: 'run-1',
      profileId: 'ppt_compose',
      policyVersion: 'v1',
      limits: {
        timeoutMs: 10_000,
        maxLogLines: 200,
        maxLogLineLength: 2_000,
        maxResultBytes: 256 * 1024,
        maxSourceBytes: 128 * 1024,
        maxCapabilityPayloadBytes: 256 * 1024,
        maxHeapMb: 128,
        idleTimeoutMs: 12_000,
      },
      diagnostics: {
        runnerKind: 'test',
        startConfirmed: true,
        heartbeatCount: 0,
        protocolEvents: [],
        stderrBytes: 0,
        idleTimeoutTriggered: false,
        cleanupStatus: 'succeeded',
      },
    },
    artifacts: [],
  };
}
