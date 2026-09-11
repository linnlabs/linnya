import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFileLocator } from '@app/schemas/file-locator';
import type {
  PluginDocumentImageAsset,
  PluginDocumentImageAssetRuntimePort,
} from '@plugin/backend/documentImageAsset';
import { PluginDocumentImageAssetError } from '@plugin/backend/documentImageAsset';
import type { ImageSourceRef } from '@plugin/slides/shared';
import type {
  BrushArtworkGeneratorPort,
  ImageSourceResolveContext,
  ImageSourceResolverPort,
} from '@plugin/slides/backend-engine-core';
import { createBrushArtworkMaterializationIdentity } from '../../../engine/brushArtwork';
import {
  normalizeBrushArtworkIntent,
  resolveBrushArtworkPixelSize,
  type BrushArtworkIntent,
  type BrushArtworkPixelSize,
  type BrushArtworkSourceRef,
} from '@plugin/slides/shared';
import type { PluginConversationFilePathResolverPort } from '@linnya/plugin-host-contract/backend/workspaceRuntime';
import type {
  PresentationImageBinding,
  PresentationImageBindingReaderPort,
  PresentationImageBindingRepositoryPort,
} from '../definitions/presentationImageBinding';
import {
  createPresentationBuildFailure,
  PresentationBuildFailureError,
  type PresentationBuildFailureCode,
} from '../../presentationBuildFailure';

const CONVERSATION_ROOT_ENV = 'LINNYA_CONVERSATION_ROOT';
const SLIDES_IMAGE_USAGE_HINT = 'slides:image';

export interface ConversationAwarePresentationImageSourceResolver extends ImageSourceResolverPort {
  bindConversationFilePathResolver(resolver: PluginConversationFilePathResolverPort): void;
}

export interface PresentationImageSourceResolverDependencies {
  readonly bindingRepository: PresentationImageBindingRepositoryPort;
  readonly documentImageAssets: PluginDocumentImageAssetRuntimePort;
  readonly conversationFilePathResolver?: PluginConversationFilePathResolverPort;
  readonly brushArtworkGenerator?: BrushArtworkGeneratorPort;
}

export interface ReadOnlyPresentationImageSourceResolverDependencies {
  readonly bindingReader: PresentationImageBindingReaderPort;
  readonly documentImageAssets: Pick<PluginDocumentImageAssetRuntimePort, 'readOwnedImage'>;
}

interface LocalImageCandidate {
  readonly sourceIdentity: string;
  readonly resolveSourcePath: () => Promise<string>;
}

interface DataUriImageCandidate {
  readonly sourceIdentity: string;
  readonly bytes: Uint8Array;
}

interface BrushArtworkCandidate extends BrushArtworkPixelSize {
  readonly intent: BrushArtworkIntent;
  readonly sourceIdentity: string;
}

function resolveBrushArtworkCandidate(
  source: BrushArtworkSourceRef,
  context: ImageSourceResolveContext | undefined,
): BrushArtworkCandidate {
  const targetSize = context?.targetSizeInches;
  if (!targetSize) {
    failImageResolution(
      'slides.brush.invalid_intent',
      'Brush artwork requires a resolved image width and height.',
    );
  }
  try {
    const intent = normalizeBrushArtworkIntent(source);
    const pixelSize = resolveBrushArtworkPixelSize(intent, targetSize);
    return {
      intent,
      ...pixelSize,
      sourceIdentity: createBrushArtworkMaterializationIdentity({ intent, ...pixelSize }),
    };
  } catch (error) {
    failImageResolution(
      'slides.brush.invalid_intent',
      error instanceof Error ? error.message : 'Brush artwork intent is invalid.',
    );
  }
}

function requireDocumentId(context?: ImageSourceResolveContext): string {
  const documentId = context?.documentId?.trim();
  if (!documentId) {
    failImageResolution(
      'slides.environment.workspace_unavailable',
      'Slides image resolution requires a presentation document id.'
    );
  }
  return documentId;
}

function resolveConversationRelativeImagePath(value: string): string | null {
  const conversationRoot = process.env[CONVERSATION_ROOT_ENV]?.trim();
  if (!conversationRoot || path.isAbsolute(value)) return null;

  const root = path.resolve(conversationRoot);
  const candidate = path.resolve(root, value);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    failImageResolution(
      'slides.asset.local_source_unavailable',
      'The conversation image path escapes the admitted conversation workspace.'
    );
  }
  return candidate;
}

