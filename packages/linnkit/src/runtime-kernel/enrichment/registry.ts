/**
 * @file src/agent/runtime-kernel/enrichment/registry.ts
 * @description 请求增强器注册表
 */

import { RequestEnricher, EnrichmentContext, RegistryEnrichmentResult } from './types';
import { Logger } from '../../shared/logger';

class RequestEnricherRegistry {
  private enrichers: RequestEnricher[] = [];
  private readonly logger = new Logger('RequestEnricherRegistry');

  /**
   * 注册增强器
   */
  register(enricher: RequestEnricher) {
    // 避免重复注册
    if (!this.enrichers.find(e => e.name === enricher.name)) {
      this.enrichers.push(enricher);
      this.logger.debug('Registered enricher', { name: enricher.name });
    }
  }

  snapshot(): readonly string[] {
    return this.enrichers.map((enricher) => enricher.name);
  }

  reset(): void {
    this.enrichers = [];
  }

  /**
   * 执行所有适用的增强器
   * - 按注册顺序串行执行（后续增强器基于前序结果继续增强）
   */
  async enrich(context: EnrichmentContext): Promise<RegistryEnrichmentResult> {
    const { conversationId } = context;
    let currentRequest = context.request;
    let currentRunContext = context.runContext;
    const combinedToolContextPatch: Record<string, unknown> = {};

    for (const enricher of this.enrichers) {
      if (enricher.isApplicable(currentRequest)) {
        try {
          const result = await enricher.enrich({
            conversationId,
            request: currentRequest,
            runContext: currentRunContext
          });

          // 1. 更新 Request
          currentRequest = result.request;

          // 2. 累积 ToolContext Patch
          if (result.toolContextPatch) {
            Object.assign(combinedToolContextPatch, result.toolContextPatch);
          }

          // 3. 更新 RunContext (如果业务层修正了 traceId 等)
          if (result.runContextPatch) {
            currentRunContext = {
              ...currentRunContext,
              ...result.runContextPatch,
              tags: {
                ...currentRunContext.tags,
                ...(result.runContextPatch.tags || {})
              }
            };
          }
        } catch (error) {
          this.logger.error('Enricher failed', {
            name: enricher.name,
            error: error instanceof Error ? error.message : String(error),
          });
          // 策略：单个增强器失败通常意味着业务不可行，应该抛出异常阻断流程
          throw error;
        }
      }
    }

    return {
      request: currentRequest,
      toolContextPatch: combinedToolContextPatch,
      runContext: currentRunContext // 返回最终的 runContext
    };
  }
}

// 单例导出
export const requestEnricherRegistry = new RequestEnricherRegistry();
