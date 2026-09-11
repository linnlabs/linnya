import type { ISchemaProvider } from 'src/shared/database/schema-provider';

export function getRunCostSchemaProviders(): ISchemaProvider[] {
  return [
    {
      name: 'agent-run-costs',
      getSchema: () => [
        `CREATE TABLE IF NOT EXISTS agent_run_costs (
      run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
      state_json TEXT NOT NULL
    )`,
      ],
    },
  ];
}