function decodeImageDataUri(dataUri: string): DataUriImageCandidate {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/u.exec(dataUri);
  if (!match) {
    failImageResolution(
      'slides.asset.invalid_media',
      'Slides image data URI must use a media type and base64 encoding.'
    );
  }
  const payload = match[2].replace(/\s/gu, '');
  const bytes = Buffer.from(payload, 'base64');
  const canonicalPayload = bytes.toString('base64').replace(/=+$/u, '');
  if (bytes.byteLength === 0 || canonicalPayload !== payload.replace(/=+$/u, '')) {
    failImageResolution(
      'slides.asset.invalid_media',
      'Slides image data URI contains invalid base64 bytes.'
    );
  }
  return {
    sourceIdentity: `data_uri:${createHash('sha256').update(bytes).digest('hex')}`,
    bytes,
  };
}

function toDataUriRef(asset: PluginDocumentImageAsset): ImageSourceRef {
  return { kind: 'data_uri', dataUri: asset.dataUri };
}

function resolveGeneratedCandidate(
  assetId: string,
  context: ImageSourceResolveContext | undefined,
  conversationFilePathResolver: PluginConversationFilePathResolverPort | undefined
): LocalImageCandidate {
  if (path.isAbsolute(assetId)) {
    const sourcePath = path.resolve(assetId);
    return {
      sourceIdentity: `local_path:${sourcePath}`,
      resolveSourcePath: async () => sourcePath,
    };
  }

  if (assetId.includes(':')) {
    let locator: ReturnType<typeof parseFileLocator>;
    try {
      locator = parseFileLocator(assetId);
    } catch {
      failImageResolution(
        'slides.asset.local_source_unavailable',
        'The image source locator is invalid.'
      );
    }
    if (locator.kind === 'file') {
      const sourcePath = fileURLToPath(locator.url);
      return {
        sourceIdentity: `file:${locator.locator}`,
        resolveSourcePath: async () => sourcePath,
      };
    }
    if (locator.kind !== 'conversation') {
      failImageResolution(
        'slides.asset.local_source_unavailable',
        'Slides images accept local file or conversation locators, not a Workspace document locator.'
      );
    }
    return {
      sourceIdentity: `conversation:${locator.relativePath}`,
      resolveSourcePath: () =>
        resolveConversationImagePath(locator.relativePath, context, conversationFilePathResolver),
    };
  }

  return {
    sourceIdentity: `conversation:${assetId}`,
    resolveSourcePath: () =>
      resolveConversationImagePath(assetId, context, conversationFilePathResolver),
  };
}

async function readBoundImage(
  dependencies: {
    readonly bindingReader: PresentationImageBindingReaderPort;
    readonly documentImageAssets: Pick<PluginDocumentImageAssetRuntimePort, 'readOwnedImage'>;
  },
  input: {
    readonly presentationId: string;
    readonly sourceIdentity: string;
  }
): Promise<PluginDocumentImageAsset | null> {
  let binding: PresentationImageBinding | null;
  try {
    binding = dependencies.bindingReader.find(input);
  } catch {
    failImageResolution(
      'slides.asset.binding_conflict',
      'The presentation image binding could not be read.'
    );
  }
  if (!binding) return null;
  return runDocumentImageOperation(() =>
    dependencies.documentImageAssets.readOwnedImage({
      documentId: input.presentationId,
      assetId: binding.assetId,
    })
  );
}

