import type { CanonicalLlmUsage, TokenRoute } from '../contracts';

/**
 * 可选 usage 归一化端口。
 *
 * host 若不想在 adapter response 里直接回传 canonicalUsage，可集中注入该端口；
 * linnkit 只定义协议，不在这里放 provider family 规则。
 */
export interface UsageNormalizer {
  normalize(input: {
    route: TokenRoute;
    rawUsage: unknown;
  }): CanonicalLlmUsage | undefined;
}
