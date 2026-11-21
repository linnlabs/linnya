import assert from 'node:assert/strict';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { startCustomCapabilityProtocolServer } from '../../../../src/app-hosts/linnya/application/custom-api-onboarding/__tests__/fixtures/customCapabilityProtocolServer.ts';
import { MODEL_CONNECTION_TEST_PDF } from '../../../../src/app-hosts/linnya/application/custom-api-onboarding/definitions/modelConnectionTestDocument.ts';
import { createStaticBmp } from '../../../../src/features/parsers/testkit/createStaticBmp.ts';
import { launchInstalledDesktop, until } from './installedDesktopSession.mjs';
import { verifyWindowsPluginData } from './windowsPluginDataScenario.mjs';

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
async function collectQdrantLog(filename) {
  if (!application) return;
  try {
    const bytes = await readFile(path.join(application.workspace, 'Plugins', 'knowledge', 'qdrant', 'logs', 'qdrant.log'));
    await writeFile(path.join(evidence, filename), bytes);
  } catch (error) {
    details.qdrantLogError = error.message;
  }
}
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
    async () => {
      // 无正文的失败资料可能被正式清理；读取保留的任务结果，不能等不存在的文档超时掩盖根因。
      const statuses = await application.plugin('task-status', { docIds: [id] });
      const status = statuses[id];
      assert.notEqual(status?.status, 'failed', `${name}: ${status?.error ?? status?.message}`);
      return docs();
    },
    values => values.some(doc => doc.id === id && ['completed', 'failed'].includes(doc.status)),
    `Ingestion: ${name}`,
    180_000
  );
  const doc = completed.find(item => item.id === id);
  assert.equal(doc.status, 'completed', `${name}: ${doc.errorMessage}`);
  assert.equal(doc.hasSource, true);
  return doc;
};
const search = documentId =>
  application.plugin('search', {
    kbId,
    request: {
      query: 'apple',
      ...(documentId ? { filter: { docIds: [documentId] } } : {}),
      useReranking: true,
      embeddingModelId: embeddingId,
      rerankModelId: rerankId,
    },
  });
const sourcePath = id =>
  path.join(application.workspace, 'Plugins', 'knowledge', 'source_of_truth', `${id}.source.json`);
