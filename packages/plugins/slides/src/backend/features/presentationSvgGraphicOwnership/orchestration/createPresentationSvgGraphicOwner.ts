import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { parseFileLocator } from '@app/schemas/file-locator';
import type {
  PluginDocumentSvgAsset,
  PluginDocumentSvgAssetRuntimePort,
} from '@plugin/backend/documentSvgAsset';
import { PluginDocumentSvgAssetError } from '@plugin/backend/documentSvgAsset';
import {
  DEFAULT_SVG_GRAPHIC_ADMISSION_POLICY,
  SvgGraphicAdmissionError,
  type SvgGraphicAdmissionReport,
  type SvgGraphicAuthoringSource,
  type SvgGraphicOwnedAssetRef,
  type SvgGraphicResolvedAsset,
} from '@plugin/slides/shared/svgGraphic';
import type { PluginConversationFilePathResolverPort } from '@linnya/plugin-host-contract/backend/workspaceRuntime';
import { admitSvgGraphic } from '../../../engine/svgGraphic';
import {
  createPresentationBuildFailure,
  PresentationBuildFailureError,
  type PresentationBuildFailureCode,
} from '../../presentationBuildFailure';
import type {
  ConversationAwarePresentationSvgGraphicOwnerPort,
  PresentationSvgGraphicAssetReaderPort,
  PresentationSvgGraphicBinding,
  PresentationSvgGraphicBindingReaderPort,
  PresentationSvgGraphicOwnerPort,
  PresentationSvgGraphicBindingRepositoryPort,
  SvgGraphicAssetReadContext,
  SvgGraphicOwnershipContext,
} from '../definitions/presentationSvgGraphicBinding';

const SLIDES_SVG_USAGE_HINT = 'slides:svg-graphic';
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export interface PresentationSvgGraphicOwnerDependencies {
  readonly bindingRepository: PresentationSvgGraphicBindingRepositoryPort;
  readonly documentSvgAssets: PluginDocumentSvgAssetRuntimePort;
  readonly conversationFilePathResolver?: PluginConversationFilePathResolverPort;
}

export interface PresentationSvgGraphicAssetReaderDependencies {
  readonly documentSvgAssets: PluginDocumentSvgAssetRuntimePort;
}

interface ExternalSvgCandidate {
  readonly sourceIdentity: string;
  readonly resolveSourcePath: () => Promise<string>;
}

function failSvgOwnership(code: PresentationBuildFailureCode, summary: string): never {
  throw new PresentationBuildFailureError(createPresentationBuildFailure({ code, summary }));
}

function requireDocumentId(
  context: SvgGraphicOwnershipContext | SvgGraphicAssetReadContext | undefined
): string {
  const documentId = context?.documentId?.trim() ?? '';
  if (!documentId) {
    failSvgOwnership(
      'slides.environment.workspace_unavailable',
      'Slides SVG Graphic ownership requires a presentation document id.'
    );
  }
  return documentId;
}

function assertAssetMatchesRef(
  asset: PluginDocumentSvgAsset,
  ref: SvgGraphicOwnedAssetRef
): void {
  if (
    asset.assetId !== ref.assetId
    || asset.sha256 !== ref.contentHash
    || asset.byteLength !== ref.byteLength
  ) {
    failSvgOwnership(
      'slides.svg.binding_conflict',
      'The managed SVG Graphic conflicts with the presentation asset reference.'
    );
  }
}

function toOwnedAssetRef(binding: PresentationSvgGraphicBinding): SvgGraphicOwnedAssetRef {
  return {
    kind: 'owned_svg',
    assetId: binding.assetId,
    contentHash: binding.contentHash,
    byteLength: binding.byteLength,
    viewBox: binding.viewBox,
  };
}

function assertAssetMatchesBinding(
  asset: PluginDocumentSvgAsset,
  binding: PresentationSvgGraphicBinding
): void {
  if (
    asset.assetId !== binding.assetId ||
    asset.sha256 !== binding.contentHash ||
    asset.byteLength !== binding.byteLength
  ) {
    failSvgOwnership(
      'slides.svg.binding_conflict',
      'The presentation SVG Graphic binding conflicts with managed asset facts.'
    );
  }
}

