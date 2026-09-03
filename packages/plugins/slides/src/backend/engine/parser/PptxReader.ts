/**
 * PptxReader
 *
 * PPTX 解析编排层：
 * - 用 JSZip 解压 + xmldom 解析 OOXML
 * - 把具体的「字段提取」全部委托给 `parser/xml/*` 子模块（高内聚低耦合）
 * - 自身只负责：presentation/slide-level glue（rels 映射、slide 列表、layout 名）+ EditableTarget 注入
 *
 * 单位 / 语义契约见 ai-ppt §4.4 / §4.5：所有 inches、pt、°、行高倍率均在子模块内固定，
 * 主类直接消费已经单位化的 `SlideElementInfo / ThemeInfo / MasterInfo`。
 */

import JSZip from 'jszip';
import { DOMParser, type Document as XmlDocument } from '@xmldom/xmldom';
import { resolveSlideSizeInches, type EditableOperation, type EditableTarget } from '@plugin/slides/shared';
import type {
  PresentationInfo,
  SlideElementInfo,
  SlideElementImportFidelity,
  SlideElementSvgGraphicInfo,
  SlideInfo,
} from '@plugin/slides/shared';
import { SvgGraphicAdmissionError } from '@plugin/slides/shared';
import { emuToInches } from '@plugin/backend/textMeasurement';
import {
  buildRelMap,
  getAttr,
  getElementByTag,
  getElements,
  getElementsByLocalName,
} from './xml/XmlNode.js';
import {
  parseSlideElements,
  type SlidePictureResourceContext,
} from './xml/SlideElementParser.js';
import { parseSlideBackgroundPaint } from './xml/ShapeVisualParser.js';
import {
  parseMasters,
  parseTheme,
  type ReadXml,
} from './xml/ThemeMasterParser.js';
import { admitSvgGraphic } from '../svgGraphic';
import { resolvePptxPartTarget } from '../pptx/pptxPartPath';

export class PptxReader {
  private parser = new DOMParser();

  /** 解析 PPTX 文件 */
  async parse(buffer: Buffer): Promise<PresentationInfo> {
    const zip = await JSZip.loadAsync(buffer);

    // 闭包出 readXml 给 ThemeMasterParser / 内部使用，避免它们直接持有 zip / DOMParser
    const readXml: ReadXml = (path) => this.readXml(zip, path);

    const presentationXml = await readXml('ppt/presentation.xml');
    if (!presentationXml) {
      throw new Error('Invalid PPTX: missing ppt/presentation.xml');
    }

    const presRels = await readXml('ppt/_rels/presentation.xml.rels');
    const slideSize = this.parseSlideSize(presentationXml);
    const relMap = presRels ? buildRelMap(presRels) : new Map<string, string>();
    const theme = await parseTheme(readXml, relMap);
    const slideRefs = this.parseSlideRefs(presentationXml, relMap);

    const slides: SlideInfo[] = [];
    for (let i = 0; i < slideRefs.length; i++) {
      const ref = slideRefs[i];
      const slideXml = await readXml(`ppt/${ref.target}`);
      if (!slideXml) continue;

      const slideRelsPath = `ppt/slides/_rels/${ref.target.split('/').pop()}.rels`;
      const slideRels = await readXml(slideRelsPath);
      const slideRelMap = slideRels ? buildRelMap(slideRels) : new Map<string, string>();

      const layoutName = await this.resolveLayoutName(readXml, slideRelMap);
      const pictureResources = await this.readSlidePictureResources(
        zip,
        slideXml,
        slideRelMap,
        `ppt/${ref.target}`,
      );
      const elements = parseSlideElements(slideXml, slideRelMap, theme, pictureResources);
      const enrichedElements = elements.map((element) =>
        this.attachEditableTargets(i + 1, element),
      );

      slides.push({
        number: i + 1,
        layoutName,
        backgroundPaint: parseSlideBackgroundPaint(slideXml),
        elements: enrichedElements,
      });
    }

    const masters = await parseMasters(readXml, relMap);

    return {
      slideCount: slides.length,
      slideSize,
      slides,
      theme,
      masters,
    };
  }

  // ─── 内部方法 ──────────────────────────────────────────────────────────

  /** 从 zip 读取一个 XML 文件并解析为 XmlDocument，缺失返回 null。 */
  private async readXml(zip: JSZip, path: string): Promise<XmlDocument | null> {
    const file = zip.file(path);
    if (!file) return null;
    const text = await file.async('text');
    return this.parser.parseFromString(text, 'application/xml');
  }

