import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPptCoordinator } from '@plugin/slides/backend-coordinator';
import type {
  PluginDocumentImageAsset,
  PluginDocumentImageAssetRuntimePort,
} from '@plugin/backend/documentImageAsset';
import type {
  PluginDocumentSvgAsset,
  PluginDocumentSvgAssetRuntimePort,
} from '@plugin/backend/documentSvgAsset';
import { PRESENTATION_DOCUMENT_SCHEMAS } from '../persistence/schemas/presentation.schema';
import { PRESENTATION_IMAGE_BINDING_SCHEMAS } from '../persistence/schemas/presentationImageBinding.schema';
import { PRESENTATION_SVG_GRAPHIC_BINDING_SCHEMAS } from '../persistence/schemas/presentationSvgGraphicBinding.schema';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema.js';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema.js';
import { WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/node-text-snapshot.schema.js';
import {
  getDefaultSandboxService,
  installDefaultSandboxRunner,
} from 'src/features/sandbox/sandboxCompositionRoot.js';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner.js';
import { pptComposeProfile } from '@plugin/slides/backend-sandbox';
import { admitSvgGraphic } from '../engine/svgGraphic/admission/admitSvgGraphic';
import { createInProcessPresentationBuildExecution } from '../features/presentationBuildExecution';
import {
  clearWorkspaceMutationPublisherForTesting,
  installWorkspaceMutationPublisher,
} from 'src/features/workspace/orchestration/workspaceMutationPublisherRegistry';

interface PresentationDocumentRow {
  readonly deck_spec_json: string;
}

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFeAL+zE9p4QAAAABJRU5ErkJggg==',
  'base64'
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPresentationDocumentRow(value: unknown): value is PresentationDocumentRow {
  return isRecord(value) && typeof value.deck_spec_json === 'string';
}

function readPresentationDocument(db: Database.Database, nodeId: string): PresentationDocumentRow {
  const row = db
    .prepare('SELECT deck_spec_json FROM presentation_documents WHERE node_id = ?')
    .get(nodeId);
  if (!isPresentationDocumentRow(row)) {
    throw new Error(`presentation document not found in test: ${nodeId}`);
  }
  return row;
}

function readFirstImageSource(deckSpecJson: string): unknown {
  return readFirstElement(deckSpecJson).src;
}

function readFirstElement(deckSpecJson: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(deckSpecJson);
  if (!isRecord(parsed) || !Array.isArray(parsed.slides)) {
    throw new Error('invalid persisted deck spec in test: missing slides');
  }
  const firstSlide = parsed.slides[0];
  if (
    !isRecord(firstSlide) ||
    !isRecord(firstSlide.spec) ||
    !Array.isArray(firstSlide.spec.elements)
  ) {
    throw new Error('invalid persisted deck spec in test: missing first slide elements');
  }
  const firstElement = firstSlide.spec.elements[0];
  if (!isRecord(firstElement)) {
    throw new Error('invalid persisted deck spec in test: missing first element');
  }
  return firstElement;
}

function installSchemas(db: Database.Database): void {
  for (const ddl of [
    ...CORE_SCHEMAS,
    ...ASSET_LEDGER_SCHEMAS,
    ...WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS,
    ...PRESENTATION_DOCUMENT_SCHEMAS,
    ...PRESENTATION_IMAGE_BINDING_SCHEMAS,
    ...PRESENTATION_SVG_GRAPHIC_BINDING_SCHEMAS,
  ]) {
    db.exec(ddl);
  }
}

async function flushDeferredPublishers(): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });
}

