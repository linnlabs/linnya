import type {
  LocalImageAssetLedgerPort,
  RegisteredLocalImageAsset,
} from '../definitions/localImageAssetRegistration';
import { prepareLocalImageAssetFacts } from './prepareLocalImageAssetFacts';

export async function registerLocalImageAsset(params: {
  readonly sourcePath: string;
  readonly createdAt?: string;
  readonly maxImagePixels: number;
  readonly ledger: LocalImageAssetLedgerPort;
}): Promise<RegisteredLocalImageAsset> {
  const facts = await prepareLocalImageAssetFacts(params);
  return params.ledger.registerLocalImage(facts);
}