function assertAssetMatchesAdmission(
  asset: PluginDocumentSvgAsset,
  admission: SvgGraphicAdmissionReport
): void {
  if (
    asset.sha256 !== admission.contentHash ||
    asset.byteLength !== admission.metrics.bytes ||
    asset.canonicalSvg !== admission.canonicalSvg
  ) {
    failSvgOwnership(
      'slides.svg.binding_conflict',
      'The adopted SVG Graphic conflicts with the admitted canonical content.'
    );
  }
}

async function readBoundAsset(
  dependencies: { readonly bindingRepository: PresentationSvgGraphicBindingReaderPort; readonly documentSvgAssets: Pick<PluginDocumentSvgAssetRuntimePort, 'readOwnedSvg'> },
  input: { readonly presentationId: string; readonly sourceIdentity: string }
): Promise<SvgGraphicOwnedAssetRef | null> {
  let binding: PresentationSvgGraphicBinding | null;
  try {
    binding = dependencies.bindingRepository.find(input);
  } catch {
    failSvgOwnership(
      'slides.svg.binding_conflict',
      'The presentation SVG Graphic binding could not be read.'
    );
  }
  if (!binding) return null;
  const asset = await runDocumentSvgOperation(() =>
    dependencies.documentSvgAssets.readOwnedSvg({
      documentId: input.presentationId,
      assetId: binding.assetId,
    })
  );
  assertAssetMatchesBinding(asset, binding);
  return toOwnedAssetRef(binding);
}

function resolveConversationCandidate(
  locatorValue: string,
  context: SvgGraphicOwnershipContext,
  resolver: PluginConversationFilePathResolverPort | undefined
): ExternalSvgCandidate {
  if (!locatorValue.includes(':')) {
    return {
      sourceIdentity: `conversation:${locatorValue}`,
      resolveSourcePath: () => resolveConversationPath(locatorValue, context, resolver),
    };
  }

  let locator: ReturnType<typeof parseFileLocator>;
  try {
    locator = parseFileLocator(locatorValue);
  } catch {
    failSvgOwnership('slides.svg.source_unavailable', 'The SVG Graphic source locator is invalid.');
  }
  if (locator.kind === 'file') {
    let sourcePath: string;
    try {
      sourcePath = fileURLToPath(locator.url);
    } catch {
      failSvgOwnership('slides.svg.source_unavailable', 'The SVG Graphic file locator is invalid.');
    }
    return {
      sourceIdentity: `file:${locator.locator}`,
      resolveSourcePath: async () => sourcePath,
    };
  }
  if (locator.kind !== 'conversation') {
    failSvgOwnership(
      'slides.svg.source_unavailable',
      'SVG Graphic sources accept conversation or local file locators, not Workspace locators.'
    );
  }
  return {
    sourceIdentity: `conversation:${locator.relativePath}`,
    resolveSourcePath: () => resolveConversationPath(locator.relativePath, context, resolver),
  };
}

async function resolveConversationPath(
  relativePath: string,
  context: SvgGraphicOwnershipContext,
  resolver: PluginConversationFilePathResolverPort | undefined
): Promise<string> {
  const conversationId = context.conversationId?.trim();
  if (!resolver || !conversationId) {
    failSvgOwnership(
      'slides.environment.workspace_unavailable',
      'No conversation file resolver is available for the referenced SVG Graphic.'
    );
  }
  return resolver.resolveRelativePath({ conversationId, relativePath });
}

function resolveExternalCandidate(
  source: Exclude<SvgGraphicAuthoringSource, { readonly kind: 'inline_svg' }>,
  context: SvgGraphicOwnershipContext,
  resolver: PluginConversationFilePathResolverPort | undefined
): ExternalSvgCandidate {
  if (source.kind === 'local_path') {
    if (!path.isAbsolute(source.path)) {
      failSvgOwnership(
        'slides.svg.source_unavailable',
        'Slides local_path SVG Graphic references must use an absolute path.'
      );
    }
    const sourcePath = path.resolve(source.path);
    return {
      sourceIdentity: `local_path:${sourcePath}`,
      resolveSourcePath: async () => sourcePath,
    };
  }
  return resolveConversationCandidate(source.locator, context, resolver);
}