describe('createPptCoordinator — image source resolver integration', () => {
  let db: Database.Database;
  let tempDir: string;

  beforeAll(() => {
    installDefaultSandboxRunner(createSandboxEvaluatorTestRunner());
    getDefaultSandboxService().registerProfile(pptComposeProfile, { replace: true });
  });

  afterAll(() => {
    getDefaultSandboxService().unregisterProfile(pptComposeProfile.id);
  });

  beforeEach(() => {
    // 该集成测试直接装配插件 backend，不经过真实 App composition；显式安装
    // 测试 publisher，避免绕过生产环境“Workspace 事实不得静默丢失”的门禁。
    installWorkspaceMutationPublisher(() => undefined);
    db = new Database(':memory:');
    installSchemas(db);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-ppt-assets-'));
  });

  afterEach(async () => {
    await flushDeferredPublishers();
    clearWorkspaceMutationPublisherForTesting();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('首次编译接管图片，原文件删除后修改 deck 仍使用 presentation-owned asset', async () => {
    const imagePath = path.join(tempDir, 'generated.png');
    fs.writeFileSync(imagePath, ONE_BY_ONE_PNG);
    db.prepare(
      `
      INSERT INTO projects (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `
    ).run('project-1', 'Test Project', 1, 1);

    const managedAssets = new Map<string, PluginDocumentImageAsset>();
    let localAdoptionCount = 0;
    let ownedReadCount = 0;
    let sourceAvailable = true;
    const documentImageAssetRuntime: PluginDocumentImageAssetRuntimePort = {
      async adoptLocalImage(input) {
        localAdoptionCount += 1;
        const bytes = fs.readFileSync(input.sourcePath);
        const asset = createTestDocumentImageAsset('asset-owned', bytes);
        managedAssets.set(asset.assetId, asset);
        return asset;
      },
      async adoptImageBytes(input) {
        const asset = createTestDocumentImageAsset('asset-bytes', Buffer.from(input.bytes));
        managedAssets.set(asset.assetId, asset);
        return asset;
      },
      async readOwnedImage(input) {
        ownedReadCount += 1;
        const asset = managedAssets.get(input.assetId);
        if (!asset) throw new Error(`test managed image not found: ${input.assetId}`);
        return asset;
      },
    };
    const conversationFilePathResolver = {
      resolveRelativePath: async ({
        conversationId,
        relativePath,
      }: {
        readonly conversationId: string;
        readonly relativePath: string;
      }) => {
        if (!sourceAvailable) {
          throw new Error('conversation source is no longer available');
        }
        expect(conversationId).toBe('conversation-1');
        expect(relativePath).toBe('generated-images/generated.png');
        return imagePath;
      },
    };
    const coordinator = createPptCoordinator(db, {
      buildExecution: createInProcessPresentationBuildExecution(),
      documentImageAssetRuntime,
      conversationFilePathResolver: {
        resolveRelativePath: conversationFilePathResolver.resolveRelativePath,
      },
    });
    const source = [
      'const slide = createSlide();',
      'slide.add(createImage({ src: "generated-images/generated.png", width: 2, height: 2 }));',
      'compose({ title: "Conversation Image Deck", layout: "16x9", slides: [slide] });',
    ].join('\n');
    const context = { conversationId: 'conversation-1', projectId: 'project-1' };
    const result = await coordinator.getCodegenPresentationService().write({ source }, context);
    const firstDocument = readPresentationDocument(db, result.presentationId);

    expect(readFirstImageSource(firstDocument.deck_spec_json)).toBe(
      'generated-images/generated.png'
    );
    expect(localAdoptionCount).toBe(1);
    expect(
      db
        .prepare(
          `
      SELECT asset_id FROM presentation_image_bindings
      WHERE presentation_id = ? AND source_identity = ?
    `
        )
        .get(result.presentationId, 'conversation:generated-images/generated.png')
    ).toEqual({ asset_id: 'asset-owned' });

    fs.unlinkSync(imagePath);
    sourceAvailable = false;
    const updatedSource = source.replace('Conversation Image Deck', 'Edited Image Deck');
    await coordinator
      .getCodegenPresentationService()
      .write(
        { presentation_id: result.presentationId, source: updatedSource },
        { conversationId: 'conversation-1', projectId: 'project-1' }
      );
    const updatedDocument = readPresentationDocument(db, result.presentationId);

    expect(readFirstImageSource(updatedDocument.deck_spec_json)).toBe(
      'generated-images/generated.png'
    );
    expect(localAdoptionCount).toBe(1);
    expect(ownedReadCount).toBe(1);
  });

  it('Agent inline SVG 经 admission/ownership 后可预览并原生写入 PPTX', async () => {
    db.prepare(
      `
      INSERT INTO projects (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `
    ).run('project-svg', 'SVG Project', 1, 1);
    const svgAssets = new Map<string, PluginDocumentSvgAsset>();
    const documentSvgAssetRuntime: PluginDocumentSvgAssetRuntimePort = {
      async adoptCanonicalSvg(input) {
        const asset: PluginDocumentSvgAsset = {
          assetId: 'owned-svg-asset-1',
          mediaType: 'image/svg+xml',
          byteLength: Buffer.byteLength(input.canonicalSvg, 'utf8'),
          sha256: input.contentHash,
          canonicalSvg: input.canonicalSvg,
        };
        svgAssets.set(asset.assetId, asset);
        return asset;
      },
      async readOwnedSvg(input) {
        const asset = svgAssets.get(input.assetId);
        if (!asset) throw new Error('test owned SVG not found');
        return asset;
      },
    };
    const coordinator = createPptCoordinator(db, {
      buildExecution: createInProcessPresentationBuildExecution(),
      documentSvgAssetRuntime,
      svgGraphicFallbackRasterizer: {
        async rasterizeSvgGraphic() {
          return {
            pngBytes: Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X0Y5WQAAAABJRU5ErkJggg==',
              'base64',
            ),
            widthPx: 1,
            heightPx: 1,
          };
        },
      },
    });
    const inlineSvg = '<svg viewBox="0 0 100 50"><path d="M0 25L100 25" stroke="#2563EB" stroke-width="4"/></svg>';
    const canonicalSvg = admitSvgGraphic(inlineSvg).canonicalSvg;
    const source = [
      'const slide = createSlide();',
      `slide.add(createSvgGraphic({ source: ${JSON.stringify(inlineSvg)}, width: 6, height: 3, altText: "蓝色流程线" }));`,
      'compose({ title: "Owned SVG Deck", layout: "16x9", slides: [slide] });',
    ].join('\n');

    const result = await coordinator.getCodegenPresentationService().write(
      { source },
      { conversationId: 'conversation-svg', projectId: 'project-svg' },
    );
    expect(result.buildFailure).toBeUndefined();
    expect(result).toMatchObject({ buildStatus: 'ready' });
    const document = readPresentationDocument(db, result.presentationId);
    const element = readFirstElement(document.deck_spec_json);

    expect(element).toEqual(expect.objectContaining({
      type: 'svgGraphic',
      asset: expect.objectContaining({ kind: 'owned_svg' }),
      altText: '蓝色流程线',
    }));
    expect(document.deck_spec_json).not.toContain('<svg');
    expect(db.prepare(
      'SELECT COUNT(*) AS count FROM presentation_svg_graphic_bindings WHERE presentation_id = ?',
    ).get(result.presentationId)).toEqual({ count: 1 });

    const renderModel = await coordinator.getRenderModel(result.presentationId);
    expect(renderModel.slides[0].elements[0]).toEqual(expect.objectContaining({
      kind: 'svgGraphic',
      canonicalSvg,
      altText: '蓝色流程线',
    }));

    const exported = await coordinator.export(result.presentationId);
    const zip = await JSZip.loadAsync(exported.buffer);
    const svgPart = Object.keys(zip.files).find(name => name.endsWith('.svg'));
    expect(svgPart).toBeDefined();
    expect(await zip.file(svgPart ?? '')?.async('text')).toBe(canonicalSvg);
  });

  it('首次 deck.js 编译失败仍创建可见 VFS 文档，并在修复后恢复 ready', async () => {
    db.prepare(
      `
      INSERT INTO projects (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `
    ).run('project-draft', 'Draft Project', 1, 1);
    const coordinator = createPptCoordinator(db, {
      buildExecution: createInProcessPresentationBuildExecution(),
    });
    const source = 'interface Broken { x: number; }';

    const created = await coordinator.getCodegenPresentationService().write(
      { source },
      {
        conversationId: 'conversation-draft',
        projectId: 'project-draft',
        requestedTitle: 'broken.slides',
      }
    );

    expect(created).toMatchObject({
      type: 'create',
      buildStatus: 'draft',
      buildFailure: {
        code: 'slides.codegen.typecheck',
        draftSaved: true,
      },
    });
    expect(
      db.prepare('SELECT type, name FROM workspace_nodes WHERE id = ?').get(created.presentationId)
    ).toEqual({ type: 'presentation', name: 'broken.slides' });
    expect(
      db.prepare('SELECT deck_source FROM presentation_drafts WHERE node_id = ?')
        .get(created.presentationId)
    ).toEqual({ deck_source: source });
    expect(
      db.prepare('SELECT text FROM workspace_node_text_snapshots WHERE node_id = ?')
        .get(created.presentationId)
    ).toEqual({ text: source });
    await expect(coordinator.getDocumentBuildState(created.presentationId)).resolves.toMatchObject({
      state: 'draft',
      draftStatus: { errorKind: 'slides.codegen.typecheck' },
    });
    await expect(coordinator.getPreview(created.presentationId)).rejects.toThrow(
      'unresolved deck.js draft'
    );

    const fixedSource = [
      'const slide = createSlide();',
      'slide.add(createText("Fixed"));',
      'compose({ title: "Fixed", layout: "16x9", slides: [slide] });',
    ].join('\n');
    const repaired = await coordinator.getCodegenPresentationService().write(
      { presentation_id: created.presentationId, source: fixedSource },
      { conversationId: 'conversation-draft', projectId: 'project-draft' }
    );

    expect(repaired.buildStatus).toBe('ready');
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM presentation_drafts WHERE node_id = ?')
        .get(created.presentationId)
    ).toEqual({ count: 0 });
    expect(
      db.prepare('SELECT text FROM workspace_node_text_snapshots WHERE node_id = ?')
        .get(created.presentationId)
    ).toEqual({ text: fixedSource });
    await expect(coordinator.getDocumentBuildState(created.presentationId)).resolves.toMatchObject({
      state: 'ready',
      versionNumber: 2,
    });
    await expect(coordinator.getPreview(created.presentationId)).resolves.toMatchObject({
      title: 'Fixed',
      versionNumber: 2,
    });
  });

  it('首次 draft 持久化失败时回滚文件树可见性与 Slides 自有记录', async () => {
    db.prepare(
      `
      INSERT INTO projects (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `
    ).run('project-rollback', 'Rollback Project', 1, 1);
    db.exec(`
      CREATE TRIGGER reject_presentation_draft
      BEFORE INSERT ON presentation_drafts
      BEGIN
        SELECT RAISE(ABORT, 'forced draft failure');
      END;
    `);
    const coordinator = createPptCoordinator(db, {
      buildExecution: createInProcessPresentationBuildExecution(),
    });

    await expect(coordinator.getCodegenPresentationService().write(
      { source: 'interface Broken { x: number; }' },
      {
        conversationId: 'conversation-rollback',
        projectId: 'project-rollback',
        requestedTitle: 'rollback.slides',
      }
    )).rejects.toMatchObject({
      failure: {
        code: 'slides.persistence.draft_failed',
        draftSaved: false,
      },
    });

    expect(
      db.prepare('SELECT COUNT(*) AS count FROM workspace_nodes WHERE deleted_at IS NULL').get()
    ).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM presentation_documents').get())
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM presentation_revisions').get())
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM presentation_drafts').get())
      .toEqual({ count: 0 });
  });
});

function createTestDocumentImageAsset(assetId: string, bytes: Buffer): PluginDocumentImageAsset {
  return {
    assetId,
    mediaType: 'image/png',
    byteLength: bytes.byteLength,
    width: 1,
    height: 1,
    sha256: 'test-sha256',
    dataUri: `data:image/png;base64,${bytes.toString('base64')}`,
  };
}
