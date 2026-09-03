import { describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fsp } from 'fs';

import { KnowledgeSearchTool } from '../KnowledgeSearchTool';
import type { ToolContext } from '../../../types';
import {
  setWorkspaceRoot,
  resetWorkspaceRootToDefault,
} from '../../../../shared/utils/pathManager';
import type { KnowledgeBaseService } from '../../../../features/knowledge-base/application/knowledgeBaseService';
import type { SubRunTracePublisher } from '@linnlabs/linnkit/runtime-kernel';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { KnowledgeSearchResultSchema } from '@app/schemas';
import { attachCitationRefAllocator, attachCitationSequence } from '../../../../domains/citation';
import { createCitationRefAllocatorFixture } from '../../../../domains/citation/testkit/citationRefAllocatorFixture';

class MockKnowledgeBaseService implements KnowledgeBaseService {
  // 中文备注：deep_search 测试只要求 knowledgeBaseService “存在”，不会真正调用其方法；
  // 这里实现完整接口，避免使用 any/unknown 断言，也避免未来接口变更导致测试静默失真。
  async createKnowledgeBase(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async getAllKnowledgeBases(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async getOrCreateDefaultKnowledgeBase(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async addDocument(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async getDocumentsInKnowledgeBase(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async getDocumentById(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async getTasksStatus(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async cancelTask(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async pauseTask(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async resumeTask(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async deleteDocument(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async continueFailedPdfPages(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async deleteKnowledgeBase(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async updateKnowledgeBaseSettings(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async search(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async searchKnowledgeBase(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async searchInDocument(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async searchRawResults(): Promise<Array<Record<string, unknown>>> {
    // 中文备注：测试里不会实际调用，返回空数组即可。
    return [];
  }
  async searchForAgent(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async searchForAgentAcrossKnowledgeBases(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async getGraphAugmentationsForEvidenceBlocks(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async getRawSoTDocument(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async getSoTDocumentForAgent(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async getSoTTableForAgent(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
  async getDocumentContent(): Promise<never> {
    throw new Error('MockKnowledgeBaseService: not implemented');
  }
}

vi.mock('../deep/runDeepSearch', async () => {
  return {
    DeepSearchFailedError: class DeepSearchFailedError extends Error {},
    runDeepSearch: async () => {
      return {
        data: {
          query: 'q',
          search_strategy: 'deep',
          subrun_id: 'subrun_test',
          search_mode: 'global',
          doc_name: null,
          citations: {
            query: 'q',
            searchMode: 'global',
            citations: [
              {
                ref: 'Abc234',
                index: 1,
                sourceType: 'knowledge_base',
                docId: 'd1',
                blockId: 'b1',
                docTitle: 'docA',
                snippet: 's',
              },
            ],
          },
        },
        observation: 'X'.repeat(60000),
      };
    },
  };
});

describe('knowledge_search: deep_search canonical result', () => {
  it('deep_search 应直接返回完整结果结构，而不是退化成 bundle 指针', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_search_evidence_'));
    setWorkspaceRoot(tmpRoot);

    try {
      const tool = new KnowledgeSearchTool();

      const ctx: ToolContext = {
        conversationId: 'conv_test',
        turnId: 'turn_test',
        parentToolCallId: ToolCallIdSchema.parse('call_1'),
        // deep_search 会读取 knowledgeBaseService 来保证工具链完整，这里注入一个最小 stub
        knowledgeBaseService: new MockKnowledgeBaseService(),
        createSubRunTracePublisher: (): SubRunTracePublisher => {
          return {
            publish: () => {},
          };
        },
      };
      attachCitationSequence(ctx, { offset: 0 });
      attachCitationRefAllocator(ctx, createCitationRefAllocatorFixture());

      const out = await tool.run({ query: 'q', top_k: 5, deep_search: true }, ctx);
      const parsed = KnowledgeSearchResultSchema.parse(JSON.parse(out) as unknown);
      expect(parsed.data.citations.citations).toHaveLength(1);
      expect(parsed.data.search_strategy).toBe('deep');

      // ✅ deep_search 不应指针化：不应包含 citation_snapshot_bundle_id
      expect('citation_snapshot_bundle_id' in parsed.data).toBe(false);
    } finally {
      resetWorkspaceRootToDefault();
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
