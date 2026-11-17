import type { KnowledgeDatabase } from '../../definitions/knowledgeDatabase';
import {
  KnowledgeIndexRebuildRequiredError,
  KnowledgeIndexSpaceMismatchError,
  type KnowledgeIndexIdentity,
  type KnowledgeIndexState,
} from '../definitions/knowledgeIndex';

interface KnowledgeIndexRow {
  readonly embedding_model_id: string | null;
  readonly embedding_space_id: string | null;
}

/** 索引身份与知识库同表；不复制模型配置、不保存密钥、不从当前目录猜旧索引的身份。 */
export class KnowledgeIndexStateRepository {
  constructor(private readonly database: KnowledgeDatabase) {}

  read(kbId: string): KnowledgeIndexState {
    const row = this.database.prepare<[string], KnowledgeIndexRow>(
      'SELECT embedding_model_id, embedding_space_id FROM knowledge_bases WHERE id = ?',
    ).get(kbId);
    if (!row) throw new Error(`知识库不存在: ${kbId}`);
    return { modelId: row.embedding_model_id, spaceId: row.embedding_space_id };
  }

  requireReady(kbId: string): KnowledgeIndexIdentity {
    const state = this.read(kbId);
    if (!state.modelId || !state.spaceId) throw new KnowledgeIndexRebuildRequiredError(kbId);
    return { modelId: state.modelId, spaceId: state.spaceId };
  }

  /**
   * 首次追加在写向量前原子认领空间。多个 Worker 不能各自读到空值后混写。
   * 认领失败/摄入失败后保留约束；下一次同空间导入仍可继续，不伪称已有完整文档。
   */
  claimForAppend(kbId: string, identity: KnowledgeIndexIdentity): void {
    this.database.transaction(() => {
      const current = this.read(kbId);
      if (current.spaceId) {
        if (current.spaceId !== identity.spaceId) throw new KnowledgeIndexSpaceMismatchError(kbId);
        return;
      }
      const complete = this.database.prepare<[string], { count: number }>(
        "SELECT COUNT(*) AS count FROM kb_documents WHERE kb_id = ? AND status = 'completed'",
      ).get(kbId);
      // 非空旧库、失败重建都不能以当前配置回填身份；已有原文只走显式重建。
      if (complete && complete.count > 0) throw new KnowledgeIndexRebuildRequiredError(kbId);
      this.write(kbId, identity);
    }).immediate();
  }

  /** 清除可用身份先于任何破坏性向量替换，异常退出后仍能识别不完整索引。 */
  invalidateForRebuild(kbId: string): void {
    const result = this.database.prepare(
      'UPDATE knowledge_bases SET embedding_space_id = NULL WHERE id = ?',
    ).run(kbId);
    if (result.changes === 0) throw new Error(`知识库不存在: ${kbId}`);
  }

  /** 由重建 owner 在全部 chunk / graph 向量校验成功后发布。 */
  publishRebuilt(kbId: string, identity: KnowledgeIndexIdentity): void {
    this.write(kbId, identity);
  }

  private write(kbId: string, identity: KnowledgeIndexIdentity): void {
    if (!identity.modelId.trim() || !identity.spaceId.trim()) throw new Error('索引身份不能为空');
    const result = this.database.prepare(`UPDATE knowledge_bases
      SET embedding_model_id = ?, embedding_space_id = ?, updated_at = ? WHERE id = ?`)
      .run(identity.modelId, identity.spaceId, Date.now() / 1000, kbId);
    if (result.changes === 0) throw new Error(`知识库不存在: ${kbId}`);
  }
}
