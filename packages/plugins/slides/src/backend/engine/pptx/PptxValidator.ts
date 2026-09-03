/**
 * PptxValidator
 *
 * PPTX 低层结构验证器：检查 OOXML 包的完整性与一致性。
 * 纯函数式设计，不依赖外部状态，只接收 Buffer 输出验证结果。
 */

import JSZip from 'jszip';
import { DOMParser, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom';

// ─── 输出类型 ──────────────────────────────────────────────────────────────

export interface PptxStructureInfo {
  slideCount: number;
  hasContentTypes: boolean;
  hasPresentation: boolean;
  hasPresentationRels: boolean;
  slideFiles: string[];
  masterFiles: string[];
  layoutFiles: string[];
  themeFiles: string[];
  orphanedRels: string[];
  duplicateOverrides: string[];
  missingOverrideParts: string[];
  duplicateObjectIds: string[];
}

export interface PptxValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  structure: PptxStructureInfo;
}

// ─── 验证器 ────────────────────────────────────────────────────────────────

export class PptxValidator {
  private readonly parser = new DOMParser();

  async validate(buffer: Buffer): Promise<PptxValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const structure: PptxStructureInfo = {
      slideCount: 0,
      hasContentTypes: false,
      hasPresentation: false,
      hasPresentationRels: false,
      slideFiles: [],
      masterFiles: [],
      layoutFiles: [],
      themeFiles: [],
      orphanedRels: [],
      duplicateOverrides: [],
      missingOverrideParts: [],
      duplicateObjectIds: [],
    };

    // 1. 尝试解压
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch {
      errors.push('Not a valid ZIP archive');
      return { valid: false, errors, warnings, structure };
    }

    const allFiles = new Set(Object.keys(zip.files));

    // 2. [Content_Types].xml
    structure.hasContentTypes = allFiles.has('[Content_Types].xml');
    if (!structure.hasContentTypes) {
      errors.push('Missing [Content_Types].xml');
    } else {
      const dupes = await this.checkContentTypeDuplicates(zip);
      const missingOverrideParts = await this.checkMissingOverrideParts(zip, allFiles);
      structure.duplicateOverrides = dupes;
      structure.missingOverrideParts = missingOverrideParts;
      if (dupes.length > 0) {
        warnings.push(`Duplicate Content_Types overrides: ${dupes.join(', ')}`);
      }
      if (missingOverrideParts.length > 0) {
        errors.push(`Content_Types overrides reference missing parts: ${missingOverrideParts.join(', ')}`);
      }
    }

    // 3. presentation.xml
    structure.hasPresentation = allFiles.has('ppt/presentation.xml');
    if (!structure.hasPresentation) {
      errors.push('Missing ppt/presentation.xml');
      return { valid: false, errors, warnings, structure };
    }

    const presXml = await this.readXml(zip, 'ppt/presentation.xml');
    if (!presXml) {
      errors.push('ppt/presentation.xml is not valid XML');
      return { valid: false, errors, warnings, structure };
    }

    // 4. presentation.xml.rels
    structure.hasPresentationRels = allFiles.has('ppt/_rels/presentation.xml.rels');
    if (!structure.hasPresentationRels) {
      errors.push('Missing ppt/_rels/presentation.xml.rels');
    }

    // 5. 解析 slide 列表
    const slideRefs = this.parseSlideRefs(presXml, zip, structure);
    structure.slideCount = slideRefs.length;

    // 6. 先收集 slide/master/layout/theme 文件，再验证 slide 本体
    await this.collectPartFiles(zip, allFiles, structure);

    // 7. 验证每个 slide 文件
    for (const slideFile of structure.slideFiles) {
      const fullPath = slideFile.startsWith('ppt/') ? slideFile : `ppt/${slideFile}`;
      if (!allFiles.has(fullPath)) {
        errors.push(`Missing slide file: ${fullPath}`);
        continue;
      }
      const slideText = await this.readText(zip, fullPath);
      if (slideText == null) {
        errors.push(`Unable to read slide: ${fullPath}`);
        continue;
      }
      const slideDoc = await this.readXml(zip, fullPath);
      if (!slideDoc) {
        errors.push(`Invalid XML in slide: ${fullPath}`);
        continue;
      }
      this.validateSlideStructure(slideDoc, slideText, fullPath, errors, structure);
    }

