import JSZip from 'jszip';
import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';
import { createPptxDocument } from '../../engine/pptx/createPptxDocument.cjs';

/**
 * 模拟 PowerPoint 作者保存的导入稿：形状编号不连续（删过形状、粘贴过），
 * 连接线用 `a:stCxn` / `a:endCxn` 按编号连接形状，动画用 `p:spTgt spid` 按编号指向形状。
 * 本插件的包清理如果把编号重排成 1..n，这些引用就会指向别的形状。
 *
 * 包骨架来自 PptxGenJS（保证 PowerPoint 能打开），三页的 slide XML 由本文件按作者习惯重写。
 */

const NS = [
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"',
].join(' ');

interface BoxSpec {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly fill: string;
}

interface ConnectorSpec {
  readonly id: number;
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
}

export interface AuthoredSlideSpec {
  readonly name: string;
  readonly boxes: readonly BoxSpec[];
  readonly connectors: readonly ConnectorSpec[];
  /** 做「出现」动画的形状编号。 */
  readonly animated: number;
}

const EMU = 914400;
const emu = (inches: number): number => Math.round(inches * EMU);

/** 三页，编号刻意不连续且互不相同；第 2 页留给补丁修改，第 1、3 页应保持原样。 */
export const AUTHORED_SLIDES: readonly AuthoredSlideSpec[] = [
  {
    name: 'Flow',
    boxes: [
      { id: 4, name: 'Start', x: 0.6, y: 2.2, w: 2.2, h: 1.1, fill: '2468C4' },
      { id: 9, name: 'Review', x: 3.9, y: 2.2, w: 2.2, h: 1.1, fill: 'D85C28' },
      { id: 14, name: 'Publish', x: 7.2, y: 2.2, w: 2.2, h: 1.1, fill: '33854B' },
    ],
    connectors: [
      { id: 17, name: 'Link Start-Review', from: 4, to: 9, x: 2.8, y: 2.75, w: 1.1 },
      { id: 21, name: 'Link Review-Publish', from: 9, to: 14, x: 6.1, y: 2.75, w: 1.1 },
    ],
    animated: 14,
  },
  {
    name: 'Hub',
    boxes: [
      { id: 7, name: 'Hub', x: 3.9, y: 0.8, w: 2.2, h: 1.1, fill: '2468C4' },
      { id: 11, name: 'Left', x: 0.8, y: 3.4, w: 2.2, h: 1.1, fill: 'D85C28' },
      { id: 16, name: 'Right', x: 7.0, y: 3.4, w: 2.2, h: 1.1, fill: '33854B' },
    ],
    connectors: [
      { id: 30, name: 'Link Hub-Left', from: 7, to: 11, x: 2.0, y: 1.9, w: 1.9 },
      { id: 33, name: 'Link Hub-Right', from: 7, to: 16, x: 6.1, y: 1.9, w: 1.9 },
    ],
    animated: 11,
  },
  {
    name: 'Notes',
    boxes: [
      { id: 5, name: 'Idea', x: 0.8, y: 1.6, w: 2.4, h: 1.1, fill: '2468C4' },
      { id: 8, name: 'Plan', x: 4.0, y: 3.0, w: 2.4, h: 1.1, fill: 'D85C28' },
      { id: 13, name: 'Result', x: 7.2, y: 4.4, w: 2.2, h: 1.0, fill: '33854B' },
    ],
    connectors: [
      { id: 19, name: 'Link Idea-Plan', from: 5, to: 8, x: 3.2, y: 2.2, w: 0.8 },
    ],
    animated: 8,
  },
];

function boxXml(box: BoxSpec): string {
  return [
    `<p:sp><p:nvSpPr><p:cNvPr id="${box.id}" name="${box.name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`,
    `<p:spPr><a:xfrm><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${emu(box.w)}" cy="${emu(box.h)}"/></a:xfrm>`,
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${box.fill}"/></a:solidFill></p:spPr>`,
    `<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1800"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${box.name}</a:t></a:r></a:p></p:txBody></p:sp>`,
  ].join('');
}

function connectorXml(connector: ConnectorSpec): string {
  return [
    `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${connector.id}" name="${connector.name}"/>`,
    `<p:cNvCxnSpPr><a:stCxn id="${connector.from}" idx="3"/><a:endCxn id="${connector.to}" idx="1"/></p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr>`,
    `<p:spPr><a:xfrm><a:off x="${emu(connector.x)}" y="${emu(connector.y)}"/><a:ext cx="${emu(connector.w)}" cy="0"/></a:xfrm>`,
    '<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="28575"><a:solidFill><a:srgbClr val="444444"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>',
  ].join('');
}

/** 单击后「出现」的入场动画，目标按 spid 指向形状。 */
function timingXml(spid: number): string {
  return [
    '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>',
    '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>',
    '<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>',
    '<p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>',
    '<p:par><p:cTn id="5" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>',
    `<p:set><p:cBhvr><p:cTn id="6" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>`,
    '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>',
    '</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>',
    '</p:childTnLst></p:cTn>',
    '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>',
    '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>',
    '</p:childTnLst></p:cTn></p:par></p:tnLst>',
    `<p:bldLst><p:bldP spid="${spid}" grpId="0" animBg="1"/></p:bldLst></p:timing>`,
  ].join('');
}

