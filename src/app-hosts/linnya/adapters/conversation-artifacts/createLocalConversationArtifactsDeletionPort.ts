import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { sanitizePathSegment } from '../../../../shared/utils/pathSanitizer';
import { isPathInsideRoot } from '../../../../shared/filesystem/managedPath';
import { deriveCommandOutputConversationDirectory } from '../../../../infra/adapters/command-runtime/output';
import type { ConversationArtifactsDeletionPort } from '../../application/conversation-lifecycle/definitions/conversationArtifactsDeletionPort';

/** 两种正式存储布局共用删除时机；不能调用会创建目录的 pathManager getter。 */
export function createLocalConversationArtifactsDeletionPort(input: {
  readonly artifactsRoot: string;
}): ConversationArtifactsDeletionPort {
  return {
    async deleteForConversation(conversationId) {
      const legacySegment = sanitizePathSegment(conversationId, 120);
      const segments = [deriveCommandOutputConversationDirectory(conversationId)];
      // 历史布局使用原 ID 目录；被替换或截断的身份不能证明该目录独占归属。
      if (legacySegment !== conversationId) {
        const entry = await fsp
          .lstat(path.join(input.artifactsRoot, legacySegment))
          .catch((error: unknown) => {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
              throw error;
            return null;
          });
        if (entry) throw new Error('Cannot identify exclusive legacy conversation artifacts');
      } else {
        segments.push(legacySegment);
      }
      for (const segment of segments) {
        const target = path.resolve(input.artifactsRoot, segment);
        if (!isPathInsideRoot(path.resolve(input.artifactsRoot), target)) {
          throw new Error('Conversation artifact directory is outside its storage root');
        }
        await fsp.rm(target, { recursive: true, force: true });
      }
    },
  };
}
