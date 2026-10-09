import type Database from 'better-sqlite3';
import type { PluginToolContext } from '@linnya/plugin-host-contract/backend/toolRuntime';
import { attachCitationSourceResolver } from 'src/domains/citation';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { createWorkspaceDocumentFile } from 'src/features/workspace/document-file-create';
import {
  readWorkspaceVfsNode, resolveWorkspaceVfsNode, splitNormalizedVfsPath,
} from 'src/features/workspace/vfs';
import {
  ResearchDocumentError,
  type ResearchDocumentPort,
  type ResearchDocumentSnapshot,
} from '../../application/research/definitions/researchDocumentPort';
import { createWorkspaceDocumentFileCreateProviderResolver } from '../document-file-create/createWorkspaceDocumentFileCreateProviderResolver';
import type { IEventStore } from '../persistence/event-store';
import { createCitationSourceResolver } from '../tools/citation-source-resolution';
import { projectResearchDocumentSnapshot } from './functions/projectResearchDocumentSnapshot';
import { researchDocumentPath } from './functions/researchDocumentPath';
import { readResearchSourceEvents } from './orchestration/readResearchSourceEvents';
import { readCreatedResearchDocumentSnapshot } from './functions/readCreatedResearchDocumentSnapshot';

/** 与 read_file 的 source admission 一致；达到上限时拒绝交接，而非给截断结果打版本戳。 */
export const RESEARCH_DOCUMENT_SOURCE_MAX_CHARS = 20 * 1024 * 1024;

export function createWorkspaceResearchDocumentPort(params: {
  readonly db: Database.Database;
  readonly workspaceService?: WorkspaceService;
  readonly eventStore: Pick<IEventStore, 'openRunSession' | 'readEvents'>;
}): ResearchDocumentPort {
  const workspaceService = params.workspaceService ?? new WorkspaceService(params.db);
  const port: ResearchDocumentPort = {
    async read(request) {
      const result = await readWorkspaceVfsNode({
        db: params.db,
        projectId: request.projectId,
        maxChars: RESEARCH_DOCUMENT_SOURCE_MAX_CHARS,
        ...(request.inode !== undefined
          ? { inode: request.inode }
          : { path: researchDocumentPath(request.locator) }),
      });
      return projectResearchDocumentSnapshot(result);
    },
    async save(request) {
      if (request.text.trim().length === 0) {
        throw new ResearchDocumentError('RESEARCH_DOCUMENT_INVALID', '阶段没有交付正文，不能保存空稿。');
      }
      const path = researchDocumentPath(request.path);
      const segments = splitNormalizedVfsPath(path);
      const name = segments[segments.length - 1];
      if (!name || !/\.(?:md|markdown)$/i.test(name)) {
        throw new ResearchDocumentError('RESEARCH_DOCUMENT_PATH_INVALID', '阶段产物路径必须明确使用 .md 或 .markdown。');
      }
      let parentId: string | null = null;
      if (segments.length > 1) {
        const parent = await resolveWorkspaceVfsNode({
          db: params.db, projectId: request.projectId,
          path: `/${segments.slice(0, -1).join('/')}`,
        });
        if (!parent.ok || parent.node.type !== 'folder' || parent.node.is_virtual) {
          throw new ResearchDocumentError('RESEARCH_DOCUMENT_PATH_INVALID', '阶段产物的父目录必须是已有 Workspace 文件夹。');
        }
        parentId = parent.node.id;
      }
      const events = await readResearchSourceEvents({
        eventStore: params.eventStore,
        conversationId: request.conversationId,
        sourceRunId: request.sourceRunId,
      });
      const context: PluginToolContext = { conversationId: request.conversationId };
      attachCitationSourceResolver(context, createCitationSourceResolver({
        events,
        async resolveEvidence() {
          // 阶段交接只能引用本 run 正式读到的材料；不能用同项目可访问性补齐错误 scope。
          throw new ResearchDocumentError('RESEARCH_DOCUMENT_CITATION_INVALID', '阶段引用未在产出回答的 run 中绑定；请先用正式 read_file 重新读取来源文档。');
        },
      }));
      let committedSnapshot: ResearchDocumentSnapshot | undefined;
      const created = await createWorkspaceDocumentFile({
        request: { projectId: request.projectId, parentId, name, content: request.text },
        resolveProvider: createWorkspaceDocumentFileCreateProviderResolver({
          db: params.db, context, workspaceService,
          resultCommit: {
            prepare: () => request.receipt.prepare(),
            commit: created => {
              const snapshot = readCreatedResearchDocumentSnapshot(
                params.db, created.documentId, RESEARCH_DOCUMENT_SOURCE_MAX_CHARS,
              );
              request.receipt.commit({
                inode: snapshot.inode, locator: snapshot.locator,
                representation: snapshot.representation, sha256: snapshot.sha256,
                citationSha256: snapshot.citationSha256,
              });
              committedSnapshot = snapshot;
            },
          },
        }),
      });
      if (!created) {
        throw new ResearchDocumentError('RESEARCH_DOCUMENT_PATH_INVALID', '阶段产物没有正式 Markdown 创建 provider。');
      }
      // 返回与成功回执同一事务的投影；提交后的异步重读不能把已提交成功改判为错误，
      // 也不能悄悄把用户的新改动作为本次提交结果。后续版本检查归调用方接纳边界。
      if (!committedSnapshot) throw new Error('Research document provider did not commit its snapshot.');
      return committedSnapshot;
    },
  };
  return port;
}
