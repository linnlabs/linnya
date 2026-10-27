import type { BackendPluginCliExecutionContext } from '@linnya/plugin-host-contract/backend/pluginCli';
import type { PluginChildRunDeliveryReader } from '@linnya/plugin-host-contract/backend/childRunDelivery';
export type {
  PluginChildRunDelivery, PluginChildRunDeliveryReader, PluginDocumentObservation, PluginChildRunStatus,
} from '@linnya/plugin-host-contract/backend/childRunDelivery';
export { DocumentObservationUnavailableError } from '../../app-hosts/linnya/adapters/child-runs/delivery/documentObservationError';

/** Loader 只装配 facade；VFS/工具 runtime 在实际调用时加载，避免循环初始化。 */
export async function createChildRunDeliveryReader(context: BackendPluginCliExecutionContext): Promise<PluginChildRunDeliveryReader> {
  const { createChildRunDeliveryReader: create } = await import('../../app-hosts/linnya/adapters/child-runs/delivery/createChildRunDeliveryReader');
  return create(context);
}
