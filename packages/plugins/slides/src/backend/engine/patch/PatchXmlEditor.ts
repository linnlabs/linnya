import JSZip from 'jszip';
import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from '@xmldom/xmldom';
import type { PatchSpec, ShapeStyle } from '@plugin/slides/shared';
import { stripHash } from '../visual/presentationVisualDefaults';
import type { DirectXmlElementOp, GeometryPatch } from './types.js';

const EMU_PER_INCH = 914400;

function inchesToEmu(inches: number): number {
  return Math.round(inches * EMU_PER_INCH);
}

export class PatchXmlEditor {
  private readonly xmlParser = new DOMParser();
  private readonly xmlSerializer = new XMLSerializer();

  async applyDirectXmlOpsToBuffer(
    sourcePptxBuffer: Buffer,
    patchSpec: PatchSpec,
  ): Promise<Buffer> {
    const directOps = patchSpec.operations.filter(
      (op): op is DirectXmlElementOp => (
        op.op === 'modify_style' || op.op === 'modify_geometry' || op.op === 'reorder_layer'
      ),
    );
    if (directOps.length === 0) {
      return sourcePptxBuffer;
    }

    const zip = await JSZip.loadAsync(sourcePptxBuffer);
    const slideTargets = await this.resolveSlideTargets(zip);

    for (const op of directOps) {
      const targetPath = slideTargets[op.target.slideNumber - 1];
      if (!targetPath) {
        throw new Error(`${op.op}: slide ${op.target.slideNumber} is out of range`);
      }
      const fullPath = `ppt/${targetPath}`;
      const xmlText = await zip.file(fullPath)?.async('text');
      if (!xmlText) {
        throw new Error(`${op.op}: missing slide xml for ${fullPath}`);
      }

      const doc = this.xmlParser.parseFromString(xmlText, 'application/xml');
      const targetElement = this.findTargetElement(doc, op.target);
      if (!targetElement) {
        throw new Error(`${op.op}: target element not found on slide ${op.target.slideNumber}`);
      }

      switch (op.op) {
        case 'modify_style': {
          const spPr = this.findChildElement(targetElement, ['p:spPr', 'a:spPr']);
          if (!spPr) {
            throw new Error('modify_style: target element does not support style updates');
          }
          if (op.style.fill) {
            this.replaceSolidFill(spPr, stripHash(op.style.fill, 'fill'));
          }
          if (op.style.rotate != null) {
            const xfrm = this.resolveTransformElement(targetElement, spPr);
            if (!xfrm) {
              throw new Error('modify_style: target element does not support rotation');
            }
            xfrm.setAttribute('rot', String(Math.round(op.style.rotate * 60000)));
          }
          if (op.style.border) {
            this.applyBorder(spPr, op.style.border);
          }
          if (op.style.opacity != null) {
            this.applyOpacity(spPr, op.style.opacity);
          }
          if (op.style.shadow) {
            this.applyShadow(spPr, op.style.shadow);
          }
          break;
        }
        case 'modify_geometry': {
          const xfrm = this.resolveTransformElement(targetElement);
          if (!xfrm) {
            throw new Error('modify_geometry: target element does not support geometry updates');
          }
          this.applyGeometryPatch(xfrm, op.position);
          break;
        }
        case 'reorder_layer': {
          this.reorderLayer(targetElement, op.placement);
          break;
        }
      }

      zip.file(fullPath, this.xmlSerializer.serializeToString(doc));
    }

    return zip.generateAsync({ type: 'nodebuffer' });
  }

  private findChildElement(parent: XmlElement, tagNames: string[]): XmlElement | null {
    for (let index = 0; index < parent.childNodes.length; index += 1) {
      const child = parent.childNodes.item(index);
      if (child && child.nodeType === 1 && tagNames.includes((child as XmlElement).tagName)) {
        return child as XmlElement;
      }
    }
    return null;
  }

  private resolveTransformElement(targetElement: XmlElement, spPr?: XmlElement): XmlElement | null {
    const resolvedSpPr = spPr ?? this.findChildElement(targetElement, ['p:spPr', 'a:spPr']);
    return (resolvedSpPr ? this.findChildElement(resolvedSpPr, ['a:xfrm', 'p:xfrm']) : null)
      ?? this.findChildElement(targetElement, ['a:xfrm', 'p:xfrm']);
  }

  private applyGeometryPatch(xfrm: XmlElement, position: GeometryPatch): void {
    const off = this.findChildElement(xfrm, ['a:off', 'p:off']);
    const ext = this.findChildElement(xfrm, ['a:ext', 'p:ext']);
    if (!off || !ext) {
      throw new Error('modify_geometry: target transform is missing off/ext nodes');
    }

    if (position.x != null) {
      off.setAttribute('x', String(inchesToEmu(position.x)));
    }
    if (position.y != null) {
      off.setAttribute('y', String(inchesToEmu(position.y)));
    }
    if (position.w != null) {
      ext.setAttribute('cx', String(inchesToEmu(position.w)));
    }
    if (position.h != null) {
      ext.setAttribute('cy', String(inchesToEmu(position.h)));
    }
  }

