import { promises as fs } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import {
  inspectImageBytes,
  type PluginImageInspectionResult,
} from '@plugin/backend/imageInspection';
import type {
  RenderAssetRef,
  RenderNode,
  SlideRenderModel,
} from '@plugin/slides/shared';
import { SLIDES_RASTER_MAX_OUTPUT_PIXELS } from '@plugin/slides/shared/slideRasterization';
import { SlidesPageRasterizationError } from '../definitions/presentationPageRasterization';
import {
  createPresentationImageDataUri,
  parsePresentationImageDataUri,
} from '../functions/presentationImageDataUri';
import { resolveEmbeddedImagePartPath } from '../functions/resolveEmbeddedImagePartPath';

const PAGE_RASTER_RESOURCE_POLICY = Object.freeze({
  maxImageBytes: 25 * 1024 * 1024,
  maxImagePixels: SLIDES_RASTER_MAX_OUTPUT_PIXELS,
});

export interface MaterializePresentationPageInput {
  readonly slide: SlideRenderModel;
  readonly sourcePackageBytes?: Uint8Array;
}

export async function materializePresentationPage(
  input: MaterializePresentationPageInput,
): Promise<SlideRenderModel> {
  const packageReader = new EmbeddedPackageImageReader(input.sourcePackageBytes);
  return {
    ...input.slide,
    background: {
      ...input.slide.background,
      imageSrc: input.slide.background.imageSrc
        ? await materializeRawSource(input.slide.background.imageSrc, packageReader)
        : undefined,
    },
    elements: await Promise.all(input.slide.elements.map(node => (
      materializeRenderNode(node, packageReader)
    ))),
  };
}

async function materializeRenderNode(
  node: RenderNode,
  packageReader: EmbeddedPackageImageReader,
): Promise<RenderNode> {
  if (node.kind === 'image') {
    return {
      ...node,
      assetRef: await materializeAssetRef(node.assetRef, packageReader),
    };
  }
  if (node.kind === 'group') {
    return {
      ...node,
      children: await Promise.all(node.children.map(child => (
        materializeRenderNode(child, packageReader)
      ))),
    };
  }
  return node;
}

async function materializeAssetRef(
  assetRef: RenderAssetRef,
  packageReader: EmbeddedPackageImageReader,
): Promise<RenderAssetRef> {
  switch (assetRef.type) {
    case 'data':
      return { type: 'data', dataUri: await inspectDataUri(assetRef.dataUri) };
    case 'embedded':
      return {
        type: 'data',
        dataUri: await materializeRawSource(assetRef.partPath, packageReader),
      };
    case 'external':
      throw resourceError('External image URLs are not allowed in page rasterization');
  }
}

async function materializeRawSource(
  source: string,
  packageReader: EmbeddedPackageImageReader,
): Promise<string> {
  if (source.startsWith('data:')) {
    return await inspectDataUri(source);
  }
  if (source.startsWith('http://') || source.startsWith('https://')) {
    throw resourceError('External image URLs are not allowed in page rasterization');
  }

  const bytes = path.isAbsolute(source)
    ? await readLocalImage(source)
    : await packageReader.read(source);
  const inspected = await inspectPresentationImage(bytes);
  return createPresentationImageDataUri(inspected.mediaType, bytes);
}

async function inspectDataUri(dataUri: string): Promise<string> {
  const parsed = parsePresentationImageDataUri(dataUri);
  const inspected = await inspectPresentationImage(parsed.bytes);
  if (inspected.mediaType !== parsed.declaredMediaType) {
    throw resourceError('Presentation image data URI media type does not match its bytes');
  }
  return createPresentationImageDataUri(inspected.mediaType, parsed.bytes);
}

async function readLocalImage(filePath: string): Promise<Uint8Array> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > PAGE_RASTER_RESOURCE_POLICY.maxImageBytes) {
      throw resourceError('Presentation local image is not a supported regular file');
    }
    return await fs.readFile(filePath);
  } catch (error) {
    if (error instanceof SlidesPageRasterizationError) {
      throw error;
    }
    throw resourceError('Presentation local image could not be read');
  }
}

async function inspectPresentationImage(
  bytes: Uint8Array,
): Promise<PluginImageInspectionResult> {
  if (bytes.byteLength > PAGE_RASTER_RESOURCE_POLICY.maxImageBytes) {
    throw resourceError('Presentation image exceeds the byte limit');
  }
  try {
    return await inspectImageBytes(bytes, {
      maxImagePixels: PAGE_RASTER_RESOURCE_POLICY.maxImagePixels,
    });
  } catch {
    throw resourceError('Presentation image failed integrity validation');
  }
}

class EmbeddedPackageImageReader {
  private packagePromise: Promise<JSZip> | null = null;

  constructor(private readonly sourcePackageBytes: Uint8Array | undefined) {}

  async read(partPath: string): Promise<Uint8Array> {
    if (!this.sourcePackageBytes) {
      throw resourceError('Presentation image requires a source presentation package');
    }
    const packagePath = resolveEmbeddedImagePartPath(partPath);
    const zip = await this.readPackage();
    const entry = zip.file(packagePath);
    if (!entry) {
      throw resourceError('Presentation embedded image part was not found');
    }
    const bytes = await entry.async('uint8array');
    if (bytes.byteLength > PAGE_RASTER_RESOURCE_POLICY.maxImageBytes) {
      throw resourceError('Presentation embedded image exceeds the byte limit');
    }
    return bytes;
  }

  private readPackage(): Promise<JSZip> {
    this.packagePromise ??= JSZip.loadAsync(this.sourcePackageBytes ?? new Uint8Array());
    return this.packagePromise;
  }
}

function resourceError(message: string): SlidesPageRasterizationError {
  return new SlidesPageRasterizationError('slides.page-raster.resource_load_failed', message);
}