async function readAdmittedSvg(sourcePath: string): Promise<SvgGraphicAdmissionReport> {
  try {
    const stats = await lstat(sourcePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      failSvgOwnership(
        'slides.svg.source_unavailable',
        'The referenced SVG Graphic source is not a regular file.'
      );
    }
    if (stats.size > DEFAULT_SVG_GRAPHIC_ADMISSION_POLICY.maxBytes) {
      failSvgOwnership(
        'slides.svg.resource_limit_exceeded',
        'The referenced SVG Graphic exceeds the configured byte budget.'
      );
    }
    const bytes = await readFile(sourcePath);
    return admitSvgGraphic(UTF8_DECODER.decode(bytes));
  } catch (error) {
    if (error instanceof PresentationBuildFailureError) throw error;
    if (error instanceof SvgGraphicAdmissionError) {
      failSvgOwnership(error.code, 'The referenced SVG Graphic failed canonical admission.');
    }
    failSvgOwnership(
      'slides.svg.source_unavailable',
      'The referenced SVG Graphic is missing, unreadable, or not valid UTF-8.'
    );
  }
}

function admitInlineSvg(svg: string): SvgGraphicAdmissionReport {
  try {
    return admitSvgGraphic(svg);
  } catch (error) {
    if (error instanceof SvgGraphicAdmissionError) {
      failSvgOwnership(error.code, 'The inline SVG Graphic failed canonical admission.');
    }
    throw error;
  }
}

async function runDocumentSvgOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PresentationBuildFailureError) throw error;
    if (!(error instanceof PluginDocumentSvgAssetError)) {
      failSvgOwnership(
        'slides.svg.store_unavailable',
        'The managed SVG Graphic asset runtime is unavailable.'
      );
    }
    switch (error.failure) {
      case 'invalid_canonical_content':
      case 'managed_asset_integrity_failed':
      case 'storage_conflict':
        failSvgOwnership(
          'slides.svg.binding_conflict',
          'The presentation SVG Graphic binding conflicts with managed asset facts.'
        );
      case 'content_limit_exceeded':
        failSvgOwnership(
          'slides.svg.resource_limit_exceeded',
          'The SVG Graphic exceeds the managed asset content budget.'
        );
      case 'asset_not_owned':
        failSvgOwnership(
          'slides.svg.ownership_denied',
          'The managed SVG Graphic is not owned by this presentation.'
        );
      case 'managed_asset_unavailable':
      case 'store_unavailable':
        failSvgOwnership(
          'slides.svg.store_unavailable',
          'The managed SVG Graphic store is unavailable.'
        );
    }
  }
}

export function createReadOnlyPresentationSvgGraphicAssetResolver(
  dependencies: PresentationSvgGraphicAssetReaderDependencies
): PresentationSvgGraphicAssetReaderPort {
  return {
    async resolveSvgGraphicAsset(ref, context): Promise<SvgGraphicResolvedAsset> {
      const documentId = requireDocumentId(context);
      const asset = await runDocumentSvgOperation(() =>
        dependencies.documentSvgAssets.readOwnedSvg({ documentId, assetId: ref.assetId })
      );
      assertAssetMatchesRef(asset, ref);
      return {
        ...ref,
        canonicalSvg: asset.canonicalSvg,
      };
    },
  };
}