  private reorderLayer(targetElement: XmlElement, placement: 'front' | 'back' | 'forward' | 'backward'): void {
    const parent = targetElement.parentNode;
    if (!parent || parent.nodeType !== 1) {
      throw new Error('reorder_layer: target element has no drawable parent');
    }

    const parentElement = parent as XmlElement;
    if (parentElement.tagName !== 'p:spTree') {
      throw new Error('reorder_layer: target element is not inside p:spTree');
    }

    const drawableChildren: XmlElement[] = [];
    for (let index = 0; index < parentElement.childNodes.length; index += 1) {
      const child = parentElement.childNodes.item(index);
      if (child?.nodeType !== 1) continue;
      const childElement = child as XmlElement;
      if (['p:sp', 'p:pic', 'p:graphicFrame', 'p:grpSp'].includes(childElement.tagName)) {
        drawableChildren.push(childElement);
      }
    }

    if (drawableChildren.length <= 1) {
      return;
    }

    const currentIndex = drawableChildren.indexOf(targetElement);
    if (currentIndex < 0) {
      throw new Error('reorder_layer: target element is not drawable');
    }

    if (placement === 'front') {
      const lastDrawable = drawableChildren[drawableChildren.length - 1];
      if (lastDrawable !== targetElement) {
        parentElement.appendChild(targetElement);
      }
      return;
    }

    if (placement === 'back') {
      const firstDrawable = drawableChildren[0];
      if (firstDrawable !== targetElement) {
        parentElement.insertBefore(targetElement, firstDrawable);
      }
      return;
    }

    if (placement === 'forward') {
      const nextDrawable = drawableChildren[currentIndex + 1];
      if (nextDrawable?.nextSibling) {
        parentElement.insertBefore(targetElement, nextDrawable.nextSibling);
      } else if (nextDrawable) {
        parentElement.appendChild(targetElement);
      }
      return;
    }

    const previousDrawable = drawableChildren[currentIndex - 1];
    if (previousDrawable) {
      parentElement.insertBefore(targetElement, previousDrawable);
    }
  }

  private async resolveSlideTargets(zip: JSZip): Promise<string[]> {
    const presentationXml = await zip.file('ppt/presentation.xml')?.async('text');
    const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('text');
    if (!presentationXml || !relsXml) {
      throw new Error('Invalid PPTX: missing presentation relationships');
    }

    const presentationDoc = this.xmlParser.parseFromString(presentationXml, 'application/xml');
    const relsDoc = this.xmlParser.parseFromString(relsXml, 'application/xml');
    const relMap = new Map<string, string>();
    const relationships = relsDoc.getElementsByTagName('Relationship');
    for (let index = 0; index < relationships.length; index += 1) {
      const relationship = relationships.item(index);
      const id = relationship?.getAttribute('Id');
      const target = relationship?.getAttribute('Target');
      if (id && target) {
        relMap.set(id, target);
      }
    }

    const targets: string[] = [];
    const slideIds = presentationDoc.getElementsByTagName('p:sldId');
    for (let index = 0; index < slideIds.length; index += 1) {
      const relationshipId = slideIds.item(index)?.getAttribute('r:id');
      const target = relationshipId ? relMap.get(relationshipId) : null;
      if (target) {
        targets.push(target);
      }
    }
    return targets;
  }

