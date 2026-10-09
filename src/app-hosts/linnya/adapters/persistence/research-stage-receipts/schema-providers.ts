import type { ISchemaProvider } from 'src/shared/database/schema-provider';

export const RESEARCH_STAGE_RECEIPT_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS research_stage_receipts (
    parent_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    tool_call_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    prepared_json TEXT NOT NULL,
    artifact_json TEXT,
    PRIMARY KEY (parent_run_id, tool_call_id, stage)
  )`,
];

export function getResearchStageReceiptSchemaProviders(): ISchemaProvider[] {
  return [{ name: 'research-stage-receipts', getSchema: () => RESEARCH_STAGE_RECEIPT_SCHEMAS }];
}
