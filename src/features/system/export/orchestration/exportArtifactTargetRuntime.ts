import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  ExportArtifactCommitRequest,
  ExportArtifactCommitResult,
  ExportArtifactTarget,
  ExportArtifactTargetRequest,
} from '@linnya/plugin-host-contract';
import type {
  ExportArtifactTargetRecord,
  ExportArtifactTargetRegistry,
} from '../definitions/exportArtifactTarget';
import {
  ExportArtifactRequestInvalidError,
  ExportArtifactTargetDescriptorMismatchError,
  ExportArtifactTargetExpiredError,
  ExportArtifactTargetMissingError,
  ExportArtifactTargetOwnerMismatchError,
} from '../definitions/exportErrors';
import { ensureExportArtifactExtension } from '../functions/exportArtifactRules';
import { writeExportArtifactAtomically } from '../functions/writeExportArtifactAtomically';

const EXPORT_TARGET_TTL_MS = 15 * 60 * 1000;
interface ExportArtifactTargetRegistryOptions {
  readonly now?: () => number;
  readonly createToken?: () => string;
  readonly writeArtifact?: (filePath: string, bytes: Uint8Array) => Promise<void>;
}

export function createExportArtifactTargetRegistry(
  options: ExportArtifactTargetRegistryOptions = {},
): ExportArtifactTargetRegistry {
  const now = options.now ?? Date.now;
  const createToken = options.createToken ?? randomUUID;
  const writeArtifact = options.writeArtifact ?? writeExportArtifactAtomically;
  const targets = new Map<string, ExportArtifactTargetRecord>();

  const discardExpiredTargets = (): void => {
    const currentTime = now();
    for (const [token, target] of targets) {
      if (currentTime >= target.expiresAtMs) {
        targets.delete(token);
      }
    }
  };

  return Object.freeze({
    authorize(
      request: ExportArtifactTargetRequest,
      selectedFilePath: string,
    ): ExportArtifactTarget {
      discardExpiredTargets();
      if (!path.isAbsolute(selectedFilePath)) {
        throw new ExportArtifactRequestInvalidError('selectedFilePath');
      }
      const filePath = ensureExportArtifactExtension(
        path.normalize(selectedFilePath),
        request.extension,
      );
      const token = createToken();
      const fileName = path.basename(filePath);
      targets.set(token, {
        token,
        pluginId: request.pluginId,
        filePath,
        fileName,
        extension: request.extension,
        mediaType: request.mediaType,
        expiresAtMs: now() + EXPORT_TARGET_TTL_MS,
      });
      return { token, fileName };
    },

    async commit(
      request: ExportArtifactCommitRequest,
    ): Promise<ExportArtifactCommitResult> {
      if (!(request.bytes instanceof Uint8Array) || request.bytes.byteLength === 0) {
        throw new ExportArtifactRequestInvalidError('bytes');
      }
      const target = targets.get(request.targetToken);
      if (!target) {
        throw new ExportArtifactTargetMissingError();
      }
      if (now() >= target.expiresAtMs) {
        targets.delete(request.targetToken);
        throw new ExportArtifactTargetExpiredError();
      }
      if (target.pluginId !== request.pluginId) {
        throw new ExportArtifactTargetOwnerMismatchError();
      }
      if (
        target.extension !== request.extension
        || target.mediaType !== request.mediaType
      ) {
        throw new ExportArtifactTargetDescriptorMismatchError();
      }

      // token 从发布开始即消费；失败不能用旧授权向同一路径重复写入。
      targets.delete(request.targetToken);
      await writeArtifact(target.filePath, request.bytes);
      return {
        fileName: target.fileName,
        byteLength: request.bytes.byteLength,
      };
    },
  });
}

// 对话框授权与最终落盘都归 Electron Main；App Server 只能经窄反向 RPC 提交。
const exportArtifactTargets = createExportArtifactTargetRegistry();

export function authorizeExportArtifactTarget(
  request: ExportArtifactTargetRequest,
  selectedFilePath: string,
): ExportArtifactTarget {
  return exportArtifactTargets.authorize(request, selectedFilePath);
}

export function commitAuthorizedExportArtifact(
  request: ExportArtifactCommitRequest,
): Promise<ExportArtifactCommitResult> {
  return exportArtifactTargets.commit(request);
}
