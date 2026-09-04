/**
 * @file markdownDocumentService.ts
 * @description MarkdownDocumentService - Markdown 文档类型的专职服务。
 * 
 * 职责：
 * 此服务专门处理 `type='tiptap_document'` 节点的所有内部逻辑：
 * - 文档版本的获取和保存
 * - 复杂块（AudioBlock, CodeBlock 等）的 CRUD 操作
 * 
 * 它不关心工作区节点树的管理，那是 WorkspaceService 的职责。
 */

import Database from 'better-sqlite3';
import {
  AudioBlockService,
  CodeBlockService,
  getCurrentRootBlockIdSetFromDoc,
  ImageBlockProjectionService,
  ImageBlockService,
  LatexBlockService,
  TableBlockService,
} from '../../../block-content';
import {
  PendingRevisionsService,
  type PendingRevision,
  type PendingRevisionMetadata,
  type PendingRevisionSource,
} from '../../../pending-revisions/persistence';
import { normalizeToolPendingIntent } from '../../../pending-revisions/functions/normalizeToolPendingIntent';
import {
  insertPendingRootBlock,
  removePendingRootBlock,
} from '../../../pending-revisions/functions/pendingRootBlockMutations';
import { MarkdownOrphanBlockDataCleaner } from './markdownOrphanBlockDataCleaner';
import { MarkdownDocumentVersionRepository } from './markdownDocumentVersionRepository';
import type { MarkdownDocumentVersion } from '../../definitions/documentVersion';
import { countMarkdownTextUnits } from '../../functions/countMarkdownTextUnits';
import {
  assertMarkdownDocumentBlockIdentities,
  parseMarkdownDocJson,
  type MarkdownDocJson,
} from '../../../normalization/runtime';
export class MarkdownDocumentService {
  private db: Database.Database;
  private readonly versionRepository: MarkdownDocumentVersionRepository;

  // 块服务
  public audioBlock: AudioBlockService;
  public codeBlock: CodeBlockService;
  public latexBlock: LatexBlockService;
  public tableBlock: TableBlockService;
  public imageBlock: ImageBlockService;
  private imageBlockProjection: ImageBlockProjectionService;

  // Pending Revisions 服务（AI 修订意图）
  private pendingRevisionsService: PendingRevisionsService;

  constructor(db: Database.Database) {
    this.db = db;
    this.versionRepository = new MarkdownDocumentVersionRepository(db);

    // 初始化块服务
    this.audioBlock = new AudioBlockService(db);
    this.codeBlock = new CodeBlockService(db);
    this.latexBlock = new LatexBlockService(db);
    this.tableBlock = new TableBlockService(db);
    this.imageBlock = new ImageBlockService(db);
    this.imageBlockProjection = new ImageBlockProjectionService(db);

    // 初始化 Pending Revisions 服务
    this.pendingRevisionsService = new PendingRevisionsService(db);
  }

  /**
   * 在同一个 SQLite 事务中执行一组 Markdown 文档写操作。
   *
   * 说明：
   * - 文件工具的多块展开（例如 `update + insert...`）需要原子提交；
   * - 调用方应先在事务外完成所有异步准备工作（如 citation hydration），
   *   再把纯同步的落库阶段包进这里。
   */
  runInTransaction<T>(fn: () => T): T {
    if (this.db.inTransaction) {
      return fn();
    }
    const tx = this.db.transaction(fn);
    return tx();
  }

