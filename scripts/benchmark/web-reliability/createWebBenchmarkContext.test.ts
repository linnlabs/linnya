import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { WebSearchResultSchema } from '@app/schemas';
import { resolveEvidenceFromBundles } from '../../../src/domains/evidence';
import { setWorkspaceRoot, resetWorkspaceRootToDefault } from '../../../src/shared/utils/pathManager';
import { WebSearchTool } from '../../../src/tools/web/websearch/WebSearchTool';
import { createWebBenchmarkContext } from './createWebBenchmarkContext';

it('独立基准装配正式引用与 Evidence 写入能力，产物可从临时目录回放', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya_web_benchmark_contract_'));
  setWorkspaceRoot(root);
  try {
    const conversationId = 'benchmark_admission';
    const instanceId = 'benchmark';
    const context = createWebBenchmarkContext({ conversationId, instanceId, turnId: 'round_1' });
    const output = await new WebSearchTool({
      provider: {
        name: 'fixture',
        async search() {
          return [{
            title: 'Source bulletin', url: 'https://example.com/bulletin',
            canonicalUrl: 'https://example.com/bulletin', snippet: 'Revised capacity is 83 GW.',
            query: 'capacity', provider: 'fixture', rank: 1, cached: false, latencyMs: 0,
          }];
        },
      },
    }).run({ query: 'capacity', top_k: 6 }, context);
    const result = WebSearchResultSchema.parse(JSON.parse(output));
    const refs = result.data.citations.citations.map(citation => citation.ref);
    expect(refs).toHaveLength(1);
    const evidence = await resolveEvidenceFromBundles({ conversationId, instanceId, refs, max_units: 100, max_chars: 100 });
    expect(evidence.missing_refs).toEqual([]);
    expect(evidence.conflicts).toEqual([]);
    expect(Object.values(evidence.resolved)[0]?.text).toBe('Revised capacity is 83 GW.');
  } finally {
    resetWorkspaceRootToDefault();
    await fs.rm(root, { recursive: true, force: true });
  }
});