export function createPresentationImageSourceResolver(
  dependencies: PresentationImageSourceResolverDependencies
): ConversationAwarePresentationImageSourceResolver {
  let conversationFilePathResolver = dependencies.conversationFilePathResolver;

  async function bindAdoptedImage(input: {
    readonly presentationId: string;
    readonly sourceIdentity: string;
    readonly adopted: PluginDocumentImageAsset;
  }): Promise<PluginDocumentImageAsset> {
    let binding: PresentationImageBinding;
    try {
      binding = dependencies.bindingRepository.bind({
        presentationId: input.presentationId,
        sourceIdentity: input.sourceIdentity,
        assetId: input.adopted.assetId,
      });
    } catch {
      failImageResolution(
        'slides.asset.binding_conflict',
        'The presentation image binding could not be committed.'
      );
    }
    if (binding.assetId === input.adopted.assetId) return input.adopted;
    return runDocumentImageOperation(() =>
      dependencies.documentImageAssets.readOwnedImage({
        documentId: input.presentationId,
        assetId: binding.assetId,
      })
    );
  }

  async function resolveLocalCandidate(
    presentationId: string,
    candidate: LocalImageCandidate
  ): Promise<ImageSourceRef> {
    const bound = await readBoundImage(
      {
        bindingReader: dependencies.bindingRepository,
        documentImageAssets: dependencies.documentImageAssets,
      },
      {
        presentationId,
        sourceIdentity: candidate.sourceIdentity,
      }
    );
    if (bound) return toDataUriRef(bound);
    let sourcePath: string;
    try {
      sourcePath = await candidate.resolveSourcePath();
    } catch (error) {
      // Resolver 自己已经给出的 build failure（例如 conversation admission 缺失）
      // 必须原样保留；这里只把未分类的物理路径异常归入 source unavailable。
      if (error instanceof PresentationBuildFailureError) throw error;
      failImageResolution(
        'slides.asset.local_source_unavailable',
        'The referenced local image could not be resolved.'
      );
    }
    const adopted = await runDocumentImageOperation(() =>
      dependencies.documentImageAssets.adoptLocalImage({
        documentId: presentationId,
        sourcePath,
        usageHint: SLIDES_IMAGE_USAGE_HINT,
      })
    );
    return toDataUriRef(
      await bindAdoptedImage({
        presentationId,
        sourceIdentity: candidate.sourceIdentity,
        adopted,
      })
    );
  }

  async function resolveDataUri(presentationId: string, dataUri: string): Promise<ImageSourceRef> {
    const candidate = decodeImageDataUri(dataUri);
    const bound = await readBoundImage(
      {
        bindingReader: dependencies.bindingRepository,
        documentImageAssets: dependencies.documentImageAssets,
      },
      {
        presentationId,
        sourceIdentity: candidate.sourceIdentity,
      }
    );
    if (bound) return toDataUriRef(bound);
    const adopted = await runDocumentImageOperation(() =>
      dependencies.documentImageAssets.adoptImageBytes({
        documentId: presentationId,
        bytes: candidate.bytes,
        usageHint: SLIDES_IMAGE_USAGE_HINT,
      })
    );
    return toDataUriRef(
      await bindAdoptedImage({
        presentationId,
        sourceIdentity: candidate.sourceIdentity,
        adopted,
      })
    );
  }

  async function resolveBrushArtwork(
    presentationId: string,
    source: BrushArtworkSourceRef,
    context: ImageSourceResolveContext | undefined,
  ): Promise<ImageSourceRef> {
    const candidate = resolveBrushArtworkCandidate(source, context);
    const bound = await readBoundImage(
      {
        bindingReader: dependencies.bindingRepository,
        documentImageAssets: dependencies.documentImageAssets,
      },
      { presentationId, sourceIdentity: candidate.sourceIdentity },
    );
    if (bound) return toDataUriRef(bound);
    if (!dependencies.brushArtworkGenerator) {
      failImageResolution(
        'slides.brush.render_failed',
        'The Slides Brush artwork generator is unavailable.',
      );
    }
    let generated;
    try {
      generated = await dependencies.brushArtworkGenerator.generateBrushArtwork({
        requestId: candidate.sourceIdentity,
        intent: candidate.intent,
        widthPx: candidate.widthPx,
        heightPx: candidate.heightPx,
      });
    } catch {
      failImageResolution(
        'slides.brush.render_failed',
        'The Slides Brush artwork could not be rendered.',
      );
    }
    const adopted = await runDocumentImageOperation(() =>
      dependencies.documentImageAssets.adoptImageBytes({
        documentId: presentationId,
        bytes: generated.bytes,
        usageHint: SLIDES_IMAGE_USAGE_HINT,
      })
    );
    return toDataUriRef(await bindAdoptedImage({
      presentationId,
      sourceIdentity: candidate.sourceIdentity,
      adopted,
    }));
  }

  return {
    bindConversationFilePathResolver(resolver): void {
      conversationFilePathResolver = resolver;
    },
    async resolveImageSource(source, context): Promise<ImageSourceRef> {
      if (source.kind === 'external_url') {
        failImageResolution(
          'slides.asset.external_url_not_supported',
          'Slides does not use remote image URLs.'
        );
      }
      const presentationId = requireDocumentId(context);
      if (source.kind === 'data_uri') {
        return resolveDataUri(presentationId, source.dataUri);
      }
      if (source.kind === 'local_path') {
        if (!path.isAbsolute(source.path)) {
          failImageResolution(
            'slides.asset.local_source_unavailable',
            'Slides local_path image references must use an absolute path.'
          );
        }
        const sourcePath = path.resolve(source.path);
        return resolveLocalCandidate(presentationId, {
          sourceIdentity: `local_path:${sourcePath}`,
          resolveSourcePath: async () => sourcePath,
        });
      }
      if (source.kind === 'brush_artwork') {
        return resolveBrushArtwork(presentationId, source, context);
      }
      return resolveLocalCandidate(
        presentationId,
        resolveGeneratedCandidate(source.assetId, context, conversationFilePathResolver)
      );
    },
  };
}

