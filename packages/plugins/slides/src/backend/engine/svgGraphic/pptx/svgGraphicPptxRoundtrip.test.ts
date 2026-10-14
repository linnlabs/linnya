import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { Group } from 'konva/lib/Group';
import type { Box, DeckSpec, SvgGraphicFit, SvgGraphicRenderNode } from '@plugin/slides/shared';
import {
  buildSvgGraphicGroupConfig,
  resolveSvgGraphicFitConfig,
} from '../../../../renderer/features/svgGraphicRendering';
import {
  collectRenderNodeSelectionGeometries,
  findRenderNodeSelectionGeometryAtPoint,
} from '../../../../renderer/features/renderNodeSelection';
import { DeckAssembler } from '../../DeckAssembler';
import { FreeformCompiler } from '../../FreeformCompiler';
import { StructuredCompiler } from '../../StructuredCompiler';
import type {
  SvgGraphicAssetResolverPort,
  SvgGraphicFallbackRasterizerPort,
} from '../../types';
import { PptxReader } from '../../parser/PptxReader';
import { CanonicalBuilder } from '../../parser/CanonicalBuilder';
import { RenderModelMapper } from '../../parser/RenderModelMapper';
import { getElementByLocalName } from '../../parser/xml/XmlNode';
import { admitSvgGraphic } from '../admission/admitSvgGraphic';

const authoredSvg = '<svg viewBox="0 0 100 50"><path d="M0 25L100 25" stroke="#2563EB" stroke-width="4"/></svg>';
const admittedSvg = admitSvgGraphic(authoredSvg);
const canonicalSvg = admittedSvg.canonicalSvg;
const contentHash = admittedSvg.contentHash;
const fallbackPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X0Y5WQAAAABJRU5ErkJggg==',
  'base64',
);
const alternateFallbackPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

interface SvgPlacement {
  position: Box;
  fit: SvgGraphicFit;
  rotate: number;
}

async function assembleSvgDeck(placement?: SvgPlacement): Promise<Buffer> {
  const assetRef = {
    kind: 'owned_svg' as const,
    assetId: 'svg-asset-1',
    contentHash,
    byteLength: Buffer.byteLength(canonicalSvg),
    viewBox: { width: 100, height: 50 },
  };
  const deckSpec: DeckSpec = {
    title: 'SVG roundtrip',
    slides: [{
      slideNumber: 1,
      spec: {
        type: 'freeform',
        elements: [{
          type: 'svgGraphic',
          asset: assetRef,
          position: placement?.position ?? { x: 1, y: 1, w: 6, h: 3 },
          fit: placement?.fit ?? 'contain',
          rotate: placement?.rotate,
          altText: '蓝色流程线',
        }],
      },
    }],
  };
  const resolver: SvgGraphicAssetResolverPort = {
    async resolveSvgGraphicAsset() {
      return { ...assetRef, canonicalSvg };
    },
  };
  const rasterizer: SvgGraphicFallbackRasterizerPort = {
    async rasterizeSvgGraphic() {
      return { pngBytes: fallbackPng, widthPx: 1, heightPx: 1 };
    },
  };
  return new DeckAssembler(
    new StructuredCompiler(),
    new FreeformCompiler(),
    undefined,
    undefined,
    resolver,
    rasterizer,
  ).assemble(deckSpec);
}