export function authoredSlideXml(slide: AuthoredSlideSpec): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<p:sld ${NS}><p:cSld name="${slide.name}"><p:spTree>`,
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>',
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>',
    ...slide.boxes.map(boxXml),
    ...slide.connectors.map(connectorXml),
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>',
    timingXml(slide.animated),
    '</p:sld>',
  ].join('');
}

/** 三页导入稿；slide 文件名与页序一致（slide1..3）。 */
export async function buildConnectorAnimationDeck(slides: readonly AuthoredSlideSpec[] = AUTHORED_SLIDES): Promise<Buffer> {
  const pptx = createPptxDocument();
  for (let index = 0; index < slides.length; index += 1) pptx.addSlide();
  const skeleton = Buffer.from(await pptx.write({ outputType: 'nodebuffer' }) as ArrayBuffer);
  const zip = await JSZip.loadAsync(skeleton);
  slides.forEach((slide, index) => {
    zip.file(`ppt/slides/slide${index + 1}.xml`, authoredSlideXml(slide));
  });
  // PptxGenJS 按页数登记 slideMaster2.. 等并不存在的 part；作者保存的稿子不会有这些悬空 Override。
  const contentTypes = await zip.file('[Content_Types].xml')!.async('text');
  zip.file('[Content_Types].xml', contentTypes.replace(
    /<Override PartName="\/([^"]+)"[^>]*\/>/g,
    (override, part: string) => (zip.file(part) ? override : ''),
  ));
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** 按 presentation.xml 的页序读取各页 XML；automizer 重组后的 slideN.xml 文件名不代表页码。 */
export async function readSlidesInOrder(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  const presentation = await zip.file('ppt/presentation.xml')?.async('text');
  const rels = await zip.file('ppt/_rels/presentation.xml.rels')?.async('text');
  if (!presentation || !rels) throw new Error('Expected presentation.xml and its rels');
  const targets = new Map(
    [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((match) => [
      /\bId="([^"]+)"/.exec(match[0])?.[1],
      /\bTarget="([^"]+)"/.exec(match[0])?.[1],
    ] as const),
  );
  const slideXml: string[] = [];
  for (const match of presentation.matchAll(/<p:sldId\b[^>]*>/g)) {
    const target = targets.get(/\br:id="([^"]+)"/.exec(match[0])?.[1]);
    const xml = target ? await zip.file(`ppt/${target}`)?.async('text') : undefined;
    if (!xml) throw new Error(`Expected slide part for ${match[0]}`);
    slideXml.push(xml);
  }
  return slideXml;
}

export interface ResolvedSlideReferences {
  /** 每条连接线：名称、起点与终点形状的名称。 */
  readonly connectors: ReadonlyArray<{ name: string; start: string | undefined; end: string | undefined }>;
  /** 动画目标（`p:spTgt` 与 `p:bldP`）按编号解析出的形状名称。 */
  readonly animationTargets: readonly (string | undefined)[];
  /** 页内所有对象编号，按文档顺序。 */
  readonly ids: readonly string[];
}

function elementsByLocalName(root: XmlElement, localName: string): XmlElement[] {
  return Array.from(root.getElementsByTagNameNS('*', localName)) as XmlElement[];
}

/** 把连接线与动画里的编号引用解析回形状名称，用来断言「引用仍指向原形状」。 */
export function resolveSlideReferences(xml: string): ResolvedSlideReferences {
  const root = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
  if (!root) throw new Error('Expected a slide document');
  const nameById = new Map<string, string>();
  const ids: string[] = [];
  for (const properties of elementsByLocalName(root, 'cNvPr')) {
    const id = properties.getAttribute('id') ?? '';
    ids.push(id);
    if (!nameById.has(id)) nameById.set(id, properties.getAttribute('name') ?? '');
  }
  const connectors = elementsByLocalName(root, 'cxnSp').map((connector) => {
    const name = elementsByLocalName(connector, 'cNvPr')[0]?.getAttribute('name') ?? '';
    const start = elementsByLocalName(connector, 'stCxn')[0]?.getAttribute('id') ?? '';
    const end = elementsByLocalName(connector, 'endCxn')[0]?.getAttribute('id') ?? '';
    return { name, start: nameById.get(start), end: nameById.get(end) };
  });
  const animationTargets = [
    ...elementsByLocalName(root, 'spTgt'),
    ...elementsByLocalName(root, 'bldP'),
  ].map((target) => nameById.get(target.getAttribute('spid') ?? ''));
  return { connectors, animationTargets, ids };
}

/** 作者原稿里某页的预期引用关系，由 `AUTHORED_SLIDES` 推出，不读被测输出。 */
export function expectedReferences(slide: AuthoredSlideSpec): Omit<ResolvedSlideReferences, 'ids'> {
  const nameById = new Map(slide.boxes.map((box) => [box.id, box.name] as const));
  return {
    connectors: slide.connectors.map((connector) => ({
      name: connector.name,
      start: nameById.get(connector.from),
      end: nameById.get(connector.to),
    })),
    animationTargets: [nameById.get(slide.animated), nameById.get(slide.animated)],
  };
}
