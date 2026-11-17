import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { startCustomCapabilityProtocolServer } from '../../../src/app-hosts/linnya/application/custom-api-onboarding/__tests__/fixtures/customCapabilityProtocolServer.ts';

// 运行：pnpm exec tsx scripts/e2e/custom-models/desktop.acceptance.mjs
// fixture只监听回环，所有文本/图/PDF为合成输入；这是正式协议模拟，不是供应商连通认证。
const fixture = await startCustomCapabilityProtocolServer();
const evidence = createEvidence('custom-capability-models', {
  files: [
    'scripts/e2e/custom-models/desktop.acceptance.mjs',
    'src/app-hosts/linnya/application/custom-api-onboarding/__tests__/fixtures/customCapabilityProtocolServer.ts',
    'src/app-hosts/linnya/application/custom-api-onboarding/orchestration/customCapabilityProtocol.integration.test.ts',
  ],
});
const test = acceptance(`custom-models-${process.pid}`, { evidence });
const { run } = test;
const prefix = '.add-model-provider-form[data-registration-kind="custom-capability"]';
const models = [
  {
    kind: '嵌入',
    format: 'openai_embeddings',
    path: '/v1',
    name: 'Embedding fixture',
    slot: 'embeddingModelSelect',
    purpose: 'embedding',
  },
  {
    kind: '重排',
    format: 'cohere_rerank',
    path: '/v2',
    name: 'Rerank fixture',
    slot: 'rerankModelSelect',
    purpose: 'rerank',
  },
  {
    kind: '文档识别（OCR）',
    format: 'paddle_layout_parsing',
    path: '/layout-parsing',
    name: 'OCR fixture',
    slot: 'pdfOcrModelSelect',
    purpose: 'pdf_ocr',
  },
  { kind: '文档识别（OCR）', format: 'paddle_ocr_jobs', path: '', name: 'OCR jobs fixture' },
  {
    kind: '图片生成',
    format: 'openai_images_generations',
    path: '/v1',
    name: 'Image fixture',
    slot: 'imageGenerationModelSelect',
    purpose: 'image_generation',
  },
];
const catalogExpression = `(await import('/apps/renderer/domains/model-configuration/features/model-catalog/infrastructure/httpModelCatalogGateway.ts')).httpModelCatalogGateway.load()`;
async function catalog() {
  return (await run('eval', `(async()=>${catalogExpression})()`)).value;
}
async function fill(label, value) {
  const selector = `${prefix} input[aria-label=${JSON.stringify(label)}]`;
  await run('click', '--selector', selector);
  await run('press', 'Meta+A');
  await run('type', value);
}
async function selectVisibleOption(name) {
  const points = (
    await run(
      'eval',
      `Array.from(document.querySelectorAll('.select-option')).filter(node => node.textContent.trim() === ${JSON.stringify(name)} && node.getClientRects().length).map(node => { const box = node.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })`
    )
  ).value;
  assert.equal(points.length, 1, `Expected one visible option for ${name}`);
  await run('click', '--at', `${Math.round(points[0].x)},${Math.round(points[0].y)}`);
}