  /**
   * 文档内容版本是 workspace 文件的真实内容修改来源。
   *
   * 为什么放在 service 内部：
   * - 所有 Markdown 正文写入最终都会经过 saveNewVersion；
   * - grep / 文件树 / 最近修改时间都依赖 workspace_nodes.updated_at 判断文件是否变化；
   * - 如果只更新 document_versions，会让路径层误以为文件没有变。
   */
  private touchWorkspaceNodeUpdatedAt(nodeId: string, updatedAt: number): void {
    const result = this.db.prepare(`
      UPDATE workspace_nodes
      SET updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(updatedAt, nodeId);

    if (result.changes === 0) {
      console.warn(`[MarkdownDocumentService] workspace node not found when touching updated_at: nodeId=${nodeId}`);
    }
  }

  /**
   * 获取文档的最新版本
   */
  getLatestVersion(nodeId: string): MarkdownDocumentVersion | null {
    return this.versionRepository.getLatest(nodeId);
  }

  /**
   * 获取文档的特定版本
   */
  getVersion(nodeId: string, versionNumber: number): MarkdownDocumentVersion | null {
    return this.versionRepository.get(nodeId, versionNumber);
  }

  /**
   * 保存文档的新版本
   */
  saveNewVersion(nodeId: string, contentJson: string, authorId: string | null = null): MarkdownDocumentVersion {
    const documentContent = parseMarkdownDocJson(JSON.parse(contentJson));
    assertMarkdownDocumentBlockIdentities(documentContent);
    const now = Date.now();
    const saved = this.versionRepository.save({
      nodeId,
      contentJson,
      charCount: countMarkdownTextUnits(documentContent),
      authorId,
      createdAt: now,
    });
    this.touchWorkspaceNodeUpdatedAt(nodeId, now);
    return saved;
  }

  // ========== 复杂块管理 ==========
  // 所有块的具体操作都委托给相应的块服务
  // 例如：this.audioBlock.createAudioBlock(), this.codeBlock.getCodeBlock() 等

  /**
   * 创建新文档
   */
  createDocument(documentNodeId: string, content: unknown): string {
    const contentJson = typeof content === 'string' ? content : JSON.stringify(content);
    const version = this.saveNewVersion(documentNodeId, contentJson);
    return version.id;
  }

  /**
   * 获取文档内容（返回最新版本）
   */
  getDocument(documentNodeId: string): MarkdownDocJson {
    const version = this.getLatestVersion(documentNodeId);
    if (!version) {
      throw new Error(`Document not found: ${documentNodeId}`);
    }
    const document = parseMarkdownDocJson(JSON.parse(version.content_json));
    assertMarkdownDocumentBlockIdentities(document);
    return document;
  }

  /**
   * 更新文档内容（创建新版本）
   *
   * 设计约束：
   * - 每次保存新版本后，立即触发一次“幽灵块数据”清理，
   *   确保前端删除 / 撤回导致的块删除不会遗留挂在旧 blockId 上的卫星数据。
   * - 这样可以把不变量收敛到后端：只要某个 blockId 不再出现在最新 content_json 中，
   *   所有挂在它上的 pending / block_versions 都会被同步移除。
   */
  updateDocument(documentNodeId: string, content: unknown): MarkdownDocumentVersion {
    const contentJson =
      typeof content === 'string' ? content : JSON.stringify(content);
    const documentContent = typeof content === 'string' ? JSON.parse(contentJson) : content;

    return this.runInTransaction(() => {
      const version = this.saveNewVersion(documentNodeId, contentJson);

      const projectionResult = this.imageBlockProjection.syncDocumentProjection(
        documentNodeId,
        documentContent
      );
      if (projectionResult.upserted > 0 || projectionResult.removed > 0) {
        console.log(
          `[MarkdownDocumentService] updateDocument: 同步图片投影 documentId=${documentNodeId}, ` +
            `upserted=${projectionResult.upserted}, removed=${projectionResult.removed}`
        );
      }

      // 在新版本落库后，立刻清理该文档下的幽灵块数据。
      // 这里必须和版本写入、图片投影处在同一事务里，否则会出现正文已保存但索引/卫星表未同步的半写状态。
      const cleaner = new MarkdownOrphanBlockDataCleaner(this.db, this);
      const result = cleaner.cleanupDocumentOrphans(documentNodeId);

      if (
        result.removedPending > 0 ||
        result.removedBlockVersions > 0
      ) {
        console.log(
          `[MarkdownDocumentService] updateDocument: 在保存文档 ${documentNodeId} 时清理了 ` +
            `pending=${result.removedPending}, blockVersions=${result.removedBlockVersions}`
        );
      }

      return version;
    });
  }

  // ========== Block 附加数据一致性约束 ==========
  //
  // 所有挂在 blockId 上的卫星数据（pending revisions、block history 等），
  // 在写入前都必须保证对应的 rootBlock 真实存在于最新的 content_json 中。
  //
  // 由于 blockId 目前仅存在于 ProseMirror JSON 结构中，无法通过数据库外键约束，
  // 因此需要在服务层进行一次轻量的结构校验。

  /**
   * 检查指定文档中是否存在给定 blockId 的 rootBlock。
   */
  private blockExists(documentNodeId: string, blockId: string): boolean {
    const doc = this.getDocument(documentNodeId) as { content?: unknown };
    const ids = getCurrentRootBlockIdSetFromDoc(doc);
    return ids.has(blockId);
  }

  /**
   * 断言指定文档中存在给定 blockId 的 rootBlock。
   *
   * 若不存在，则抛出错误，阻止写入任何挂在该 blockId 上的卫星数据，
   * 避免生成无法回收的幽灵卫星数据。
   */
  private assertBlockExists(documentNodeId: string, blockId: string): void {
    const exists = this.blockExists(documentNodeId, blockId);
    if (!exists) {
      throw new Error(
        `[MarkdownDocumentService] 目标块不存在，禁止写入附加数据: documentId=${documentNodeId}, blockId=${blockId}`
      );
    }
  }

  // ========== 块级操作（Phase 7: 块实体唯一来源） ==========

  /**
   * 在指定块后插入一个空 rootBlock（仅结构，无文字内容）
   * 
   * 这是 Phase 7 「块实体唯一来源」的核心方法：
   * - AI 工具调用 insert 操作时，由后端负责在 content_json 中创建块实体
   * - 前端只负责通过 pending revision 应用文本内容（RichDiff）
   * - 确保块实体的创建路径唯一，避免前后端双轨
   * 
   * @param documentNodeId - 文档节点 ID
   * @param anchorBlockId - 锚点块 ID（新块将插入在其后）
   * @param newBlockId - 新块的 ID（由调用方生成）
   * @throws Error 如果找不到锚点块
   */
  insertEmptyBlockAfter(
    documentNodeId: string,
    anchorBlockId: string,
    newBlockId: string
  ): void {
    const pendings = this.getPendingRevisions(documentNodeId);
    const newDoc = insertPendingRootBlock({
      documentId: documentNodeId,
      document: this.getDocument(documentNodeId),
      anchorBlockId,
      newBlockId,
      existingPendings: pendings.map((pending) => ({
        targetBlockId: pending.target_block_id,
        metadataJson: pending.meta_json,
      })),
    });
    this.updateDocument(documentNodeId, newDoc);

    console.log(
      `[insertEmptyBlockAfter] 成功插入空块: newBlockId=${newBlockId}, ` +
      `after anchorBlockId=${anchorBlockId}, documentId=${documentNodeId}`
    );
  }

  // ========== Pending Revisions（AI 修订意图）管理 ==========

  /**
   * 从文档结构中删除指定 blockId 的顶层 rootBlock。
   *
   * 中文说明：
   * - 这是“insert 占位块”的逆操作；
   * - 删除后会触发 updateDocument → orphan cleaner，把挂在该 blockId 上的 pending/history 一并清理干净。
   */
  private removeRootBlockEntity(documentNodeId: string, blockId: string): void {
    this.updateDocument(documentNodeId, removePendingRootBlock({
      documentId: documentNodeId,
      document: this.getDocument(documentNodeId),
      blockId,
    }));
  }

  /**
   * 写入或覆盖某块的 pending revision
   *
   * 若目标 (documentId, blockId) 已存在记录 → 覆盖
   * 若不存在 → 插入新记录
   *
   * @param documentId 文档节点 ID
   * @param blockId 块 ID
   * @param newMarkdown AI 建议的完整块 Markdown
   * @param source 来源标记，默认 'ai'
   * @param meta 可选元数据
   * @returns 写入后的 pending revision 记录
   */
  setPendingRevision(
    documentId: string,
    blockId: string,
    newMarkdown: string,
    source: PendingRevisionSource = 'ai',
    meta?: PendingRevisionMetadata
  ): PendingRevision {
    // 在写入 pending 之前，确保目标块真实存在
    this.assertBlockExists(documentId, blockId);

    return this.pendingRevisionsService.setPendingRevision({
      documentId,
      blockId,
      newMarkdown,
      source,
      meta,
    });
  }

  /**
   * 写入 pending revision（工具专用入口，带“语义归一化”）。
   *
   * 解决的问题：
   * - insert 会先在 content_json 创建“空块实体”（占位 rootBlock）；
   * - 如果随后对同一 blockId 再写 delete pending，后端会留下“占位块 + delete pending”，
   *   前端按事实渲染就会出现“删除修订块”（但这块从未真正存在于最终文档里，净效果应为 0）。
   *
   * 归一化规则（确定性，不做猜测）：
   * - 若 existing pending.operation === 'insert' 且 incoming pending.operation === 'delete'：
   *   - 直接从 content_json 删除该占位 rootBlock；
   *   - 由 updateDocument 的 orphan cleaner 自动清掉 pending 行；
   *   - 返回 cancelled=true，表示本次操作已“抵消”，无需再写入 delete pending。
   */
  setPendingRevisionForToolIntent(params: {
    documentId: string;
    blockId: string;
    newMarkdown: string;
    source?: PendingRevisionSource;
    meta?: PendingRevisionMetadata;
  }): { cancelled: boolean; revision?: PendingRevision } {
    const { documentId, blockId, newMarkdown, source = 'ai', meta } = params;

    const existing = this.pendingRevisionsService.getPendingRevisionForBlock(documentId, blockId);
    const normalized = normalizeToolPendingIntent({
      existingMetadataJson: existing?.meta_json ?? null,
      incomingMetadata: meta,
    });
    if (normalized.action === 'cancel_insert') {
      this.removeRootBlockEntity(documentId, blockId);
      console.log(
        `[MarkdownDocumentService] setPendingRevisionForToolIntent: insert+delete 抵消，已删除占位块 `
          + `documentId=${documentId}, blockId=${blockId}`
      );
      return { cancelled: true };
    }

    const revision = this.setPendingRevision(
      documentId,
      blockId,
      newMarkdown,
      source,
      normalized.metadata
    );
    return { cancelled: false, revision };
  }

  /**
   * 获取文档下所有 pending revisions
   *
   * @param documentId 文档节点 ID
   * @returns 按 created_at 升序排列的 pending revisions 列表
   */
  getPendingRevisions(documentId: string): PendingRevision[] {
    return this.pendingRevisionsService.getPendingRevisions(documentId);
  }

  /**
   * 获取指定块的 pending revision。
   *
   * 中文说明：
   * - 块级接受/拒绝走后端原子 apply 时，只需要读取当前块的 pending；
   * - 这里保持 MarkdownDocumentService 作为 pending 表访问门面，避免 IPC 层越过服务边界。
   */
  getPendingRevisionForBlock(documentId: string, blockId: string): PendingRevision | null {
    return this.pendingRevisionsService.getPendingRevisionForBlock(documentId, blockId);
  }

  /**
   * 清理指定块的 pending revision
   *
   * @param documentId 文档节点 ID
   * @param blockId 块 ID
   * @returns 删除的记录数
   */
  clearPendingRevision(documentId: string, blockId: string): number {
    return this.pendingRevisionsService.clearPendingRevision(documentId, blockId);
  }

  /**
   * 清理文档下所有 pending revisions
   *
   * @param documentId 文档节点 ID
   * @returns 删除的记录数
   */
  clearAllPendingRevisions(documentId: string): number {
    return this.pendingRevisionsService.clearAllPendingRevisions(documentId);
  }

}
