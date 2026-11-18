import assert from 'node:assert/strict';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startCustomCapabilityProtocolServer } from '../../../../src/app-hosts/linnya/application/custom-api-onboarding/__tests__/fixtures/customCapabilityProtocolServer.ts';
import { MODEL_CONNECTION_TEST_PDF } from '../../../../src/app-hosts/linnya/application/custom-api-onboarding/definitions/modelConnectionTestDocument.ts';
import { createStaticBmp } from '../../../../src/features/parsers/testkit/createStaticBmp.ts';
import { launchInstalledDesktop, until } from './installedDesktopSession.mjs';

assert.equal(process.platform, 'win32');
const root = path.resolve(process.argv[2]);
const unpacked = path.join(root, 'win-unpacked');
const evidence = path.join(root, 'evidence');
await mkdir(evidence, { recursive: true });
const fixture = await startCustomCapabilityProtocolServer();
const checks = [];
const details = {};
let application;
let database;
let failed;
const check = async (name, action) => {
  try {
    await action();
    checks.push({ name, status: 'passed' });
  } catch (error) {
    checks.push({ name, status: 'failed', error: error.stack });
    throw error;
  }
};
const json = JSON.stringify;
const kbName = 'Windows plugin synthetic orchard';
let kbId;
let embeddingId;
let rerankId;
let visionId;
let ocrId;
let graphDocument;
const docs = () => application.plugin('list-documents', { kbId });
const upload = async (name, bytes, extra = {}) => {
  const form = new FormData();
  form.append('kbId', kbId);
  form.append('embedding_model_id', embeddingId);
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  form.append('file', new Blob([bytes]), name);
  const response = await application.api('/api/v1/plugins/knowledge/documents/upload', {
    method: 'POST',
    body: form,
  });
  const id = response.document.id;
  const completed = await until(
    docs,
    values => values.some(doc => doc.id === id && ['completed', 'failed'].includes(doc.status)),
    `Ingestion: ${name}`,
    180_000
  );
  const doc = completed.find(item => item.id === id);
  assert.equal(doc.status, 'completed', `${name}: ${doc.errorMessage}`);
  assert.equal(doc.hasSource, true);
  return doc;
};
const search = () =>
  application.plugin('search', {
    kbId,
    request: {
      query: 'apple',
      useReranking: true,
      embeddingModelId: embeddingId,
      rerankModelId: rerankId,
    },
  });
const sourcePath = id =>
  path.join(application.workspace, 'KnowledgeBase/source_of_truth', `${id}.source.json`);
