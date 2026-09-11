import type { ISchemaProvider } from 'src/shared/database/schema-provider';

export const RUN_DESCRIPTORS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS agent_run_descriptors (
    run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    descriptor_json TEXT NOT NULL,
    checkpoint_committed INTEGER NOT NULL DEFAULT 0 CHECK (checkpoint_committed IN (0, 1))
  )`,
  `CREATE TABLE IF NOT EXISTS agent_tool_results (
    run_id TEXT NOT NULL REFERENCES agent_run_descriptors(run_id) ON DELETE CASCADE,
    tool_call_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    result TEXT,
    atomic_owner INTEGER NOT NULL CHECK (atomic_owner IN (0, 1)),
    PRIMARY KEY (run_id, tool_call_id)
  )`,
];

export function getRunDescriptorSchemaProviders(): ISchemaProvider[] {
  return [{ name: 'agent_run_descriptors', getSchema: () => RUN_DESCRIPTORS_SCHEMA }];
}
