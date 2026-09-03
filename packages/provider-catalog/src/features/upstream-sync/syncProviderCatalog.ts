import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderCatalogSnapshot } from '../../definitions/providerCatalog';
import {
  generateProviderCatalog,
  MODELS_DEV_SOURCE_URL,
  PROVIDER_CATALOG_POLICY_VERSION,
} from '../catalog-generation/generateProviderCatalog';
import { assertProviderCatalogProjectionConsistency } from '../catalog-generation/assertProviderCatalogProjectionConsistency';
import { ModelsDevSourceSchema } from '../catalog-admission/definitions/modelsDevSource';
import { parseProviderCatalogSnapshot } from '../catalog-admission/parseProviderCatalogSnapshot';
import { describeProviderCatalogDiff } from './describeProviderCatalogDiff';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../../..');
const publicCatalogPath = path.join(
  repositoryRoot,
  'src/generated/provider-catalog.generated.json'
);
const runtimeBindingPath = path.join(
  repositoryRoot,
  'src/generated/provider-runtime-bindings.generated.json'
);

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readOptionalJson(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function hasCurrentProjectionSchema(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schema_version' in value &&
    value.schema_version === 2
  );
}

export interface SyncProviderCatalogOptions {
  readonly mode?: 'write' | 'check';
}

async function replaceGeneratedAssets(
  publicCatalog: ProviderCatalogSnapshot,
  runtimeBindings: unknown
): Promise<void> {
  const transactionId = `${process.pid}-${randomUUID()}`;
  const stagedPublicPath = `${publicCatalogPath}.${transactionId}.tmp`;
  const stagedRuntimePath = `${runtimeBindingPath}.${transactionId}.tmp`;

  try {
    await Promise.all([
      writeFile(stagedPublicPath, stableJson(publicCatalog), 'utf8'),
      writeFile(stagedRuntimePath, stableJson(runtimeBindings), 'utf8'),
    ]);
    const [stagedPublic, stagedRuntime] = await Promise.all([
      readOptionalJson(stagedPublicPath),
      readOptionalJson(stagedRuntimePath),
    ]);
    assertProviderCatalogProjectionConsistency(stagedPublic, stagedRuntime);
    await rename(stagedPublicPath, publicCatalogPath);
    await rename(stagedRuntimePath, runtimeBindingPath);
  } finally {
    await Promise.all([
      rm(stagedPublicPath, { force: true }),
      rm(stagedRuntimePath, { force: true }),
    ]);
  }
}

export async function syncProviderCatalog(
  options: SyncProviderCatalogOptions = {}
): Promise<string> {
  const mode = options.mode ?? 'write';
  const response = await fetch(MODELS_DEV_SOURCE_URL);
  if (!response.ok) {
    throw new Error(`models.dev 下载失败: HTTP ${response.status}`);
  }
  const rawSource = await response.text();
  const sourceSha256 = createHash('sha256').update(rawSource).digest('hex');
  const previousPublicInput = await readOptionalJson(publicCatalogPath);
  const previousRuntime = await readOptionalJson(runtimeBindingPath);
  if (previousPublicInput === undefined || previousRuntime === undefined) {
    throw new Error(
      'Provider Catalog 生成资产不完整，public catalog 与 runtime binding 必须同时存在'
    );
  }
  const hasCurrentPreviousProjection =
    hasCurrentProjectionSchema(previousPublicInput) && hasCurrentProjectionSchema(previousRuntime);
  if (hasCurrentPreviousProjection) {
    assertProviderCatalogProjectionConsistency(previousPublicInput, previousRuntime);
  }
  // 生成资产跨 schema 只作为一次全量重建处理；运行时 parser 仍只接纳当前单版本。
  const previousPublic: ProviderCatalogSnapshot | undefined = hasCurrentPreviousProjection
    ? parseProviderCatalogSnapshot(previousPublicInput)
    : undefined;
  if (
    previousPublic?.generation.source_sha256 === sourceSha256 &&
    previousPublic.generation.policy_version === PROVIDER_CATALOG_POLICY_VERSION
  ) {
    return `Provider Catalog ${mode === 'check' ? '检查通过' : '无变化'}: ${previousPublic.generation.id}`;
  }

  const syncedAt = new Date().toISOString();
  const generationId = `models-dev-${syncedAt.slice(0, 10)}-${sourceSha256.slice(0, 12)}-p${PROVIDER_CATALOG_POLICY_VERSION}`;
  const source = ModelsDevSourceSchema.parse(JSON.parse(rawSource));
  const projections = generateProviderCatalog(source, {
    id: generationId,
    source_url: MODELS_DEV_SOURCE_URL,
    source_sha256: sourceSha256,
    synced_at: syncedAt,
    policy_version: PROVIDER_CATALOG_POLICY_VERSION,
  });
  assertProviderCatalogProjectionConsistency(
    projections.publicCatalog,
    projections.runtimeBindings
  );

  const nextRuntimeJson = stableJson(projections.runtimeBindings);
  const runtimeBindingChanged =
    previousRuntime === undefined ||
    typeof previousRuntime !== 'object' ||
    previousRuntime === null ||
    !('bindings' in previousRuntime) ||
    stableJson(previousRuntime.bindings) !== stableJson(projections.runtimeBindings.bindings);

  const report = describeProviderCatalogDiff(
    previousPublic,
    projections.publicCatalog,
    runtimeBindingChanged
  );
  if (mode === 'check') {
    throw new Error(`Provider Catalog 需要同步:\n${report}`);
  }

  await replaceGeneratedAssets(projections.publicCatalog, projections.runtimeBindings);
  return report;
}
