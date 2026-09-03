import { Router, type Request, type Response } from 'express';
import { providerCatalog } from '@linnya/provider-catalog';

function readSingleQuery(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('query 必须是单个字符串');
  return value;
}

function readProviderId(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** Provider Catalog 的只读 HTTP adapter，不在路由层复制目录或实现查询规则。 */
export function createProviderCatalogRouter(): Router {
  const router = Router();

  router.get('/', (request: Request, response: Response) => {
    let query: string | undefined;
    try {
      query = readSingleQuery(request.query.q);
    } catch (error) {
      response.status(400).json({
        code: 'provider_catalog.invalid_query',
        message: error instanceof Error ? error.message : '查询参数无效',
      });
      return;
    }

    const providers = query === undefined ? providerCatalog.list() : providerCatalog.search(query);
    response.json({
      generation: providerCatalog.generation,
      providers,
      total: providers.length,
    });
  });

  router.get('/:providerDefinitionId', (request: Request, response: Response) => {
    const providerDefinitionId = readProviderId(request.params.providerDefinitionId);
    const provider = providerDefinitionId
      ? providerCatalog.get(providerDefinitionId)
      : undefined;
    if (!provider) {
      response.status(404).json({ code: 'provider_catalog.provider_not_found' });
      return;
    }

    response.json({ generation: providerCatalog.generation, provider });
  });

  return router;
}