  private async readSlidePictureResources(
    zip: JSZip,
    slideDoc: XmlDocument,
    slideRelMap: ReadonlyMap<string, string>,
    slidePartPath: string,
  ): Promise<SlidePictureResourceContext> {
    const svgGraphicsByRelationshipId = new Map<string, SlideElementSvgGraphicInfo>();
    const svgFailureReasonsByRelationshipId = new Map<
      string,
      SlideElementImportFidelity['reason']
    >();
    for (const svgBlip of getElementsByLocalName(slideDoc, 'svgBlip')) {
      const relationshipId = getAttr(svgBlip, 'r:embed');
      if (
        !relationshipId
        || svgGraphicsByRelationshipId.has(relationshipId)
        || svgFailureReasonsByRelationshipId.has(relationshipId)
      ) continue;
      const target = slideRelMap.get(relationshipId);
      if (!target) {
        svgFailureReasonsByRelationshipId.set(relationshipId, 'unavailable_svg');
        continue;
      }
      let sourcePartPath: string;
      try {
        sourcePartPath = resolvePptxPartTarget(slidePartPath, target);
      } catch {
        svgFailureReasonsByRelationshipId.set(relationshipId, 'unavailable_svg');
        continue;
      }
      const file = zip.file(sourcePartPath);
      if (!file) {
        svgFailureReasonsByRelationshipId.set(relationshipId, 'unavailable_svg');
        continue;
      }
      try {
        const admission = admitSvgGraphic(await file.async('text'));
        svgGraphicsByRelationshipId.set(relationshipId, {
          sourcePartPath,
          canonicalSvg: admission.canonicalSvg,
          contentHash: admission.contentHash,
          viewBox: admission.viewBox,
          fit: 'stretch',
          decorative: true,
        });
      } catch (error) {
        svgFailureReasonsByRelationshipId.set(
          relationshipId,
          error instanceof SvgGraphicAdmissionError
            ? 'unsupported_svg'
            : 'unavailable_svg',
        );
      }
    }
    return { svgGraphicsByRelationshipId, svgFailureReasonsByRelationshipId };
  }

  /** 提取 slide 物理尺寸（inches），缺失时按 16:9 默认。 */
  private parseSlideSize(doc: XmlDocument): { width: number; height: number } {
    const sldSz = getElementByTag(doc, 'p:sldSz');
    if (sldSz) {
      const cx = parseInt(getAttr(sldSz, 'cx') ?? '0', 10);
      const cy = parseInt(getAttr(sldSz, 'cy') ?? '0', 10);
      return { width: emuToInches(cx), height: emuToInches(cy) };
    }
    return resolveSlideSizeInches('16x9');
  }

  /** 按 sldIdLst 顺序解析 slide 列表，并通过 relMap 映射到具体路径。 */
  private parseSlideRefs(
    doc: XmlDocument,
    relMap: Map<string, string>,
  ): Array<{ relId: string; target: string }> {
    const refs: Array<{ relId: string; target: string }> = [];
    const sldIdLst = getElementByTag(doc, 'p:sldIdLst');
    if (!sldIdLst) return refs;

    const sldIds = getElements(sldIdLst, 'p:sldId');
    for (const sldId of sldIds) {
      const rId = getAttr(sldId, 'r:id');
      if (!rId) continue;
      const target = relMap.get(rId);
      if (target) refs.push({ relId: rId, target });
    }
    return refs;
  }

  /** 从 slide rels 里找 layout 引用并取其显示名。 */
  private async resolveLayoutName(
    readXml: ReadXml,
    slideRelMap: Map<string, string>,
  ): Promise<string | undefined> {
    for (const [, target] of slideRelMap) {
      if (target.includes('slideLayout')) {
        const layoutPath = target.startsWith('../')
          ? `ppt/${target.replace('../', '')}`
          : `ppt/slides/${target}`;
        const layoutDoc = await readXml(layoutPath);
        if (layoutDoc) {
          const cSld = getElementByTag(layoutDoc, 'p:cSld');
          if (cSld) {
            const name = getAttr(cSld, 'name');
            if (name) return name;
          }
        }
      }
    }
    return undefined;
  }

  /** 给单个元素挂上 editableTarget，并递归处理 group 子元素。 */
  private attachEditableTargets(
    slideNumber: number,
    element: SlideElementInfo,
  ): SlideElementInfo {
    return {
      ...element,
      editableTarget: this.buildEditableTarget(slideNumber, element),
      children: element.children?.map((child) => this.attachEditableTargets(slideNumber, child)),
    };
  }

  /** 根据元素类型决定 editor 暴露的可编辑能力。 */
  private buildEditableTarget(
    slideNumber: number,
    element: SlideElementInfo,
  ): EditableTarget | undefined {
    const operations = this.resolveEditableOperations(element.type);
    if (operations.length === 0) {
      return undefined;
    }

    return {
      slideNumber,
      elementId: element.elementId,
      creationId: element.creationId,
      elementName: element.name,
      operations,
      imageEditCapabilities: element.type === 'image'
        ? { replaceSource: true, editVisuals: false }
        : undefined,
    };
  }

  /** 各元素类型支持的编辑动作矩阵（与 tooling 层契约保持一致）。 */
  private resolveEditableOperations(type: SlideElementInfo['type']): EditableOperation[] {
    switch (type) {
      case 'text':
        return ['modify_text', 'modify_style', 'modify_geometry', 'reorder_layer'];
      case 'shape':
        return ['modify_style', 'modify_geometry', 'reorder_layer'];
      case 'image':
        return ['edit_image', 'modify_geometry', 'reorder_layer'];
      case 'svgGraphic':
      case 'formula':
        return ['modify_geometry', 'reorder_layer'];
      case 'chart':
        return ['update_chart', 'modify_geometry', 'reorder_layer'];
      case 'table':
        return ['update_table', 'modify_geometry', 'reorder_layer'];
      case 'group':
      case 'other':
        return [];
    }
  }
}
