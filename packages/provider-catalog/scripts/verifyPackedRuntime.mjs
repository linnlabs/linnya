import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
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
const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'linnya-provider-catalog-pack-'));
const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function verifyRuntime(label, catalogRuntime, bindingRuntime) {
  const providers = catalogRuntime.providerCatalog.list();
  assert.ok(providers.length > 0, `${label} 没有公开 Provider`);
  assert.ok(
    providers.every(provider => provider.connections.length > 0),
    `${label} 包含没有可见 connection 的 Provider`
  );
  assert.equal(
    bindingRuntime.formalProviderRuntimeManifestRegistry.generation_id,
    catalogRuntime.providerCatalog.generation.id,
    `${label} public catalog 与 runtime binding 不属于同一 generation`
  );
  const openAiConnection = catalogRuntime.providerCatalog.getConnection('openai-api');
  assert.equal(openAiConnection?.provider.id, 'openai', `${label} 无法查询公开 connection`);
  assert.equal(
    bindingRuntime.formalProviderRuntimeManifestRegistry.get('openai-api')
      ?.provider_definition_id,
    'openai',
    `${label} 无法查询正式 runtime binding`
  );
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
  assert.equal(packedManifest.private, true, 'Provider Catalog 必须保持 workspace 私有包身份');

  // 打包制品只声明正式依赖；smoke 通过仓库已锁定依赖验证真实 Node 解析和入口格式。
  symlinkSync(
    path.join(packageRoot, 'node_modules'),
    path.join(packedPackageRoot, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );

  const esmCatalogRuntime = await import(
    pathToFileURL(path.join(packedPackageRoot, 'dist/index.js'))
  );
  const esmBindingRuntime = await import(
    pathToFileURL(path.join(packedPackageRoot, 'dist/runtime-bindings.js'))
  );
  verifyRuntime('ESM packed artifact', esmCatalogRuntime, esmBindingRuntime);

  const require = createRequire(import.meta.url);
  const cjsCatalogRuntime = require(path.join(packedPackageRoot, 'dist/index.cjs'));
  const cjsBindingRuntime = require(path.join(packedPackageRoot, 'dist/runtime-bindings.cjs'));
  verifyRuntime('CJS packed artifact', cjsCatalogRuntime, cjsBindingRuntime);

  console.log(`provider catalog packed runtime smoke passed: ${archives[0]}`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
