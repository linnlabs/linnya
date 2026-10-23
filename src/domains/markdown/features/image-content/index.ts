export {
  collectMarkdownImages,
  collectMarkdownImageSources,
  hydrateMarkdownDocumentImages,
  assertMarkdownImagesMaterialized,
} from './functions/markdownImages';
export type { MarkdownImageOwnershipPort } from './definitions/markdownImageOwnership';
export {
  bindMarkdownImageOwnership,
  getMarkdownImageOwnership,
} from './registry/markdownImageOwnershipRegistry';
export { collectImageAssetIds } from './functions/collectImageAssetIds';
