export type {
  LocalImageAssetFacts,
  LocalImageAssetLedgerPort,
  LocalImageAssetRegistrationErrorCode,
  RegisteredLocalImageAsset,
} from './definitions/localImageAssetRegistration';
export { LocalImageAssetRegistrationError } from './definitions/localImageAssetRegistration';
export { createSqliteLocalImageAssetLedger } from './infrastructure/sqlite/createSqliteLocalImageAssetLedger';