async function startForm(model) {
  await run('click', 'text=添加模型');
  await run('scroll', '--selector', '.settings-modal-panel-body', '--dy=-10000');
  await run('click', 'text=自定义 API');
  await run('click', '--selector', '.custom-api-model-registration > .settings-row button');
  await run('click', `text=${model.kind}`);
  if (model.format === 'paddle_ocr_jobs') {
    await run('click', '--selector', `${prefix} .settings-row:first-child button`);
    await run('click', 'text=Paddle OCR Jobs');
  }
  await fill('连接名称', model.name);
  await fill('API 地址', fixture.baseUrl + model.path);
  await fill('API Key', 'fixture-key');
  await fill('模型 ID', model.format + '-fixture');
  await fill('自定义名称', model.name);
  await run('scroll', '--selector', '.settings-modal-panel-body', '--dy', '700');
}
let failed;
try {
  const up = await run('up', '--size', '1440x1100', '--mode', 'dev');
  evidence.json('candidate', {
    gitHead: up.gitHead,
    trackedDiff: execFileSync('git', ['diff', '--stat'], { encoding: 'utf8' }),
    build: up.build,
    protocol: 'official HTTP fixtures, no upstream provider',
  });
  await run('click', '--selector', '[data-linnya-tooltip="设置"]');
  await evidence.check('五类协议测试与保存分离，正式UI注册并由Host目录确认', async () => {
    for (const model of models) {
      await startForm(model);
      const before = (await catalog()).models.length;
      await run('click', 'text=测试调用');
      await run('wait', '--text', '配置尚未保存');
      assert.equal((await catalog()).models.length, before);
      await run('scroll', '--selector', '.settings-modal-panel-body', '--dy', '400');
      await run('click', '--selector', `${prefix} .add-model-submit button`);
      await run('wait', '--text', '模型已添加');
      const saved = (await catalog()).models.find(item => item.display_name === model.name);
      assert.ok(saved);
      model.id = saved.id;
      assert.equal(
        (
          await run(
            'eval',
            `document.querySelector(${JSON.stringify(prefix + ' input[aria-label="API Key"]')}).value`
          )
        ).value,
        ''
      );
      await run('shot', '--selector', '.model-registration-settings-page');
      await run('click', 'text=模型管理');
    }
    assert.deepEqual(
      fixture.requests.filter(request => request.method === 'POST').map(request => request.path),
      [
        '/v1/embeddings',
        '/v2/rerank',
        '/layout-parsing',
        '/api/v2/ocr/jobs',
        '/v1/images/generations',
      ]
    );
  });
  await evidence.check('手填模型不会刷新丢失，详情可重新编辑并保留能力和身份', async () => {
    const model = models[0];
    const picker = (
      await run(
        'eval',
        `(async()=> (await import('/apps/renderer/domains/model-configuration/features/model-picker/infrastructure/httpModelPickerGateway.ts')).httpModelPickerGateway.load())()`
      )
    ).value;
    const group = picker.custom_providers.find(item => item.provider_name === model.name);
    assert.ok(group);
    await run('click', '--selector', `[data-model-source-id=${JSON.stringify(group.provider_id)}]`);
    assert.equal(
      (await run('eval', `document.querySelector('.model-visibility-refresh-btn').disabled`)).value,
      true
    );
    await run('click', '--selector', `[data-model-id=${JSON.stringify(model.id)}]`);
    await run('wait', '--selector', '.model-details-content');
    assert.equal(
      (await run('eval', `document.querySelectorAll('.model-details-content input').length`)).value,
      2
    );
    const modelIdInput = '.model-details-content .form-row:nth-child(2) input';
    assert.equal(
      (await run('eval', `document.querySelector(${JSON.stringify(modelIdInput)}).value`)).value,
      model.format + '-fixture'
    );
    await run('click', '--selector', modelIdInput);
    await run('press', 'Meta+A');
    await run('type', 'embedding-v2');
    await run('click', 'text=保存并关闭');
    await run('wait', '--selector', '.model-details-content', '--state', 'detached');
    assert.equal(
      (await catalog()).models.find(item => item.id === model.id).embedding_route.endpoint_model_id,
      'embedding-v2'
    );
    await run('click', '--selector', `[data-model-id=${JSON.stringify(model.id)}]`);
    assert.equal(
      (await run('eval', `document.querySelector(${JSON.stringify(modelIdInput)}).value`)).value,
      'embedding-v2'
    );
    await run('shot', '--selector', '.model-details-content');
    await run('click', '--selector', '.modal-close');
    await run('click', '--selector', '.model-visibility-provider-edit');
    await run('wait', '--selector', '.provider-connection-edit-content');
    assert.ok(
      (
        await run(
          'eval',
          `Array.from(document.querySelectorAll('.provider-connection-edit-content input')).map(input=>input.value).join(' ')`
        )
      ).value.includes('OpenAI Embeddings')
    );
    await run('shot', '--selector', '.provider-connection-edit-content');
    await run('click', 'text=取消');
  });
  await evidence.check('四类用途仅选对应能力，绑定刷新后仍在', async () => {
    await run('click', 'text=模型配置');
    await run('scroll', '--selector', '.settings-modal-panel-body', '--dy', '800');
    for (const model of models.filter(item => item.slot)) {
      await run('click', '--selector', `#${model.slot}`);
      await selectVisibleOption(model.name);
      const selected = (
        await run(
          'eval',
          `(async()=> (await import('/apps/renderer/domains/model-configuration/features/purpose-model-bindings/orchestration/modelPurposeBindings.ts')).readSelectedModelPurposeBinding(${JSON.stringify(model.purpose)}))()`
        )
      ).value;
      assert.equal(selected, model.id);
    }
    await run('shot');
    await run('reload');
    await run('wait', '--selector', '[data-linnya-tooltip="设置"]');
    const saved = await catalog();
    for (const model of models) assert.ok(saved.models.some(item => item.id === model.id));
    for (const model of models.filter(item => item.slot)) {
      await run(
        'wait',
        '--expr',
        `(async()=> (await import('/apps/renderer/domains/model-configuration/features/purpose-model-bindings/orchestration/modelPurposeBindings.ts')).readSelectedModelPurposeBinding(${JSON.stringify(model.purpose)}) === ${JSON.stringify(model.id)})()`
      );
    }
  });
  await evidence.check('错误协议与主动取消保留草稿，不隐式保存', async () => {
    await run('click', '--selector', '[data-linnya-tooltip="设置"]');
    await startForm({ ...models[0], name: 'Rejected fixture' });
    const before = (await catalog()).models.length;
    fixture.setFailure('wrong_format');
    await run('click', 'text=测试调用');
    await run('wait', '--text', '接口格式');
    assert.equal((await catalog()).models.length, before);
    assert.equal(
      (
        await run(
          'eval',
          `document.querySelector(${JSON.stringify(prefix + ' input[aria-label="模型 ID"]')}).value`
        )
      ).value,
      models[0].format + '-fixture'
    );
    fixture.setFailure('none');
    fixture.setDelay(2000);
    const cancelledBefore = fixture.cancelledRequestCount;
    await run('click', 'text=测试调用');
    await run('click', 'text=取消测试');
    await run('wait', '--text', '测试已取消');
    for (
      let attempt = 0;
      attempt < 20 && fixture.cancelledRequestCount === cancelledBefore;
      attempt += 1
    )
      await delay(50);
    assert.equal(
      fixture.cancelledRequestCount,
      cancelledBefore + 1,
      'Cancel must abort the real provider HTTP response'
    );
    assert.equal((await catalog()).models.length, before);
    assert.equal(
      (
        await run(
          'eval',
          `document.querySelector(${JSON.stringify(prefix + ' input[aria-label="API Key"]')}).value`
        )
      ).value,
      'fixture-key'
    );
    fixture.setDelay(0);
    await run('click', 'text=模型管理');

    assert.equal((await catalog()).models.length, before);
  });
  evidence.json(
    'protocol-facts',
    fixture.requests.map(request => ({
      method: request.method,
      path: request.path,
      auth: request.headers.authorization ? request.headers.authorization.split(' ')[0] : 'none',
      contentType: request.headers['content-type'],
    }))
  );
  const logs = await run('logs', '--level', 'error');
  // 故意错误协议对应HTTP错误可被浏览器记为资源失败；其他Renderer错误仍由清单留证。
  evidence.json('renderer-errors', logs);
  assert.deepEqual(
    logs.entries.filter(
      entry =>
        !entry.text.includes('/api/v1/custom-api-onboarding/capabilities/test') ||
        !/(422|ERR_ABORTED)/.test(entry.text)
    ),
    []
  );
} catch (error) {
  failed = error;
  if (!evidence.data.checks.some(item => item.status === 'failed')) evidence.error(error);
  try {
    await run('shot');
  } catch (captureError) {
    evidence.error(captureError);
  }
} finally {
  try {
    evidence.json('cleanup', await test.finish({ clean: !failed }));
  } catch (error) {
    failed ??= error;
    evidence.error(error);
  }
  await fixture.close();
}
console.log(
  JSON.stringify({
    ok: !failed,
    ...evidence.finish(),
    ...(failed ? { error: failed.message } : {}),
  })
);
if (failed) process.exitCode = 1;
