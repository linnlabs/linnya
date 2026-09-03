import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createAiSdkLanguageModelRegistry } from '@linnlabs/linnkit-provider-ai-sdk';
import { PROVIDER_CONFORMANCE_SUITE_VERSION } from '@linnlabs/linnkit-provider-ai-sdk/conformance';
import { providerCatalog } from '@linnya/provider-catalog';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPackageIdentity(relativeManifestPath: string): {
  readonly name: string;
  readonly version: string;
} {
  const parsed: unknown = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), relativeManifestPath), 'utf8')
  );
  if (!isRecord(parsed) || typeof parsed.name !== 'string' || typeof parsed.version !== 'string') {
    throw new Error(`${relativeManifestPath} 缺少有效 name/version。`);
  }
  return { name: parsed.name, version: parsed.version };
}

const adapterPackage = readPackageIdentity('packages/linnkit-provider-ai-sdk/package.json');
const providerPackageVersions = new Map<string, string>();
for (const factory of createAiSdkLanguageModelRegistry().entries) {
  const currentVersion = providerPackageVersions.get(factory.package_name);
  if (currentVersion !== undefined && currentVersion !== factory.package_version) {
    throw new Error(`${factory.package_name} 在 factory registry 中出现多个版本。`);
  }
  providerPackageVersions.set(factory.package_name, factory.package_version);
}

console.log(
  JSON.stringify(
    {
      provider_catalog: {
        generation_id: providerCatalog.generation.id,
        source_sha256: providerCatalog.generation.source_sha256,
        policy_version: providerCatalog.generation.policy_version,
      },
      inference_adapter: {
        package_name: adapterPackage.name,
        package_version: adapterPackage.version,
        conformance_suite_version: PROVIDER_CONFORMANCE_SUITE_VERSION,
        provider_packages: [...providerPackageVersions]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([package_name, package_version]) => ({ package_name, package_version })),
      },
    },
    null,
    2
  )
);