const originalsPath = (...entries) =>
  path.join(application.workspace, 'Plugins', 'knowledge', 'originals', ...entries);
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
  await check('全新 Windows 安装默认不装知识库，能在插件市场从随包安装', async () => {
    const listing = await application.evaluate('window.electronAPI.plugins.list()');
    assert.equal(listing.success, true);
    assert.equal(listing.data.find(plugin => plugin.meta.id === 'knowledge')?.state, 'missing');
    const entries = await application.evaluate('window.electronAPI.plugins.rendererEntries()');
    assert.ok(entries.data.every(entry => entry.pluginId !== 'knowledge'));
    // 空 profile 的默认项目会在 Backend 就绪后异步创建。等项目首页落定再操作，
    // 避免启动导航接管页面时把市场入口的第一次点击覆盖掉。
    await until(
      () => application.evaluate(`Boolean(document.querySelector('.sidebar-project-list')?.innerText.includes('默认项目') && document.querySelector('.ai-assistant-input'))`),
      Boolean,
      'First project homepage',
    );
    await application.clickText('插件');
    await application.clickElement(`Array.from(document.querySelectorAll('main [role="tab"]')).find(tab=>tab.firstElementChild?.textContent.trim()==='插件市场')`);
    await application.screenshot(path.join(evidence, 'knowledge-not-installed.png'));
    await application.clickElement(`Array.from(document.querySelectorAll('.plugin-store-card')).find(card=>card.querySelector('h2')?.textContent==='知识库')?.querySelector('button.plugin-store-install-button')`);
    await until(
      () => application.evaluate('window.electronAPI.plugins.rendererEntries()'),
      result => result.data?.some(entry => entry.pluginId === 'knowledge'),
      'Knowledge market installation',
      30_000,
    );
  });
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
          display_name: `Windows ${format}`,
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
  // 实际用户在当前已打开页面创建；直接 IPC 造库不会执行 Renderer 创建用例的目录刷新。
  await application.clickText('新建知识库');
  await application.clickElement('document.querySelector("#new-kb-name")');
  await application.typeText(kbName);
  await application.clickText('创建');
  await until(
    () => application.evaluate('Boolean(document.querySelector("#new-kb-name"))'),
    value => !value,
    'Creation dialog closes'
  );
  const created = (await application.plugin('list')).find(item => item.name === kbName);
  assert.ok(created, 'Actual create dialog persists a library identity');
  kbId = created.id;
  await application.screenshot(path.join(evidence, 'created-library.png'));
  await application.plugin('update-settings', {
    kbId,
    settings: { embeddingModelId: embeddingId, rerankModelId: rerankId, enableGraphIndexing: true },
  });
  database = new DatabaseSync(path.join(application.workspace, 'workspace/workspace.sqlite'), {
    readOnly: true,
  });
  await check('Windows Qdrant 监听端口被占用：上传提示原因并引导停启', async () => {
    const occupied = createServer(socket => socket.destroy());
    // 只绑定隔离虚拟机的产品监听地址；如果不是我们持有该端口，立即退出，不动现有进程。
    await new Promise((resolve, reject) => {
      occupied.once('error', reject);
      occupied.listen({ host: '127.0.0.1', port: 6333, exclusive: true }, resolve);
    });
    const filename = 'occupied-qdrant-port.md';
    try {
      await application.clickElement('document.querySelector(\'[data-linnya-tooltip="设置"]\')');
      await application.clickText('模型配置');
      await application.clickElement('document.querySelector("#embeddingModelSelect")');
      await application.clickElement(`Array.from(document.querySelectorAll('.select-option')).find(el=>el.textContent.trim()==='Windows openai_embeddings' && el.getClientRects().length)`);
      await application.clickElement('document.querySelector(".settings-modal-close")');
      await application.clickText(kbName);
      await until(() => application.evaluate(`Boolean(document.querySelector('.upload-tab input[type="file"]'))`), Boolean, 'File upload is the new library default tab');
      assert.equal(await application.evaluate(`(() => {
        const input = document.querySelector('.upload-tab input[type="file"]');
        if (!input) return false;
        const transfer = new DataTransfer();
        transfer.items.add(new File(['# Synthetic port check\nApple orchard.'], ${json(filename)}, { type: 'text/markdown' }));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`), true);
      await application.clickText('开始解析');
      const message = await until(
        () => application.evaluate(`document.querySelector('.upload-tab:has(.status-failed)')?.innerText ?? ''`),
        Boolean,
        'Upload visibly failed after the Qdrant bind conflict',
        60_000,
      );
      await application.screenshot(path.join(evidence, 'qdrant-occupied-port.png'));
      await collectQdrantLog('qdrant-occupied-port.log');
      details.portConflict = { message, listener: occupied.address() };
      assert.match(message, /向量服务.*未能启动.*重新启用/u);
      assert.ok(!message.includes(root));
      assert.match(await readFile(path.join(evidence, 'qdrant-occupied-port.log'), 'utf8'), /10048|address.+in use|only one usage/iu);
    } finally {
      await new Promise((resolve, reject) => occupied.close(error => error ? reject(error) : resolve()));
    }
    await application.clickText('插件');
    const toggle = `document.querySelector('.switch-control:has(input[aria-label="知识库 启用状态"])')`;
    await application.clickElement(toggle);
    await until(() => application.evaluate(`${toggle}?.querySelector('input').checked`), value => value === false, 'Disabled after port conflict');
    await application.clickElement(toggle);
    await until(() => application.evaluate(`${toggle}?.querySelector('input').checked`), value => value === true, 'Reenabled after port conflict');
    assert.equal((await docs()).some(document => document.filename === filename && document.status === 'completed'), false);
    await application.screenshot(path.join(evidence, 'qdrant-occupied-port-reenabled.png'));
    // 下一项的真实摄入和图谱检索必须在同一个 App、同一个库中成功，证明不仅是按钮状态恢复。
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
      await stat(originalsPath(kbId, `${pdf.id}.pdf`));
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
    // 持久性要求指定原文仍能检索，不要求 7 份同词资料中的某一份始终排在默认前 5。
    const restoredSearch = await search(graphDocument.id);
    details.searchAfterRestart = restoredSearch;
    assert.ok(restoredSearch.results.some(result => result.docId === graphDocument.id));
  });
  const retainedLibrary = kbId;
  await check('正常删除知识库清理真实SQLite、原文和PDF', async () => {
    // 单库删除走独立样本；后面的插件卸载仍要面对拥有七份原资料和图谱索引的真实库。
    const disposable = await application.plugin('create', {
      name: 'Windows individual library deletion',
    });
    kbId = disposable.id;
    await upload('delete-this.pdf', Buffer.from(MODEL_CONNECTION_TEST_PDF, 'base64'), {
      pdf_ocr_model_id: ocrId,
      force_vision_mode: 'true',
    });
    const before = await docs();
    try {
      await application.plugin('delete', { kbId });
    } catch (error) {
      // 不重跑删除。先从独立连接检查 Qdrant 是否还活着、集合是否还在，区分
      // 服务未响应与删除已生效但响应丢失；同时保全本次隔离库的原文与元数据证据。
      const probe = async route => {
        try {
          const response = await fetch(`http://127.0.0.1:6333${route}`, {
            signal: AbortSignal.timeout(8000),
          });
          await response.text();
          return { route, status: response.status };
        } catch (failure) {
          return { route, error: failure.message, cause: String(failure.cause ?? '') };
        }
      };
      details.individualDeletionFailure = {
        metadataRows: database.prepare('SELECT count(*) AS count FROM kb_documents WHERE kb_id=?').get(kbId).count,
        sources: await Promise.allSettled(before.map(document => stat(sourcePath(document.id)).then(info => info.size))),
        qdrant: await Promise.all([probe('/readyz'), probe(`/collections/${encodeURIComponent(kbId)}`)]),
      };
      await collectQdrantLog('qdrant-after-library-delete-failure.log');
      throw error;
    }
    assert.equal(await application.plugin('get', { kbId }), null);
    assert.equal(
      database.prepare('SELECT count(*) AS count FROM kb_documents WHERE kb_id=?').get(kbId).count,
      0
    );
    for (const document of before)
      await assert.rejects(stat(sourcePath(document.id)), { code: 'ENOENT' });
    await assert.rejects(stat(originalsPath(kbId)), {
      code: 'ENOENT',
    });
    details.deletedDocuments = before.map(document => document.id);
  }).catch(error => {
    // 失败原样保留为红；后续插件生命周期使用另外一个隔离知识库独立验收。
    failed = error;
  }).finally(() => {
    kbId = retainedLibrary;
  });
  details.pluginLifecycle = {};
  await verifyWindowsPluginData({
    application,
    database,
    evidence,
    check,
    library: {
      id: kbId,
      documentIds: (await docs()).map(document => document.id),
      searchDocumentId: graphDocument.id,
    },
    search,
    embeddingCalls: () =>
      fixture.requests.filter(request => request.path === '/v1/embeddings').length,
    observations: details.pluginLifecycle,
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
  failed ??= error;
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
    if (failed) await collectQdrantLog('qdrant.log');
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
