import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { log } from 'node:console';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const packageRoot = process.cwd();
const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'linnya-schemas-pack-'));
const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const languageRoute = {
  api_surface: 'openai_chat_completions',
  capability_id: 'ai-sdk:deepseek',
  endpoint_id: 'linnya-cloud',
  endpoint_model_id: 'deepseek-chat',
  base_url: 'https://api.example.test/proxy/deepseek-chat/',
  auth_profile: 'bearer',
  context_window_tokens: 64_000,
  max_output_tokens: 8_192,
  input_support: {
    user_image: true,
    tool_result_image: false,
  },
  usage: {
    response_usage: 'provider_reported_optional',
  },
  continuation: {
    tool_replay: 'required',
  },
};

const documentOcrRoute = {
  api_surface: 'paddle_ocr_jobs',
  capability_id: 'host:paddle-ocr-jobs',
  endpoint_id: 'linnya-cloud',
  endpoint_model_id: 'paddle-ocr',
  base_url: 'https://api.example.test/ocr/',
  auth_profile: 'bearer',
  mode: 'document_upload',
  supports_abort_signal: true,
  attempt_timeout_ms: 30_000,
  max_input_pages: 100,
  poll_interval_ms: 1_000,
};

function verifyCloudContractRuntime(label, modelInferenceRuntime, documentOcrRuntime) {
  const parsedLanguageRoute = modelInferenceRuntime.ModelInferenceRouteSchema.parse(languageRoute);
  assert.equal(
    parsedLanguageRoute.base_url,
    'https://api.example.test/proxy/deepseek-chat',
    `${label} 未执行 language route canonicalization`
  );
  assert.equal(
    modelInferenceRuntime.findLanguageInferenceRouteProfileForRoute(parsedLanguageRoute).id,
    'deepseek_chat',
    `${label} 未解析正式 language route profile`
  );

  const parsedDocumentOcrRoute = documentOcrRuntime.parseDocumentOcrRoute(documentOcrRoute);
  assert.equal(
    parsedDocumentOcrRoute.base_url,
    'https://api.example.test/ocr',
    `${label} 未执行 document OCR route canonicalization`
  );
}

try {
  execFileSync(pnpmExecutable, ['pack', '--pack-destination', temporaryDirectory], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
  const archives = readdirSync(temporaryDirectory).filter(file => file.endsWith('.tgz'));
  assert.equal(archives.length, 1, `预期生成一个 tarball，实际为 ${archives.length} 个`);

  execFileSync(
    'tar',
    ['-xzf', path.join(temporaryDirectory, archives[0]), '-C', temporaryDirectory],
    {
      stdio: 'inherit',
    }
  );
  const packedPackageRoot = path.join(temporaryDirectory, 'package');
  const packedManifest = JSON.parse(
    readFileSync(path.join(packedPackageRoot, 'package.json'), 'utf8')
  );
  assert.equal(packedManifest.private, true, 'Schemas 合同 artifact 必须保持禁止 npm 误发');
  assert.equal(packedManifest.license, 'Apache-2.0', 'Schemas artifact 必须声明 Apache-2.0');
  const packedLicensePath = path.join(packedPackageRoot, 'LICENSE');
  assert.equal(existsSync(packedLicensePath), true, 'Schemas artifact 必须携带 LICENSE');
  assert.equal(
    createHash('sha256').update(readFileSync(packedLicensePath)).digest('hex'),
    'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
    'Schemas artifact 必须携带未经改写的 Apache-2.0 官方正文'
  );
  assert.equal(
    packedManifest.publishConfig,
    undefined,
    'Schemas 合同 artifact 不得声明 npm 发布入口'
  );
  assert.equal(
    existsSync(path.join(packedPackageRoot, 'src')),
    false,
    'Schemas artifact 不得携带源码树'
  );
  const packedFiles = execFileSync('tar', ['-tzf', path.join(temporaryDirectory, archives[0])], {
    encoding: 'utf8',
  })
    .split(/\r?\n/u)
    .filter(Boolean);
  assert.equal(
    packedFiles.some(file => /\.(?:test|spec)\.(?:[cm]?js|d\.[cm]?ts)$/u.test(file)),
    false,
    'Schemas artifact 不得携带测试实现或测试声明'
  );

  for (const subpath of ['./model-inference', './document-ocr']) {
    const conditions = packedManifest.exports?.[subpath];
    assert.ok(conditions, `Schemas artifact 缺少 Cloud 合同子入口 ${subpath}`);
    for (const condition of ['types', 'import', 'require']) {
      const target = conditions[condition];
      assert.equal(typeof target, 'string', `${subpath} 缺少 ${condition} 导出`);
      assert.equal(
        existsSync(path.resolve(packedPackageRoot, target)),
        true,
        `${subpath} 的 ${condition} 产物不存在`
      );
    }
  }

  // packed artifact 的依赖声明由 lockfile 管理；smoke 只复用仓库已锁定安装结果，
  // 验证的重点是 tarball 内容、真实 package exports 与 CJS/ESM 运行时合同。
  symlinkSync(
    path.join(packageRoot, 'node_modules'),
    path.join(packedPackageRoot, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );

  const consumerRoot = path.join(temporaryDirectory, 'consumer');
  const consumerScopeRoot = path.join(consumerRoot, 'node_modules', '@app');
  mkdirSync(consumerScopeRoot, { recursive: true });
  symlinkSync(
    packedPackageRoot,
    path.join(consumerScopeRoot, 'schemas'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  const consumerRequire = createRequire(path.join(consumerRoot, 'consumer.cjs'));
  verifyCloudContractRuntime(
    'CJS packed artifact',
    consumerRequire('@app/schemas/model-inference'),
    consumerRequire('@app/schemas/document-ocr')
  );

  verifyCloudContractRuntime(
    'ESM packed artifact',
    await import(pathToFileURL(path.join(packedPackageRoot, 'dist/esm/model-inference/index.js'))),
    await import(pathToFileURL(path.join(packedPackageRoot, 'dist/esm/document-ocr/index.js')))
  );

  log(`schemas packed Cloud contract smoke passed: ${archives[0]}`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
