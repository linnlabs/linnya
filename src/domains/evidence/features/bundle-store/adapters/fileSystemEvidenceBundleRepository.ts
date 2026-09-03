import { promises as fsp, type Dirent } from 'fs';
import path from 'path';
import { pathManager } from '../../../../../shared/utils/pathManager';
import type {
  EvidenceBundleRepositoryPort,
  EvidenceBundleSnapshot,
  EvidenceBundleStorageIdentity,
} from '../ports/evidenceBundleRepository';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingDirectoryError(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT';
}

async function readDirectoryEntries(directoryPath: string): Promise<readonly Dirent[]> {
  try {
    return await fsp.readdir(directoryPath, { withFileTypes: true });
  } catch (error: unknown) {
    if (isMissingDirectoryError(error)) return [];
    throw error;
  }
}

interface BundleFileLocation {
  readonly instanceId: string;
  readonly filename: string;
  readonly displayName: string;
  readonly fullPath: string;
}

function resolveStorageIdentity(filename: string): EvidenceBundleStorageIdentity {
  const canonicalMatch = filename.match(/^([a-f0-9]{16})\.json$/i);
  if (canonicalMatch) {
    return { kind: 'canonical_bundle', bundleId: canonicalMatch[1] };
  }
  if (/\.json$/i.test(filename)) {
    // 历史 list_refs 会接纳可解析的非 canonical JSON；这里保留既有行为，
    // 但不再让上层编排重复理解扩展名。
    return { kind: 'noncanonical_json' };
  }
  return { kind: 'other_file' };
}

async function listBundleFileLocations(params: {
  readonly conversationId: string;
  readonly preferredInstanceId: string;
  readonly scope: 'instance' | 'conversation';
}): Promise<readonly BundleFileLocation[]> {
  if (params.scope === 'instance') {
    const bundlesDir = pathManager.getConversationEvidenceBundlesDir({
      conversationId: params.conversationId,
      instanceId: params.preferredInstanceId,
    });
    const entries = await readDirectoryEntries(bundlesDir);
    return entries
      .filter(entry => entry.isFile())
      .map(entry => ({
        instanceId: params.preferredInstanceId,
        filename: entry.name,
        displayName: entry.name,
        fullPath: path.join(bundlesDir, entry.name),
      }))
      .sort((left, right) => left.filename.localeCompare(right.filename));
  }

  const instancesDir = pathManager.getConversationInstancesDir({
    conversationId: params.conversationId,
  });
  const preferredInstanceDir = path.basename(
    pathManager.getConversationInstanceDir({
      conversationId: params.conversationId,
      instanceId: params.preferredInstanceId,
    }),
  );
  const entries = await readDirectoryEntries(instancesDir);
  const instanceIds = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => {
      if (left === preferredInstanceDir) return -1;
      if (right === preferredInstanceDir) return 1;
      return left.localeCompare(right);
    });
  const locations: BundleFileLocation[] = [];

  for (const instanceId of instanceIds) {
    const bundlesDir = path.join(instancesDir, instanceId, 'evidence', 'bundles');
    const bundleEntries = await readDirectoryEntries(bundlesDir);
    for (const entry of bundleEntries
      .filter(item => item.isFile())
      .sort((left, right) => left.name.localeCompare(right.name))) {
      locations.push({
        instanceId,
        filename: entry.name,
        displayName: `${instanceId}/${entry.name}`,
        fullPath: path.join(bundlesDir, entry.name),
      });
    }
  }
  return locations;
}

async function readBundleSnapshot(location: BundleFileLocation): Promise<EvidenceBundleSnapshot> {
  try {
    const content = JSON.parse(await fsp.readFile(location.fullPath, 'utf-8')) as unknown;
    return {
      instanceId: location.instanceId,
      displayName: location.displayName,
      storageIdentity: resolveStorageIdentity(location.filename),
      status: 'readable',
      content,
    };
  } catch {
    return {
      instanceId: location.instanceId,
      displayName: location.displayName,
      storageIdentity: resolveStorageIdentity(location.filename),
      status: 'unreadable',
    };
  }
}

export const fileSystemEvidenceBundleRepository: EvidenceBundleRepositoryPort = {
  async listBundleSnapshots(params) {
    const locations = await listBundleFileLocations(params);
    return Promise.all(locations.map(readBundleSnapshot));
  },
};