export function createPresentationSvgGraphicOwner(
  dependencies: PresentationSvgGraphicOwnerDependencies
): ConversationAwarePresentationSvgGraphicOwnerPort {
  let conversationFilePathResolver = dependencies.conversationFilePathResolver;
  const assetReader = createReadOnlyPresentationSvgGraphicAssetResolver(dependencies);

  async function adoptAndBind(input: {
    readonly presentationId: string;
    readonly sourceIdentity: string;
    readonly admission: SvgGraphicAdmissionReport;
  }): Promise<SvgGraphicOwnedAssetRef> {
    const adopted = await runDocumentSvgOperation(() =>
      dependencies.documentSvgAssets.adoptCanonicalSvg({
        documentId: input.presentationId,
        canonicalSvg: input.admission.canonicalSvg,
        contentHash: input.admission.contentHash,
        usageHint: SLIDES_SVG_USAGE_HINT,
      })
    );
    assertAssetMatchesAdmission(adopted, input.admission);

    let binding: PresentationSvgGraphicBinding;
    try {
      binding = dependencies.bindingRepository.bind({
        presentationId: input.presentationId,
        sourceIdentity: input.sourceIdentity,
        assetId: adopted.assetId,
        contentHash: input.admission.contentHash,
        byteLength: input.admission.metrics.bytes,
        viewBox: input.admission.viewBox,
      });
    } catch {
      failSvgOwnership(
        'slides.svg.binding_conflict',
        'The presentation SVG Graphic binding could not be committed.'
      );
    }
    if (binding.assetId === adopted.assetId) {
      assertAssetMatchesBinding(adopted, binding);
      return toOwnedAssetRef(binding);
    }
    const winner = await runDocumentSvgOperation(() =>
      dependencies.documentSvgAssets.readOwnedSvg({
        documentId: input.presentationId,
        assetId: binding.assetId,
      })
    );
    assertAssetMatchesBinding(winner, binding);
    return toOwnedAssetRef(binding);
  }

  return {
    bindConversationFilePathResolver(resolver): void {
      conversationFilePathResolver = resolver;
    },
    async ownSource(source, context): Promise<SvgGraphicOwnedAssetRef> {
      const presentationId = requireDocumentId(context);
      if (source.kind === 'inline_svg') {
        const admission = admitInlineSvg(source.svg);
        const sourceIdentity = `inline_svg:${admission.contentHash}`;
        const bound = await readBoundAsset(dependencies, { presentationId, sourceIdentity });
        return bound ?? adoptAndBind({ presentationId, sourceIdentity, admission });
      }

      const candidate = resolveExternalCandidate(source, context, conversationFilePathResolver);
      const bound = await readBoundAsset(dependencies, {
        presentationId,
        sourceIdentity: candidate.sourceIdentity,
      });
      if (bound) return bound;

      let sourcePath: string;
      try {
        sourcePath = await candidate.resolveSourcePath();
      } catch (error) {
        if (error instanceof PresentationBuildFailureError) throw error;
        failSvgOwnership(
          'slides.svg.source_unavailable',
          'The referenced SVG Graphic source could not be resolved.'
        );
      }
      const admission = await readAdmittedSvg(sourcePath);
      return adoptAndBind({
        presentationId,
        sourceIdentity: candidate.sourceIdentity,
        admission,
      });
    },
    resolveSvgGraphicAsset: assetReader.resolveSvgGraphicAsset,
  };
}

/** 历史 authoring 只解析已接管来源，绝不访问原路径或新建 binding。 */
export function createReadOnlyPresentationSvgGraphicOwner(dependencies: {
  readonly bindingRepository: PresentationSvgGraphicBindingReaderPort;
  readonly documentSvgAssets: Pick<PluginDocumentSvgAssetRuntimePort, 'readOwnedSvg'>;
}): PresentationSvgGraphicOwnerPort {
  return {
    async ownSource(source, context) {
      const sourceIdentity = source.kind === 'inline_svg'
        ? `inline_svg:${admitInlineSvg(source.svg).contentHash}`
        : resolveExternalCandidate(source, context, undefined).sourceIdentity;
      const owned = await readBoundAsset(dependencies, { presentationId: context.documentId, sourceIdentity });
      if (!owned) failSvgOwnership('slides.svg.source_unavailable', 'Historical SVG source has no owned binding.');
      return owned;
    },
  };
}
