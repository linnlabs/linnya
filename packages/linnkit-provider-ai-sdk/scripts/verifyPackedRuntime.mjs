import { execFileSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const packageRoot = process.cwd();
const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'linnkit-provider-ai-sdk-pack-'));
const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function firstResponse(modelId) {
  return [
    {
      id: 'response-1',
      created: 1,
      model: modelId,
      choices: [
        {
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'call-1',
                function: { name: 'read_file', arguments: '{"path":"/tmp/a"}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'response-1',
      created: 1,
      model: modelId,
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    },
  ];
}

function secondResponse(modelId) {
  return [
    {
      id: 'response-2',
      created: 2,
      model: modelId,
      choices: [{ delta: { role: 'assistant', content: '读取完成。' }, finish_reason: null }],
    },
    {
      id: 'response-2',
      created: 2,
      model: modelId,
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 18, completion_tokens: 2, total_tokens: 20 },
    },
  ];
}

async function verifyRuntime(label, runtime, conformance) {
  assert.equal(typeof runtime.createAiSdkInferenceCapability, 'function');
  assert.equal(typeof runtime.createAiSdkLanguageModelRegistry, 'function');
  assert.equal(typeof conformance.runToolRoundTrip, 'function');

  const registry = runtime.createAiSdkLanguageModelRegistry();
  assert.equal(
    registry.entries.length,
    Object.values(runtime.AI_SDK_INFERENCE_CAPABILITY_IDS).length,
    `${label} registry capability 数量异常`
  );

  const modelId = 'deepseek-flash';
  const resolvedRoute = conformance.createDedicatedProviderConformanceRoute({
    capabilityId: 'ai-sdk:deepseek',
    surface: 'openai_chat_completions',
    authProfile: 'bearer',
    providerModelId: modelId,
  });
  const result = await conformance.runToolRoundTrip({
    resolvedRoute,
    firstResponse: firstResponse(modelId),
    secondResponse: secondResponse(modelId),
    initialMessages: [{
      role: 'user',
      content: [
        { type: 'text', text: '比较用户与工具图片。' },
        { type: 'image', media_type: 'image/png', bytes: Uint8Array.from([1, 2, 3]) },
      ],
    }],
    toolResultContent: [
      { type: 'text', text: '工具图片。' },
      { type: 'image', media_type: 'image/png', bytes: Uint8Array.from([4, 5, 6]) },
    ],
  });

  assert.equal(result.requests.length, 2, `${label} 没有完成两轮 Provider 请求`);
  assert.equal(result.replay.at(-1)?.type, 'tool_call', `${label} 没有保留工具调用回放`);
  assert.deepEqual(result.secondEvents.at(-1), { type: 'finish', reason: 'stop' });
  // Packed 入口必须解析到 frozen patch 后的 SDK；仅版本号正确不代表工具图片没有退回字符串。
  assert.deepEqual(result.requests[1].body.messages, [
    { role: 'user', content: [
      { type: 'text', text: '比较用户与工具图片。' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
    ] },
    {
      role: 'assistant',
      content: '',
      reasoning_content: '',
      tool_calls: [{ id: 'call-1', type: 'function', function: {
        name: 'read_file', arguments: '{"path":"/tmp/a"}',
      } }],
    },
    { role: 'tool', tool_call_id: 'call-1', content: [
      { type: 'text', text: '工具图片。' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,BAUG' } },
    ] },
  ]);
}

try {
  execFileSync(pnpmExecutable, ['pack', '--pack-destination', temporaryDirectory], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
  const archives = readdirSync(temporaryDirectory).filter(file => file.endsWith('.tgz'));
  assert.equal(archives.length, 1, `预期生成一个 tarball，实际为 ${archives.length} 个`);

  execFileSync('tar', ['-xzf', path.join(temporaryDirectory, archives[0]), '-C', temporaryDirectory], {
    stdio: 'inherit',
  });
  const packedPackageRoot = path.join(temporaryDirectory, 'package');
  const packedManifest = JSON.parse(
    readFileSync(path.join(packedPackageRoot, 'package.json'), 'utf8')
  );
  assert.equal(packedManifest.private, true, '内部制品必须保留 private 标记');
  assert.equal(packedManifest.license, 'MIT', '打包制品缺少 MIT license 声明');
  assert.equal(packedManifest.engines?.node, '>=22', '打包制品 Node engines 与上游不一致');
  assert.equal(packedManifest.publishConfig, undefined, '内部制品不得携带 npm 发布配置');
  assert.equal(
    existsSync(path.join(packedPackageRoot, 'LICENSE')),
    true,
    '打包制品缺少 LICENSE 文件'
  );
  symlinkSync(
    path.join(packageRoot, 'node_modules'),
    path.join(packedPackageRoot, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );

  const esmRuntime = await import(pathToFileURL(path.join(packedPackageRoot, 'dist/index.js')));
  const esmConformance = await import(
    pathToFileURL(path.join(packedPackageRoot, 'dist/conformance.js'))
  );
  await verifyRuntime('ESM packed artifact', esmRuntime, esmConformance);

  const require = createRequire(import.meta.url);
  const cjsRuntime = require(path.join(packedPackageRoot, 'dist/index.cjs'));
  const cjsConformance = require(path.join(packedPackageRoot, 'dist/conformance.cjs'));
  await verifyRuntime('CJS packed artifact', cjsRuntime, cjsConformance);

  console.log(`provider adapter packed runtime smoke passed: ${archives[0]}`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