  private findTargetElement(doc: XmlDocument, target: DirectXmlElementOp['target']): XmlElement | null {
    const candidateTags = ['p:sp', 'p:pic', 'p:graphicFrame'];
    for (const tagName of candidateTags) {
      const nodes = doc.getElementsByTagName(tagName);
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes.item(index) as XmlElement | null;
        if (!node) continue;

        const nonVisualContainer = this.findChildElement(node, ['p:nvSpPr', 'p:nvPicPr', 'p:nvGraphicFramePr']);
        const nonVisual = nonVisualContainer
          ? this.findChildElement(nonVisualContainer, ['p:cNvPr'])
          : null;
        if (!nonVisual) continue;

        const name = nonVisual.getAttribute('name') ?? '';
        const creationId = this.extractCreationId(nonVisual);

        if ('creationId' in target && target.creationId && creationId === target.creationId) {
          return node;
        }
        if (name === target.elementName) {
          return node;
        }
      }
    }
    return null;
  }

  private replaceSolidFill(spPr: XmlElement, color: string): void {
    for (const tagName of ['a:noFill', 'a:solidFill']) {
      const existing = this.findChildElement(spPr, [tagName]);
      if (existing) {
        spPr.removeChild(existing);
      }
    }

    const doc = this.requireOwnerDocument(spPr, 'replaceSolidFill');
    const solidFill = doc.createElement('a:solidFill');
    const srgbClr = doc.createElement('a:srgbClr');
    srgbClr.setAttribute('val', color);
    solidFill.appendChild(srgbClr);
    spPr.appendChild(solidFill);
  }

  private applyBorder(spPr: XmlElement, border: NonNullable<ShapeStyle['border']>): void {
    if (!border.color) {
      throw new Error('ppt_edit_style 暂不支持渐变描边；请通过 deck.js 源码编辑。');
    }
    const existing = this.findChildElement(spPr, ['a:ln']);
    if (existing) {
      spPr.removeChild(existing);
    }

    const doc = this.requireOwnerDocument(spPr, 'applyBorder');
    const ln = doc.createElement('a:ln');
    ln.setAttribute('w', String(Math.round(border.width * 12700)));
    if (border.dash && border.dash !== 'solid') {
      ln.setAttribute('prstDash', border.dash === 'dot' ? 'dot' : 'dash');
    }
    const solidFill = doc.createElement('a:solidFill');
    const srgbClr = doc.createElement('a:srgbClr');
    srgbClr.setAttribute('val', stripHash(border.color, 'border.color'));
    solidFill.appendChild(srgbClr);
    ln.appendChild(solidFill);
    spPr.appendChild(ln);
  }

  private applyOpacity(spPr: XmlElement, opacity: number): void {
    let solidFill = this.findChildElement(spPr, ['a:solidFill']);
    if (!solidFill) {
      const doc = this.requireOwnerDocument(spPr, 'applyOpacity');
      solidFill = doc.createElement('a:solidFill');
      const srgbClr = doc.createElement('a:srgbClr');
      srgbClr.setAttribute('val', 'FFFFFF');
      solidFill.appendChild(srgbClr);
      spPr.appendChild(solidFill);
    }
    const colorElement = this.findChildElement(solidFill, ['a:srgbClr', 'a:schemeClr']);
    if (colorElement) {
      const existingAlpha = this.findChildElement(colorElement, ['a:alpha']);
      if (existingAlpha) {
        colorElement.removeChild(existingAlpha);
      }
      const doc = this.requireOwnerDocument(spPr, 'applyOpacity');
      const alpha = doc.createElement('a:alpha');
      alpha.setAttribute('val', String(Math.round(opacity * 100000)));
      colorElement.appendChild(alpha);
    }
  }

  private applyShadow(spPr: XmlElement, shadow: NonNullable<ShapeStyle['shadow']>): void {
    const existing = this.findChildElement(spPr, ['a:effectLst']);
    if (existing) {
      spPr.removeChild(existing);
    }

    const doc = this.requireOwnerDocument(spPr, 'applyShadow');
    const effectList = doc.createElement('a:effectLst');
    const outerShadow = doc.createElement('a:outerShdw');
    const angle = Math.atan2(shadow.offsetY, shadow.offsetX) * (180 / Math.PI);
    const distance = Math.sqrt(shadow.offsetX ** 2 + shadow.offsetY ** 2);
    outerShadow.setAttribute('blurRad', String(Math.round(shadow.blur * 12700)));
    outerShadow.setAttribute('dist', String(Math.round(distance * 12700)));
    outerShadow.setAttribute('dir', String(Math.round(angle * 60000)));
    outerShadow.setAttribute('rotWithShape', '0');

    const srgbClr = doc.createElement('a:srgbClr');
    srgbClr.setAttribute('val', stripHash(shadow.color, 'shadow.color'));
    const alpha = doc.createElement('a:alpha');
    alpha.setAttribute('val', String(Math.round((shadow.opacity ?? 0.4) * 100000)));
    srgbClr.appendChild(alpha);
    outerShadow.appendChild(srgbClr);
    effectList.appendChild(outerShadow);
    spPr.appendChild(effectList);
  }

  private extractCreationId(cNvPr: XmlElement): string | null {
    const extList = this.findChildElement(cNvPr, ['a:extLst']);
    if (!extList) return null;
    const ext = this.findChildElement(extList, ['a:ext']);
    if (!ext) return null;
    const creationId = this.findChildElement(ext, ['a16:creationId']);
    return creationId?.getAttribute('id') ?? null;
  }

  private requireOwnerDocument(node: XmlElement, context: string): XmlDocument {
    if (!node.ownerDocument) {
      throw new Error(`${context}: XML node has no ownerDocument`);
    }
    return node.ownerDocument;
  }
}