/**
 * 独立 CLI 的历史重放解析器。
 *
 * 它只读取已接管的图片；旧 revision 中已经自包含的 data URI 可以直接使用，但不会补写
 * ownership 或 binding。依赖外部文件的旧源码必须先在可写的应用流程中完成接管。
 */
export function createReadOnlyPresentationImageSourceResolver(
  dependencies: ReadOnlyPresentationImageSourceResolverDependencies
): ImageSourceResolverPort {
  async function requireBoundImage(
    presentationId: string,
    sourceIdentity: string
  ): Promise<ImageSourceRef> {
    const bound = await readBoundImage(dependencies, {
      presentationId,
      sourceIdentity,
    });
    if (bound) return toDataUriRef(bound);
    failImageResolution(
      'slides.asset.local_source_unavailable',
      'This historical image depends on a local source that has not been adopted by the presentation.'
    );
  }

  return {
    async resolveImageSource(source, context): Promise<ImageSourceRef> {
      if (source.kind === 'external_url') {
        failImageResolution(
          'slides.asset.external_url_not_supported',
          'Slides does not use remote image URLs.'
        );
      }
      const presentationId = requireDocumentId(context);
      if (source.kind === 'data_uri') {
        const candidate = decodeImageDataUri(source.dataUri);
        const bound = await readBoundImage(dependencies, {
          presentationId,
          sourceIdentity: candidate.sourceIdentity,
        });
        return bound ? toDataUriRef(bound) : source;
      }
      if (source.kind === 'local_path') {
        if (!path.isAbsolute(source.path)) {
          failImageResolution(
            'slides.asset.local_source_unavailable',
            'Slides local_path image references must use an absolute path.'
          );
        }
        return requireBoundImage(presentationId, `local_path:${path.resolve(source.path)}`);
      }
      if (source.kind === 'brush_artwork') {
        const candidate = resolveBrushArtworkCandidate(source, context);
        return requireBoundImage(
          presentationId,
          candidate.sourceIdentity,
        );
      }
      const candidate = resolveGeneratedCandidate(source.assetId, context, undefined);
      return requireBoundImage(presentationId, candidate.sourceIdentity);
    },
  };
}

async function resolveConversationImagePath(
  relativePath: string,
  context: ImageSourceResolveContext | undefined,
  resolver: PluginConversationFilePathResolverPort | undefined
): Promise<string> {
  if (resolver && context?.conversationId) {
    return resolver.resolveRelativePath({
      conversationId: context.conversationId,
      relativePath,
    });
  }
  const sourcePath = resolveConversationRelativeImagePath(relativePath);
  if (sourcePath) return sourcePath;
  failImageResolution(
    'slides.environment.workspace_unavailable',
    'No conversation file resolver is available for the referenced image.'
  );
}

function failImageResolution(code: PresentationBuildFailureCode, summary: string): never {
  throw new PresentationBuildFailureError(createPresentationBuildFailure({ code, summary }));
}

async function runDocumentImageOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PresentationBuildFailureError) throw error;
    if (!(error instanceof PluginDocumentImageAssetError)) {
      failImageResolution(
        'slides.asset.store_unavailable',
        'The managed image asset runtime is unavailable.'
      );
    }
    switch (error.failure) {
      case 'local_source_missing':
      case 'local_source_not_file':
      case 'local_source_unreadable':
        failImageResolution(
          'slides.asset.local_source_unavailable',
          'The referenced local image is missing, not a file, or unreadable.'
        );
      case 'invalid_media':
      case 'media_limit_exceeded':
        failImageResolution(
          'slides.asset.invalid_media',
          'The referenced image is invalid, unsupported, or exceeds the configured media limits.'
        );
      case 'asset_not_owned':
        failImageResolution(
          'slides.asset.ownership_denied',
          'The managed image is not owned by this presentation.'
        );
      case 'managed_asset_integrity_failed':
      case 'storage_conflict':
        failImageResolution(
          'slides.asset.binding_conflict',
          'The presentation image binding conflicts with managed asset facts.'
        );
      case 'managed_asset_unavailable':
      case 'store_unavailable':
        failImageResolution(
          'slides.asset.store_unavailable',
          'The managed image store is unavailable.'
        );
    }
  }
}
