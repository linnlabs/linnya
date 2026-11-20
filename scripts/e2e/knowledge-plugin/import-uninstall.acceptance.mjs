import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { startCustomCapabilityProtocolServer } from '../../../src/app-hosts/linnya/application/custom-api-onboarding/__tests__/fixtures/customCapabilityProtocolServer.ts';
import { MODEL_CONNECTION_TEST_PDF } from '../../../src/app-hosts/linnya/application/custom-api-onboarding/definitions/modelConnectionTestDocument.ts';

const scenario = process.argv[2];
assert.ok(['ingestion', 'ocr', 'graph', 'rebuild'].includes(scenario));
process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const evidence = createEvidence(`knowledge-import-uninstall-${scenario}`, {
  files: [
    'scripts/e2e/knowledge-plugin/import-uninstall.acceptance.mjs',
    'src/app-hosts/linnya/application/custom-api-onboarding/__tests__/fixtures/customCapabilityProtocolServer.ts',
  ],
});
const test = acceptance(`knowledge-import-uninstall-${scenario}-${process.pid}`, { evidence });
const { run } = test;
const service = await startCustomCapabilityProtocolServer();
const sidebar = '.sidebar-entry:has(svg[data-icon="library"])';
const modal = '.modal-overlay--alert';
let db;
let up;
let failed;

async function click(role, name, within) {
  const { entries } = await run(
    'snapshot',
    '--json',
    '--role',
    role,
    '--within',
    within,
    '--max-lines',
    '160'
  );
  const found = entries.filter(entry => entry.name === name);
  assert.equal(found.length, 1, `${role} ${name}`);
  await run('click', found[0].ref);
}

async function until(read, predicate, label) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(100);
  }
  assert.fail(label);
}