    // 8. 检查 rels 引用完整性
    if (structure.hasPresentationRels) {
      const orphaned = await this.checkOrphanedRels(zip, allFiles);
      structure.orphanedRels = orphaned;
      if (orphaned.length > 0) {
        errors.push(`Orphaned rels targets: ${orphaned.join(', ')}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      structure,
    };
  }

  // ─── 内部方法 ──────────────────────────────────────────────────────────

  private async readXml(zip: JSZip, path: string): Promise<XmlDocument | null> {
    const text = await this.readText(zip, path);
    if (text == null) return null;
    try {
      return this.parser.parseFromString(text, 'application/xml');
    } catch {
      return null;
    }
  }

  private async readText(zip: JSZip, path: string): Promise<string | null> {
    const file = zip.file(path);
    if (!file) return null;
    try {
      return await file.async('text');
    } catch {
      return null;
    }
  }

  private async checkContentTypeDuplicates(zip: JSZip): Promise<string[]> {
    const doc = await this.readXml(zip, '[Content_Types].xml');
    if (!doc) return [];

    const seen = new Set<string>();
    const duplicates: string[] = [];
    const types = doc.documentElement;
    if (!types) return [];

    for (let i = 0; i < types.childNodes.length; i++) {
      const child = types.childNodes.item(i);
      if (!child || child.nodeType !== 1) continue;
      const el = child as XmlElement;

      if (el.tagName.endsWith('Override')) {
        const partName = el.getAttribute('PartName') ?? '';
        if (seen.has(partName)) {
          duplicates.push(partName);
        } else {
          seen.add(partName);
        }
      }
    }
    return duplicates;
  }

  private async checkMissingOverrideParts(
    zip: JSZip,
    allFiles: Set<string>,
  ): Promise<string[]> {
    const doc = await this.readXml(zip, '[Content_Types].xml');
    if (!doc) return [];

    const missing: string[] = [];
    const types = doc.documentElement;
    if (!types) return [];

    for (let i = 0; i < types.childNodes.length; i++) {
      const child = types.childNodes.item(i);
      if (!child || child.nodeType !== 1) continue;
      const el = child as XmlElement;

      if (!el.tagName.endsWith('Override')) {
        continue;
      }

      const partName = el.getAttribute('PartName') ?? '';
      const normalized = partName.startsWith('/') ? partName.slice(1) : partName;
      if (!allFiles.has(normalized)) {
        missing.push(partName);
      }
    }

    return missing;
  }

  private parseSlideRefs(
    presDoc: XmlDocument,
    zip: JSZip,
    structure: PptxStructureInfo,
  ): string[] {
    const refs: string[] = [];
    const sldIdLst = presDoc.getElementsByTagName('p:sldIdLst');
    if (sldIdLst.length === 0) return refs;

    const sldIds = sldIdLst.item(0)!.getElementsByTagName('p:sldId');
    // 我们需要 rels 来解析 slide 文件路径，但即使没有 rels 也要统计数量
    for (let i = 0; i < sldIds.length; i++) {
      const rId = (sldIds.item(i) as XmlElement).getAttribute('r:id');
      if (rId) refs.push(rId);
    }

    // 尝试从 rels 解析实际文件路径
    const relsFile = zip.file('ppt/_rels/presentation.xml.rels');
    if (relsFile) {
      // 异步操作在这里不方便，我们在 validate() 中单独处理
      // 这里先记录 ref count
    }

    return refs;
  }

  private validateSlideStructure(
    slideDoc: XmlDocument,
    slideXml: string,
    path: string,
    errors: string[],
    structure: PptxStructureInfo,
  ): void {
    const sld = slideDoc.getElementsByTagName('p:sld');
    if (sld.length === 0) {
      errors.push(`${path}: missing <p:sld> root element`);
      return;
    }
    const cSld = slideDoc.getElementsByTagName('p:cSld');
    if (cSld.length === 0) {
      errors.push(`${path}: missing <p:cSld>`);
      return;
    }
    const spTree = slideDoc.getElementsByTagName('p:spTree');
    if (spTree.length === 0) {
      errors.push(`${path}: missing <p:spTree>`);
    }

    const duplicateIds = this.findDuplicateObjectIds(slideXml);
    if (duplicateIds.length > 0) {
      structure.duplicateObjectIds.push(`${path}: ${duplicateIds.join(', ')}`);
      errors.push(`${path}: duplicate object ids (${duplicateIds.join(', ')})`);
    }
  }

  private async collectPartFiles(
    zip: JSZip,
    allFiles: Set<string>,
    structure: PptxStructureInfo,
  ): Promise<void> {
    // 从 presentation.xml.rels 解析 slide/master 文件路径
    const relsDoc = await this.readXml(zip, 'ppt/_rels/presentation.xml.rels');
    if (!relsDoc) return;

    const rels = relsDoc.getElementsByTagName('Relationship');
    for (let i = 0; i < rels.length; i++) {
      const rel = rels.item(i) as XmlElement;
      const type = rel.getAttribute('Type') ?? '';
      const target = rel.getAttribute('Target') ?? '';
      const fullPath = target.startsWith('/') ? target.substring(1) : `ppt/${target}`;

      if (type.endsWith('/slide')) {
        structure.slideFiles.push(fullPath);
      } else if (type.endsWith('/slideMaster')) {
        structure.masterFiles.push(fullPath);
      }
    }

    // 收集 layout 和 theme 文件
    for (const filePath of Array.from(allFiles)) {
      if (filePath.startsWith('ppt/slideLayouts/') && filePath.endsWith('.xml') && !filePath.includes('_rels')) {
        structure.layoutFiles.push(filePath);
      }
      if (filePath.startsWith('ppt/theme/') && filePath.endsWith('.xml') && !filePath.includes('_rels')) {
        structure.themeFiles.push(filePath);
      }
    }
  }

  private async checkOrphanedRels(
    zip: JSZip,
    allFiles: Set<string>,
  ): Promise<string[]> {
    const orphaned: string[] = [];
    const relFiles = Object.keys(zip.files).filter((file) => file.endsWith('.rels'));

    for (const relPath of relFiles) {
      const relsDoc = await this.readXml(zip, relPath);
      if (!relsDoc) continue;

      const rels = relsDoc.getElementsByTagName('Relationship');
      for (let i = 0; i < rels.length; i++) {
        const rel = rels.item(i) as XmlElement;
        const target = rel.getAttribute('Target') ?? '';
        const type = rel.getAttribute('Type') ?? '';
        const targetMode = rel.getAttribute('TargetMode') ?? '';

        if (!target || targetMode === 'External') continue;
        if (target.startsWith('http://') || target.startsWith('https://')) continue;
        if (type.includes('printerSettings') || type.includes('/hyperlink')) continue;

        const fullPath = resolveRelsTarget(relPath, target);
        if (!allFiles.has(fullPath)) {
          orphaned.push(`${relPath} -> ${fullPath}`);
        }
      }
    }

    return orphaned;
  }

  private findDuplicateObjectIds(xml: string): string[] {
    const matches = xml.matchAll(/<(?:\w+:)?cNvPr\b[^>]*\bid="(\d+)"/g);
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const match of matches) {
      const id = match[1];
      if (seen.has(id)) {
        duplicates.add(id);
      } else {
        seen.add(id);
      }
    }
    return Array.from(duplicates).sort();
  }
}

function resolveRelsTarget(relPath: string, target: string): string {
  if (target.startsWith('/')) {
    return target.slice(1);
  }

  const ownerPath = relPath.endsWith('_rels/.rels')
    ? ''
    : relPath.replace(/_rels\/([^/]+)\.rels$/, '$1');
  const ownerDir = ownerPath.includes('/') ? ownerPath.slice(0, ownerPath.lastIndexOf('/')) : '';
  const base = ownerDir ? `${ownerDir}/` : '';
  const stack = `${base}${target}`.split('/');
  const resolved: string[] = [];
  for (const part of stack) {
    if (!part || part === '.') continue;
    if (part === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  return resolved.join('/');
}
