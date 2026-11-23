import type { ModelCatalogGateway } from '../features/model-catalog';
import { httpModelCatalogGateway } from '../features/model-catalog/infrastructure/httpModelCatalogGateway';

/**
 * 删除前要提醒的影响：有几个定时任务指定了这个模型。读不到时返回 0，
 * 照常确认删除，不因为这一步失败挡住用户。
 */
export async function readModelRemovalScheduledTaskCount(
  modelId: string,
  gateway: ModelCatalogGateway = httpModelCatalogGateway,
): Promise<number> {
  try {
    return (await gateway.readRemovalImpact?.(modelId))?.scheduledTaskCount ?? 0;
  } catch (error: unknown) {
    console.warn(`[ModelConfiguration] 读取模型 ${modelId} 的删除影响失败`, error);
    return 0;
  }
}