describe('SVG Graphic PPTX compatibility roundtrip', () => {
  const placements: SvgPlacement[] = [
    { position: { x: 1, y: 1, w: 4, h: 4 }, fit: 'contain', rotate: 0 },
    { position: { x: 1, y: 1, w: 4, h: 4 }, fit: 'contain', rotate: 90 },
    { position: { x: 2, y: 1, w: 6, h: 2 }, fit: 'contain', rotate: 37 },
    { position: { x: 2, y: 1, w: 4, h: 3 }, fit: 'stretch', rotate: -30 },
  ];

  it.each(placements)('keeps preview, selection and PPTX aligned for $fit / $rotate degrees', async placement => {
    const info = await new PptxReader().parse(await assembleSvgDeck(placement));
    const exported = info.slides[0]?.elements[0];
    if (!exported?.position) throw new Error('SVG PPTX position missing');
    const node: SvgGraphicRenderNode = {
      id: 'svg-rotation', kind: 'svgGraphic', zIndex: 0,
      box: { ...placement.position, unit: 'in' },
      canonicalSvg, contentHash, viewBox: admittedSvg.viewBox,
      fit: placement.fit, rotation: placement.rotate, decorative: true,
    };
    const group = new Group(buildSvgGraphicGroupConfig(node));
    const fit = resolveSvgGraphicFitConfig(node);
    const box = exported.position;
    const angle = (exported.rotation ?? 0) * Math.PI / 180;
    // 从真实 OOXML 回读尺寸/角度，独立按 Office 的中心旋转求四角；不能只比 rotate 字段。
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const preview = group.getTransform().point({ x: fit.x + u * fit.width, y: fit.y + v * fit.height });
      const dx = (u - 0.5) * box.w;
      const dy = (v - 0.5) * box.h;
      expect(preview.x / 96).toBeCloseTo(box.x + box.w / 2 + dx * Math.cos(angle) - dy * Math.sin(angle), 5);
      expect(preview.y / 96).toBeCloseTo(box.y + box.h / 2 + dx * Math.sin(angle) + dy * Math.cos(angle), 5);
    }

    const [selection] = collectRenderNodeSelectionGeometries([node], candidate => candidate.kind === 'svgGraphic');
    if (!selection) throw new Error('SVG selection missing');
    for (const [index, corner] of [[0, 0], [1, 0], [1, 1], [0, 1]].entries()) {
      const visible = group.getTransform().point({ x: corner[0] * node.box.w * 96, y: corner[1] * node.box.h * 96 });
      expect(selection.polygon[index]?.x).toBeCloseTo(visible.x / 96, 5);
      expect(selection.polygon[index]?.y).toBeCloseTo(visible.y / 96, 5);
    }
    expect(findRenderNodeSelectionGeometryAtPoint(
      [node], { x: box.x + box.w / 2, y: box.y + box.h / 2 }, candidate => candidate.kind === 'svgGraphic',
    )?.elementId).toBe(node.id);

    const canonical = new CanonicalBuilder().build('rotated-svg', 1, 'SVG rotation', info);
    const imported = new RenderModelMapper().fromCanonicalDeck(canonical, { title: 'SVG rotation', slides: [] }, 'imported')
      .slides[0]?.elements[0];
    if (imported?.kind !== 'svgGraphic') throw new Error('SVG did not survive PPTX roundtrip');
    const importedGroup = new Group(buildSvgGraphicGroupConfig(imported));
    const importedFit = resolveSvgGraphicFitConfig(imported);
    const reimported = importedGroup.getTransform().point({ x: importedFit.x, y: importedFit.y });
    const original = group.getTransform().point({ x: fit.x, y: fit.y });
    expect(reimported.x).toBeCloseTo(original.x, 4);
    expect(reimported.y).toBeCloseTo(original.y, 4);
  });

  it('writes admitted SVG plus the real PNG fallback and restores canonical render semantics', async () => {
    const buffer = await assembleSvgDeck();
    const zip = await JSZip.loadAsync(buffer);
    const svgPath = Object.keys(zip.files).find(path => path.endsWith('.svg'));
    const pngParts = Object.keys(zip.files).filter(path => path.endsWith('.png'));
    expect(svgPath).toBeDefined();
    expect(await zip.file(svgPath ?? '')?.async('text')).toBe(canonicalSvg);
    await expect(Promise.all(pngParts.map(async path => (
      await zip.file(path)?.async('nodebuffer')
    )))).resolves.toContainEqual(fallbackPng);

    const info = await new PptxReader().parse(buffer);
    expect(info.slides[0].elements[0]).toMatchObject({
      type: 'svgGraphic',
      svgGraphic: {
        canonicalSvg,
        contentHash,
        viewBox: { width: 100, height: 50 },
        fit: 'stretch',
        altText: '蓝色流程线',
        decorative: false,
      },
    });

    const canonical = new CanonicalBuilder().build('imported-svg', 1, 'SVG roundtrip', info);
    const renderModel = new RenderModelMapper().fromCanonicalDeck(
      canonical,
      { title: 'SVG roundtrip', slides: [] },
      'imported',
    );
    expect(renderModel.slides[0].elements[0]).toMatchObject({
      kind: 'svgGraphic',
      canonicalSvg,
      contentHash,
      altText: '蓝色流程线',
    });
  });

  it('keeps different SVG assets on independent fallback media parts', async () => {
    const secondSvg = '<svg viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="#DC2626"/></svg>';
    const assets = [canonicalSvg, secondSvg].map((svg, index) => {
      const admitted = admitSvgGraphic(svg);
      return {
        kind: 'owned_svg' as const,
        assetId: `svg-asset-${index + 1}`,
        contentHash: admitted.contentHash,
        byteLength: Buffer.byteLength(admitted.canonicalSvg),
        viewBox: admitted.viewBox,
        canonicalSvg: admitted.canonicalSvg,
      };
    });
    const deckSpec: DeckSpec = {
      title: 'two SVG assets',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'freeform',
          elements: assets.map((asset, index) => ({
            type: 'svgGraphic' as const,
            asset,
            position: { x: 1 + index * 4, y: 1, w: 3, h: 2 },
            fit: 'stretch' as const,
            decorative: true as const,
          })),
        },
      }],
    };
    const buffer = await new DeckAssembler(
      new StructuredCompiler(),
      new FreeformCompiler(),
      undefined,
      undefined,
      {
        async resolveSvgGraphicAsset(ref) {
          const asset = assets.find(candidate => candidate.assetId === ref.assetId);
          if (!asset) throw new Error('test asset missing');
          return asset;
        },
      },
      {
        async rasterizeSvgGraphic(input) {
          const pngBytes = input.contentHash === assets[0].contentHash
            ? fallbackPng
            : alternateFallbackPng;
          return { pngBytes, widthPx: 1, heightPx: 1 };
        },
      },
    ).assemble(deckSpec);
    const zip = await JSZip.loadAsync(buffer);
    const pngParts = await Promise.all(
      Object.keys(zip.files)
        .filter(path => path.endsWith('.png'))
        .map(async path => zip.file(path)?.async('nodebuffer')),
    );
    expect(pngParts).toContainEqual(fallbackPng);
    expect(pngParts).toContainEqual(alternateFallbackPng);
    const info = await new PptxReader().parse(buffer);
    expect(info.slides[0].elements.map(element => element.type)).toEqual([
      'svgGraphic',
      'svgGraphic',
    ]);
  });

  it('uses an explicit raster fallback for unsupported external SVG', async () => {
    const zip = await JSZip.loadAsync(await assembleSvgDeck());
    const svgPath = Object.keys(zip.files).find(path => path.endsWith('.svg'));
    if (!svgPath) throw new Error('test SVG part missing');
    zip.file(svgPath, '<svg viewBox="0 0 100 50"><text x="1" y="20">unsupported</text></svg>');

    const info = await new PptxReader().parse(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(info.slides[0].elements[0]).toMatchObject({
      type: 'image',
      importFidelity: {
        status: 'raster-fallback',
        reason: 'unsupported_svg',
      },
    });
  });

  it('restores admitted SVG when PowerPoint removes the raster relationship', async () => {
    const zip = await JSZip.loadAsync(await assembleSvgDeck());
    const slideFile = zip.file('ppt/slides/slide1.xml');
    if (!slideFile) throw new Error('test slide part missing');
    const parser = new DOMParser();
    const slideDoc = parser.parseFromString(await slideFile.async('text'), 'application/xml');
    const fallbackBlip = getElementByLocalName(slideDoc, 'blip');
    if (!fallbackBlip) throw new Error('test fallback blip missing');
    fallbackBlip.setAttribute('r:embed', '');
    zip.file('ppt/slides/slide1.xml', new XMLSerializer().serializeToString(slideDoc));

    const info = await new PptxReader().parse(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(info.slides[0].elements[0]).toMatchObject({
      type: 'svgGraphic',
      svgGraphic: { canonicalSvg, contentHash },
    });
  });

  it('rejects an unsupported SVG picture when no raster fallback remains', async () => {
    const zip = await JSZip.loadAsync(await assembleSvgDeck());
    const svgPath = Object.keys(zip.files).find(path => path.endsWith('.svg'));
    const slideFile = zip.file('ppt/slides/slide1.xml');
    if (!svgPath || !slideFile) throw new Error('test SVG package parts missing');
    zip.file(svgPath, '<svg viewBox="0 0 100 50"><text x="1" y="20">unsupported</text></svg>');
    const parser = new DOMParser();
    const slideDoc = parser.parseFromString(await slideFile.async('text'), 'application/xml');
    const fallbackBlip = getElementByLocalName(slideDoc, 'blip');
    if (!fallbackBlip) throw new Error('test fallback blip missing');
    fallbackBlip.setAttribute('r:embed', '');
    zip.file('ppt/slides/slide1.xml', new XMLSerializer().serializeToString(slideDoc));

    await expect(new PptxReader().parse(
      await zip.generateAsync({ type: 'nodebuffer' }),
    )).rejects.toThrow('has no usable vector or raster media');
  });
});