async function api(route, options) {
  const { value: session } = await run('eval', "window.electronAPI.invoke('api:get-port')");
  const response = await fetch(`http://127.0.0.1:${session.port}${route}`, {
    method: 'POST',
    headers: {
      'X-API-Token': session.token,
      ...(options.json ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.json ? JSON.stringify(options.json) : options.form,
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  assert.ok(response.ok, `${route}: ${JSON.stringify(result)}`);
  return result;
}

async function model(format, route, id, options = {}) {
  return (
    await api('/api/v1/custom-api-onboarding/capabilities/models', {
      json: {
        api_format: format,
        provider_name: id,
        base_url: `${service.baseUrl}${route}`,
        api_key: 'fixture-key',
        endpoint_model_id: id,
        ...options,
      },
    })
  ).model_id;
}

async function kb(channel, payload) {
  const { value } = await run(
    'eval',
    `window.electronAPI['plugin:invoke']('knowledge',${JSON.stringify(channel)},${JSON.stringify(payload)})`
  );
  assert.equal(value.success, true, JSON.stringify(value));
  return value.data;
}

try {
  up = await run('up', '--mode', 'bundled', '--size', '1440x1000', '--no-build');
  db = new DatabaseSync(up.workspaceDb, { readOnly: true });
  const embedding = await model('openai_embeddings', '/v1', 'E7 embedding');
  const form = new FormData();
  form.append('kbId', 'default');
  form.append('embedding_model_id', embedding);
  const target =
    scenario === 'ocr'
      ? '/layout-parsing'
      : scenario === 'graph'
        ? '/v1/chat/completions'
        : '/v1/embeddings';
  if (scenario === 'ocr') {
    const ocr = await model('paddle_layout_parsing', '/layout-parsing', 'E7 OCR', {
      ocr_mode: 'document_upload',
    });
    form.append('pdf_ocr_model_id', ocr);
    form.append('force_vision_mode', 'true');
    form.append(
      'file',
      new Blob([Buffer.from(MODEL_CONNECTION_TEST_PDF, 'base64')]),
      'pending.pdf'
    );
  } else {
    form.append('file', new Blob(['# Apple\n\nSynthetic orchard document.']), 'pending.md');
  }
  if (scenario === 'graph') {
    const vision = await api('/api/v1/custom-api-onboarding/models', {
      json: {
        api_format: 'openai_compatible',
        provider_name: 'E7 graph fixture',
        base_url: `${service.baseUrl}/v1`,
        api_key: 'fixture-key',
        endpoint_model_id: 'graph',
        context_window_tokens: 32_000,
        max_output_tokens: 4_000,
        supports_image_input: false,
      },
    });
    await kb('update-settings', { kbId: 'default', settings: { enableGraphIndexing: true } });
    form.append('graph_extraction_model_id', vision.model_id);
  }
  await evidence.check(`${scenario}: 卸载对在途后台任务有明确提示，重启后不再写回`, async () => {
    let requestCount = service.requests.length;
    if (scenario !== 'rebuild') service.setDelay(28_000, target);
    const { document } = await api('/api/v1/plugins/knowledge/documents/upload', { form });
    const row = () => db.prepare('SELECT id,status FROM kb_documents WHERE id=?').get(document.id);
    if (scenario === 'rebuild') {
      await until(row, item => item?.status === 'completed', 'Initial indexing did not finish');
      requestCount = service.requests.length;
      service.setDelay(28_000, target);
      await kb('rebuild-index', { kbId: 'default', modelId: embedding });
    }
    await until(
      () => service.requests.slice(requestCount),
      requests => requests.some(request => request.path === target),
      'Actual Worker never reached the held model call'
    );
    const before = row();
    const pendingImport = ['ingestion', 'ocr'].includes(scenario);
    assert.ok(
      (pendingImport ? ['pending', 'processing'] : ['completed']).includes(before?.status),
      JSON.stringify(before)
    );
    await click('button', '插件', 'aside');
    await click('heading', '知识库', 'main');
    await click('button', '卸载', 'main');
    await run('wait', '--selector', modal);
    const { value: confirmation } = await run(
      'eval',
      `({ text:document.querySelector('${modal}').innerText, dedicated:Boolean(document.querySelector('.plugin-store-uninstall-dialog')) })`
    );
    await run('shot');
    await click('button', confirmation.dedicated ? '卸载' : '确定', modal);
    await run('wait', '--selector', '.notification-content');
    const { value: notifications } = await run(
      'eval',
      "[...document.querySelectorAll('.notification-content')].map(n=>n.innerText)"
    );
    const installed = db
      .prepare("SELECT installed,user_removed FROM installed_plugins WHERE plugin_id='knowledge'")
      .get();
    const observed = {
      before,
      after: row(),
      installed,
      confirmation,
      notifications,
      cancelledRequestCount: service.cancelledRequestCount,
    };
    evidence.json('transition', observed);
    await run('shot');
    if (!installed.installed) {
      await run('wait', '--selector', sidebar, '--state', 'detached');
      await until(
        () => service.cancelledRequestCount,
        count => count > 0,
        'Actual model request was not cancelled'
      );
      assert.equal(
        row()?.status,
        pendingImport ? 'failed' : 'completed',
        'Uninstall must preserve committed documents and close cancelled imports'
      );
      const after = row();
      const settledRequestCount = service.requests.length;
      await run('stop');
      assert.equal(
        (await run('up', '--mode', 'bundled', '--size', '1440x1000', '--no-build')).workspaceDb,
        up.workspaceDb
      );
      assert.deepEqual(row(), after);
      await run('wait', '--selector', sidebar, '--state', 'detached');
      assert.equal(
        service.requests.length,
        settledRequestCount,
        'No background work should resume after restart'
      );
      await run('shot');
    }
    assert.match(
      confirmation.text,
      /后台任务.*取消/u,
      'The confirmation must tell the user that background work is cancelled'
    );
  });
} catch (error) {
  failed = error;
  if (!(error instanceof assert.AssertionError)) evidence.error(error);
} finally {
  if (failed && up) evidence.artifact(up.logs.desktop, 'desktop');
  db?.close();
  try {
    evidence.json('teardown', await test.finish({ clean: !failed }));
  } catch (error) {
    failed ??= error;
    evidence.error(error);
  }
  await service.close();
  console.log(JSON.stringify(evidence.finish()));
}
if (failed) throw failed;
