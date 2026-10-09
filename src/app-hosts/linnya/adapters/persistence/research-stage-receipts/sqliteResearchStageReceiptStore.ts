import type Database from 'better-sqlite3';
import type { ResearchDocumentBinding } from '../../../application/research/definitions/researchDocumentPort';
import type {
  PreparedResearchStage, ResearchExecutionIdentity, ResearchStageReceipt, ResearchStageReceiptPort,
} from '../../../application/research/definitions/researchStageReceipt';
import {
  PreparedResearchStageStorageSchema, ResearchDocumentBindingStorageSchema,
} from './definitions/researchStageReceiptStorage';
import { readResearchStageReceipt } from './functions/readResearchStageReceipt';

const SELECT_RECEIPTS = `SELECT parent_run_id, tool_call_id, stage, project_id, conversation_id,
  model_id, prepared_json, artifact_json FROM research_stage_receipts`;

export class SqliteResearchStageReceiptStore implements ResearchStageReceiptPort {
  constructor(private readonly db: Database.Database) {}

  list(identity: ResearchExecutionIdentity): readonly ResearchStageReceipt[] {
    const rows = this.db.prepare(`${SELECT_RECEIPTS} WHERE parent_run_id = ? AND tool_call_id = ?`)
      .all(identity.parentRunId, identity.toolCallId);
    return rows.map(row => readResearchStageReceipt(row, identity));
  }

  prepare(identity: ResearchExecutionIdentity, input: PreparedResearchStage): ResearchStageReceipt {
    const prepared = PreparedResearchStageStorageSchema.parse(input);
    return this.db.transaction(() => {
      // 同一研究执行的 model/project/conversation 也被冻结，不能换参数复用其它阶段的身份。
      const existing = this.list(identity).find(receipt => receipt.stage === prepared.stage);
      if (existing) {
        this.assertSamePrepared(existing, prepared);
        return existing;
      }
      this.db.prepare(`INSERT INTO research_stage_receipts (
        parent_run_id, tool_call_id, stage, project_id, conversation_id, model_id, prepared_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        identity.parentRunId, identity.toolCallId, prepared.stage, identity.projectId,
        identity.conversationId, identity.modelId, JSON.stringify(prepared),
      );
      return prepared;
    }).immediate();
  }

  assertPrepared(identity: ResearchExecutionIdentity, input: PreparedResearchStage): void {
    this.requirePrepared(identity, input);
  }

  commitArtifact(identity: ResearchExecutionIdentity, input: PreparedResearchStage, artifact: ResearchDocumentBinding): void {
    // receipt 与正文必须共享同一连接、同一个 owner 事务；不能先存新稿再异步补绑定。
    if (!this.db.inTransaction) throw new Error('Research artifact binding requires the document creation transaction.');
    const existing = this.requirePrepared(identity, input);
    const admittedArtifact = ResearchDocumentBindingStorageSchema.parse(artifact);
    if (admittedArtifact.locator !== existing.outputPath) throw new Error('Research artifact path differs from the prepared output.');
    const serialized = JSON.stringify(admittedArtifact);
    if (existing.artifact) {
      if (JSON.stringify(existing.artifact) !== serialized) throw new Error('Research stage already has a different artifact binding.');
      return;
    }
    this.db.prepare(`UPDATE research_stage_receipts SET artifact_json = ?
      WHERE parent_run_id = ? AND tool_call_id = ? AND stage = ?`).run(
      serialized, identity.parentRunId, identity.toolCallId, input.stage,
    );
  }

  private requirePrepared(identity: ResearchExecutionIdentity, input: PreparedResearchStage): ResearchStageReceipt {
    const row = this.db.prepare(`${SELECT_RECEIPTS} WHERE parent_run_id = ? AND tool_call_id = ? AND stage = ?`)
      .get(identity.parentRunId, identity.toolCallId, input.stage);
    if (!row) throw new Error('Research stage has no prepared receipt.');
    const receipt = readResearchStageReceipt(row, identity);
    this.assertSamePrepared(receipt, input);
    return receipt;
  }

  private assertSamePrepared(receipt: ResearchStageReceipt, input: PreparedResearchStage): void {
    // artifact 是后续提交的独立绑定，不参与最初已冻结请求的等价判断。
    const frozen = PreparedResearchStageStorageSchema.parse({
      stage: receipt.stage, invocation: receipt.invocation, subrunId: receipt.subrunId,
      request: receipt.request, inputs: receipt.inputs, outputPath: receipt.outputPath,
    });
    if (JSON.stringify(frozen) !== JSON.stringify(PreparedResearchStageStorageSchema.parse(input))) {
      throw new Error('Research stage request differs from its frozen prepared receipt.');
    }
  }
}
