import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import JSZip from 'jszip';

import type { ArtifactContentEntry } from '../definitions/artifactContentBom';
import {
  classifyPluginArtifactPath,
  createArtifactContentBom,
  normalizeArtifactPath,
  sha256Hex,
} from '../functions/artifactContentBom';
import { repoRoot, resolvePluginPackageDir } from '../plugin-release-targets.mjs';
import {
  readArtifactEnvelope,
  readArtifactSourceIdentity,
  writeOrVerifyArtifactContentBom,
} from './artifactContentBomSupport';

interface PluginManifestIdentity {
  readonly id: string;
  readonly version: string;
}

function readPluginManifestIdentity(manifestPath: string): PluginManifestIdentity {
  const input: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error(`插件 manifest 必须是对象：${manifestPath}`);
  }
  const id = Reflect.get(input, 'id');
  const version = Reflect.get(input, 'version');
  if (typeof id !== 'string' || !id || typeof version !== 'string' || !version) {
    throw new Error(`插件 manifest 缺少 id/version：${manifestPath}`);
  }
  return { id, version };
}

async function readPluginArchiveEntries(zipPath: string): Promise<readonly ArtifactContentEntry[]> {
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const entries: ArtifactContentEntry[] = [];
  for (const [rawPath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;
    const artifactPath = normalizeArtifactPath(rawPath);
    const bytes = await zipEntry.async('nodebuffer');
    entries.push({
      type: 'file',
      scope: 'plugin-archive',
      path: artifactPath,
      category: classifyPluginArtifactPath(artifactPath),
      executable: false,
      size: bytes.byteLength,
      sha256: sha256Hex(bytes),
    });
  }
  return entries;
}

export async function generatePluginArtifactContentBom(input: {
  readonly pluginId: string;
  readonly verify: boolean;
}): Promise<string> {
  const packageDir = resolvePluginPackageDir(input.pluginId);
  const manifest = readPluginManifestIdentity(path.join(packageDir, 'plugin.json'));
  if (manifest.id !== input.pluginId) {
    throw new Error(`请求插件 ${input.pluginId}，但 manifest id=${manifest.id}`);
  }
  const artifactDir = path.join(packageDir, 'dist', 'artifacts');
  const zipPath = path.join(artifactDir, `${manifest.id}-${manifest.version}.zip`);
  const outputPath = path.join(artifactDir, `${manifest.id}-${manifest.version}.content-bom.json`);
  const bom = createArtifactContentBom({
    kind: 'linnya-plugin-artifact-content',
    identity: {
      name: manifest.id,
      pluginId: manifest.id,
      version: manifest.version,
    },
    source: readArtifactSourceIdentity(repoRoot),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    artifacts: [readArtifactEnvelope(zipPath, 'plugin-archive')],
    entries: await readPluginArchiveEntries(zipPath),
  });
  writeOrVerifyArtifactContentBom({ bom, outputPath, verify: input.verify });
  return outputPath;
}

async function main(): Promise<void> {
  const pluginId = process.argv[2];
  if (!pluginId) {
    throw new Error('用法：generatePluginArtifactContentBom.ts <pluginId> [--verify]');
  }
  const outputPath = await generatePluginArtifactContentBom({
    pluginId,
    verify: process.argv.includes('--verify'),
  });
  process.stdout.write(`[plugin-content-bom:${pluginId}] ${path.relative(repoRoot, outputPath)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
