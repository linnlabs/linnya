import JSZip from 'jszip';
import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from '@xmldom/xmldom';
import { applyPptxGradientFills } from '../visual/pptxGradientPostProcessor';
import { applyPptxPaintPatches } from '../visual/pptxPaintPostProcessor';
import type { PptxPaintPatchPlan } from '../visual/pptxPaintPatchPlan';
import type { ThemeSpec } from '@plugin/slides/shared';
import { applyDeclaredThemeFonts } from './applyDeclaredThemeFonts';
import { applySvgGraphicPptxFallbacks } from '../svgGraphic/pptx/applySvgGraphicPptxFallbacks';
import type { SvgGraphicPptxFallbackPlanEntry } from '../svgGraphic/pptx/svgGraphicPptxPlan';
import { applyFormulaPptxPatches } from '../mathFormula/pptx/applyFormulaPptxPatches';
import type { FormulaPptxPatchPlan } from '../mathFormula/pptx/formulaPptxPlan';

export interface PptxPackageSanitizeOptions {
  readonly paintPlan?: PptxPaintPatchPlan;
  readonly declaredThemeFonts?: NonNullable<ThemeSpec['fonts']>;
  readonly svgGraphicFallbacks?: readonly SvgGraphicPptxFallbackPlanEntry[];
  readonly formulaPlan?: FormulaPptxPatchPlan;
}

/**
 * PptxPackageSanitizer
 *
 * 清理 PptxGenJS / pptx-automizer 产出的常见 OOXML 包问题，
 * 尤其是重复或悬空的 [Content_Types].xml overrides。
 */
export class PptxPackageSanitizer {
  private readonly parser = new DOMParser();
  private readonly serializer = new XMLSerializer();

  async sanitize(buffer: Buffer, options: PptxPackageSanitizeOptions = {}): Promise<Buffer> {
    const zip = await JSZip.loadAsync(buffer);
    const contentTypesFile = zip.file('[Content_Types].xml');
    if (!contentTypesFile) {
      return buffer;
    }

    const xml = await contentTypesFile.async('text');
    const doc = this.parser.parseFromString(xml, 'application/xml');
    const types = doc.documentElement;
    if (!types) {
      return buffer;
    }

    const existingParts = new Set(Object.keys(zip.files));
    const seenDefaults = new Set<string>();
    const seenOverrides = new Set<string>();
    const toRemove: XmlElement[] = [];
    let mutated = false;

    for (let i = 0; i < types.childNodes.length; i++) {
      const child = types.childNodes.item(i);
      if (!child || child.nodeType !== 1) {
        continue;
      }

      const element = child as XmlElement;
      if (element.tagName.endsWith('Default')) {
        const extension = element.getAttribute('Extension') ?? '';
        if (seenDefaults.has(extension)) {
          toRemove.push(element);
        } else {
          seenDefaults.add(extension);
        }
        continue;
      }

      if (element.tagName.endsWith('Override')) {
        const partName = element.getAttribute('PartName') ?? '';
        const normalizedPart = normalizePartName(partName);

        if (seenOverrides.has(normalizedPart) || !existingParts.has(normalizedPart)) {
          toRemove.push(element);
        } else {
          seenOverrides.add(normalizedPart);
        }
      }
    }

    if (toRemove.length > 0) {
      mutated = true;
      for (const element of toRemove) {
        element.parentNode?.removeChild(element);
      }

      zip.file('[Content_Types].xml', this.serializer.serializeToString(doc));
    }

    const idMutated = await this.normalizePartObjectIds(zip);
    mutated = mutated || idMutated;
    const paintMutated = await applyPptxPaintPatches(zip, options.paintPlan);
    mutated = mutated || paintMutated;
    // 兼容尚未迁移的历史 marker 文件；新编译链只走内存 Paint plan。
    const gradientMutated = await applyPptxGradientFills(zip);
    mutated = mutated || gradientMutated;
    const themeFontMutated = await applyDeclaredThemeFonts(zip, options.declaredThemeFonts);
    mutated = mutated || themeFontMutated;
    const svgFallbackMutated = await applySvgGraphicPptxFallbacks(
      zip,
      options.svgGraphicFallbacks,
    );
    mutated = mutated || svgFallbackMutated;
    const formulaMutated = await applyFormulaPptxPatches(zip, options.formulaPlan);
    mutated = mutated || formulaMutated;

    if (!mutated) {
      return buffer;
    }

    return zip.generateAsync({ type: 'nodebuffer' });
  }

  private async normalizePartObjectIds(zip: JSZip): Promise<boolean> {
    const partFiles = Object.keys(zip.files).filter((file) => (
      /^ppt\/slides\/slide\d+\.xml$/.test(file)
      || /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(file)
      || /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(file)
      || /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(file)
      || /^ppt\/notesMasters\/notesMaster\d+\.xml$/.test(file)
    ));

    let mutated = false;
    for (const path of partFiles) {
      const file = zip.file(path);
      if (!file) continue;

      const xml = await file.async('text');
      const doc = this.parser.parseFromString(xml, 'application/xml');
      const next = dedupeNonVisualIds(doc);
      if (!next.changed) continue;

      mutated = true;
      zip.file(path, this.serializer.serializeToString(doc));
    }

    return mutated;
  }
}

function normalizePartName(partName: string): string {
  return partName.startsWith('/') ? partName.slice(1) : partName;
}

function dedupeNonVisualIds(doc: XmlDocument): { changed: boolean } {
  const elements = [
    ...Array.from(doc.getElementsByTagName('p:cNvPr')),
    ...Array.from(doc.getElementsByTagName('cNvPr')),
  ] as XmlElement[];

  if (elements.length === 0) {
    return { changed: false };
  }

  let changed = false;
  let nextId = 1;
  for (const element of elements) {
    const id = element.getAttribute('id');
    if (id !== String(nextId)) {
      element.setAttribute('id', String(nextId));
      changed = true;
    }
    nextId += 1;
  }

  return { changed };
}