try {
  const candidate = JSON.parse(await readFile(path.join(root, 'candidate.json'), 'utf8'));
  details.candidate = candidate;
  await check('正式Windows未签名收尾验证App、微软CRT、Node及原生运行时', async () => {
    const require = createRequire(import.meta.url);
    for (const item of candidate.unsignedFinalization.files) {
      const bytes = await readFile(path.join(root, 'finalization', item.file));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
    }
    const { createAfterSignRuntimeAssetsHook } = require(
      path.join(root, 'finalization/build/after-sign-runtime-assets.cjs')
    );
    // 真实 Windows 检查器与正式未签名策略；不注入验签替身，不手写 signature_evidence。
    const hook = createAfterSignRuntimeAssetsHook({
      environment: { LINNYA_WINDOWS_COMMAND_RUNTIME_BUILD_TRUST: 'release_unsigned' },
    });
    await hook({
      electronPlatformName: 'win32',
      appOutDir: unpacked,
      packager: {
        appInfo: { version: candidate.version, productFilename: 'Linnya Knowledge Acceptance' },
      },
    });
    const manifest = JSON.parse(
      await readFile(
        path.join(
          unpacked,
          'resources/command-runtime/windows/x64/linnyaCommandProcessOwner.manifest.json'
        ),
        'utf8'
      )
    );
    assert.deepEqual(manifest.signature_evidence, { kind: 'release_unsigned' });
    details.unsignedRuntimeManifest = manifest;
    await writeFile(path.join(evidence, 'unsigned-runtime.json'), json(manifest));
  });
  application = await launchInstalledDesktop(
    path.join(unpacked, 'Linnya Knowledge Acceptance.exe'),
    path.join(root, 'session')
  );
  details.appProcessId = application.child.pid;
  await check('真正Windows App加载随包knowledge artifact和固定页面入口', async () => {
    const listing = await application.evaluate('window.electronAPI.plugins.list()');
    assert.equal(listing.success, true);
    assert.equal(listing.data.find(plugin => plugin.meta.id === 'knowledge')?.state, 'enabled');
    const entries = await application.evaluate('window.electronAPI.plugins.rendererEntries()');
    const entry = entries.data.find(item => item.pluginId === 'knowledge');
    assert.equal(entry.applicationSurfaceSlot, 'knowledge-base');
    assert.equal(entry.sourceKind, 'active');
    assert.ok(entry.pluginDir.startsWith(path.join(root, 'session')));
    await application.plugin('list');
    assert.equal(application.log.includes('[QdrantManager] Starting'), false);
    await application.clickText('知识库');
    await application.screenshot(path.join(evidence, 'knowledge-list.png'));
  });
  const base = '/api/v1/custom-api-onboarding';
  async function capability(format, suffix, endpoint) {
    return (
      await application.api(`${base}/capabilities/models`, {
        method: 'POST',
        json: {
          api_format: format,
          provider_name: `Windows ${format}`,
          base_url: `${fixture.baseUrl}${suffix}`,
          api_key: 'fixture-key',
          endpoint_model_id: endpoint,
          ...(format.startsWith('paddle') ? { ocr_mode: 'document_upload' } : {}),
        },
      })
    ).model_id;
  }
  embeddingId = await capability('openai_embeddings', '/v1', 'windows-embedding');
  rerankId = await capability('cohere_rerank', '/v2', 'windows-rerank');
  ocrId = await capability('paddle_layout_parsing', '/layout-parsing', 'windows-ocr');
  visionId = (
    await application.api(`${base}/models`, {
      method: 'POST',
      json: {
        api_format: 'openai_compatible',
        provider_name: 'Windows vision and graph',
        base_url: `${fixture.baseUrl}/v1`,
        api_key: 'fixture-key',
        endpoint_model_id: 'windows-vision',
        supports_image_input: true,
        context_window_tokens: 32000,
        max_output_tokens: 4000,
      },
    })
  ).model_id;
  kbId = (await application.plugin('create', { name: kbName })).id;
  await application.plugin('update-settings', {
    kbId,
    settings: { embeddingModelId: embeddingId, rerankModelId: rerankId, enableGraphIndexing: true },
  });
  database = new DatabaseSync(path.join(application.workspace, 'workspace/workspace.sqlite'), {
    readOnly: true,
  });
  fixture.setChatResponse(request => {
    const text = request.messages
      .map(message =>
        typeof message.content === 'string'
          ? message.content
          : message.content
              .filter(block => block.type === 'text')
              .map(block => block.text)
              .join('\n')
      )
      .join('\n');
    const chunks = [
      ...text.matchAll(/--- Chunk Start \(chunk_id: ([^)]+)\) ---\n([\s\S]*?)\n--- Chunk End ---/g),
    ];
    if (!chunks.length) return 'Synthetic apple image description';
    return json(
      chunks.map(match => ({
        chunk_id: match[1],
        entities: [
          { name: 'Apple', type: 'fruit' },
          { name: 'Orchard', type: 'place' },
        ],
        edges: [
          {
            source: 'Apple',
            target: 'Orchard',
            relation_type: 'LOCATED_AT',
            evidence_quote: 'Apple grows in the Orchard.',
            confidence: 1,
          },
        ],
      }))
    );
  });
  await check('真实摄入/图谱抽取/图谱索引三类Worker及SQLite、Qdrant、Jieba闭环', async () => {
    graphDocument = await upload(
      'apple.md',
      Buffer.from('# Apple orchard\n\nApple grows in the Orchard. 苹果在果园里生长。'),
      { graph_extraction_model_id: visionId }
    );
    const state = await until(
      () =>
        database
          .prepare('SELECT * FROM knowledge_graph_vector_doc_status WHERE kb_id=? AND doc_id=?')
          .get(kbId, graphDocument.id),
      value => value && ['completed', 'failed'].includes(value.status),
      'Graph indexing',
      180_000
    );
    assert.equal(state.status, 'completed', state.error_message);
    assert.ok(state.node_count > 0 && state.edge_count > 0);
    const found = await search();
    assert.ok(found.results.some(result => result.docId === graphDocument.id));
    assert.ok(fixture.requests.some(request => request.path === '/v2/rerank'));
    details.graph = state;
  });
  await application.plugin('update-settings', { kbId, settings: { enableGraphIndexing: false } });
  await check(
    '安装目录Worker真实加载PDF ESM、PNG/JPEG/WebP、GIF/BMP转换依赖和Paddle协议',
    async () => {
      const images = JSON.parse(await readFile(path.join(root, 'images.json'), 'utf8'));
      for (const [format, bytes] of Object.entries(images))
        await upload(`apple.${format}`, Buffer.from(bytes, 'base64'), {
          image_vision_model_id: visionId,
        });
      await upload('apple.bmp', createStaticBmp(), { image_vision_model_id: visionId });
      const pdf = await upload('apple.pdf', Buffer.from(MODEL_CONNECTION_TEST_PDF, 'base64'), {
        pdf_ocr_model_id: ocrId,
        force_vision_mode: 'true',
      });
      await stat(
        path.join(application.workspace, 'KnowledgeBase/originals', kbId, `${pdf.id}.pdf`)
      );
      assert.ok(fixture.requests.some(request => request.path === '/layout-parsing'));
      details.documents = await docs();
    }
  );
  await check('真实页面查看已保存内容，关闭后停用撤销入口，重启插件保留资料', async () => {
    await application.clickText('知识库');
    await until(
      () =>
        application.evaluate(
          `Boolean([...document.querySelectorAll('.card-title')].find(e=>e.textContent.trim()===${json(kbName)}))`
        ),
      Boolean,
      'Knowledge card'
    );
    await application.clickText(kbName);
    await application.clickText('文件管理');
    await until(
      () => application.evaluate('document.body.textContent.includes("apple.md")'),
      Boolean,
      'Managed documents'
    );
    await application.clickElement(
      '[...document.querySelectorAll(".file-item")].find(e=>e.querySelector(".file-name")?.textContent==="apple.md")?.querySelector(".col-actions button")'
    );
    await until(
      () =>
        application.evaluate('document.body.textContent.includes("Apple grows in the Orchard.")'),
      Boolean,
      'Saved content view'
    );
    await application.screenshot(path.join(evidence, 'saved-content.png'));
    const saved = await application.plugin('read-saved-content', {
      kbId,
      documentId: graphDocument.id,
    });
    assert.ok(saved.markdown.includes('Apple grows in the Orchard.'));
    const disabled = await application.evaluate(
      'window.electronAPI.plugins.setEnabled("knowledge",false)'
    );
    assert.equal(disabled.success, true, JSON.stringify(disabled));
    await until(
      () => application.evaluate('window.electronAPI.plugins.rendererEntries()'),
      result => !result.data.some(entry => entry.pluginId === 'knowledge'),
      'Disabled renderer entry'
    );
    await until(
      () =>
        application.evaluate('document.body.textContent.includes("Apple grows in the Orchard.")'),
      value => !value,
      'Saved content modal revoked'
    );
    await application.screenshot(path.join(evidence, 'disabled.png'));
    assert.equal(
      (await application.evaluate('window.electronAPI.plugins.setEnabled("knowledge",true)'))
        .success,
      true
    );
    assert.ok((await docs()).some(doc => doc.id === graphDocument.id));
    assert.ok((await search()).results.some(result => result.docId === graphDocument.id));
  });
  await check('正常删除知识库清理真实SQLite、原文和PDF', async () => {
    const before = await docs();
    await application.plugin('delete', { kbId });
    assert.equal(await application.plugin('get', { kbId }), null);
    assert.equal(
      database.prepare('SELECT count(*) AS count FROM kb_documents WHERE kb_id=?').get(kbId).count,
      0
    );
    for (const document of before)
      await assert.rejects(stat(sourcePath(document.id)), { code: 'ENOENT' });
    await assert.rejects(stat(path.join(application.workspace, 'KnowledgeBase/originals', kbId)), {
      code: 'ENOENT',
    });
    details.deletedDocuments = before.map(document => document.id);
  });
  assert.deepEqual(application.errors, []);
  details.protocol = fixture.requests.map(request => ({
    method: request.method,
    path: request.path,
  }));
  details.runtime = {
    node: process.version,
    architecture: process.arch,
    platform: process.platform,
  };
} catch (error) {
  failed = error;
  try {
    if (application) {
      details.rendererLoader = await application.evaluate(
        'globalThis.__LINNYA_RENDERER_PLUGIN_LOADER_DIAGNOSTICS__'
      );
    }
    await application?.screenshot(path.join(evidence, 'failure.png'));
  } catch {
    /* 原始失败仍写入结果，截图失败不覆盖它。 */
  }
} finally {
  database?.close();
  if (application) {
    try {
      await application.stop();
    } catch (error) {
      failed ??= error;
    }
    await writeFile(path.join(evidence, 'desktop.log'), application.log);
  }
  await fixture.close();
  await writeFile(
    path.join(root, 'result.json'),
    json({ success: !failed, checks, details, error: failed?.stack })
  );
}
if (failed) {
  console.error(failed);
  process.exitCode = 1;
}
