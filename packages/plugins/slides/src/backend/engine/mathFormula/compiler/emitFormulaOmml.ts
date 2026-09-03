import type { MathFormulaSource } from '@plugin/slides/shared';
import type {
  CanonicalFormulaIr,
  CanonicalFormulaNode,
  FormulaSequenceNode,
  FormulaTokenNode,
} from '../definitions/canonicalFormula';

const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

export function emitBlockFormulaOmml(ir: CanonicalFormulaIr, source: MathFormulaSource): string {
  const alignment = source.align === 'left' ? 'left' : source.align === 'right' ? 'right' : 'center';
  return `<m:oMathPara xmlns:m="${MATH_NS}" xmlns:a="${DRAWING_NS}"><m:oMathParaPr><m:jc m:val="${alignment}"/></m:oMathParaPr><m:oMath>${emitNode(ir.root, source)}</m:oMath></m:oMathPara>`;
}

export function emitInlineFormulaOmml(ir: CanonicalFormulaIr, source: MathFormulaSource): string {
  return `<m:oMath xmlns:m="${MATH_NS}" xmlns:a="${DRAWING_NS}">${emitNode(ir.root, source)}</m:oMath>`;
}

function emitNode(node: CanonicalFormulaNode, source: MathFormulaSource): string {
  switch (node.kind) {
    case 'sequence': return node.children.map((child) => emitNode(child, source)).join('');
    case 'token': return emitToken(node, source);
    case 'space': return emitText(ommlSpace(node.widthEm), source, true);
    case 'fraction':
      return `<m:f><m:fPr><m:type m:val="bar"/></m:fPr><m:num>${emitSequence(node.numerator, source)}</m:num><m:den>${emitSequence(node.denominator, source)}</m:den></m:f>`;
    case 'radical':
      return `<m:rad><m:radPr>${node.degree ? '' : '<m:degHide m:val="1"/>'}</m:radPr><m:deg>${node.degree ? emitSequence(node.degree, source) : ''}</m:deg><m:e>${emitSequence(node.body, source)}</m:e></m:rad>`;
    case 'script': return emitScript(node, source);
    case 'nary':
      return `<m:nary><m:naryPr><m:chr m:val="${escapeXml(node.symbol)}"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>${node.lower ? emitSequence(node.lower, source) : ''}</m:sub><m:sup>${node.upper ? emitSequence(node.upper, source) : ''}</m:sup><m:e>${emitSequence(node.body, source)}</m:e></m:nary>`;
    case 'delimiter':
      return `<m:d><m:dPr><m:begChr m:val="${escapeXml(node.left)}"/><m:endChr m:val="${escapeXml(node.right)}"/></m:dPr><m:e>${emitSequence(node.body, source)}</m:e></m:d>`;
    case 'matrix': {
      const matrix = `<m:m>${node.rows.map((row) => `<m:mr>${row.map((cell) => `<m:e>${emitSequence(cell, source)}</m:e>`).join('')}</m:mr>`).join('')}</m:m>`;
      if (node.left == null && node.right == null) return matrix;
      return `<m:d><m:dPr><m:begChr m:val="${escapeXml(node.left ?? '')}"/><m:endChr m:val="${escapeXml(node.right ?? '')}"/></m:dPr><m:e>${matrix}</m:e></m:d>`;
    }
    case 'equationArray':
      return `<m:eqArr>${node.rows.map((row) => `<m:e>${emitSequence(row, source)}</m:e>`).join('')}</m:eqArr>`;
    case 'accent':
      return `<m:acc><m:accPr><m:chr m:val="${escapeXml(node.character)}"/></m:accPr><m:e>${emitSequence(node.body, source)}</m:e></m:acc>`;
  }
}

function emitScript(
  node: Extract<CanonicalFormulaNode, { kind: 'script' }>,
  source: MathFormulaSource,
): string {
  if (node.base.kind === 'nary') {
    const nary = { ...node.base, lower: node.subscript, upper: node.superscript };
    return emitNode(nary, source);
  }
  const base = `<m:e>${emitNode(node.base, source)}</m:e>`;
  if (node.subscript && node.superscript) {
    return `<m:sSubSup>${base}<m:sub>${emitSequence(node.subscript, source)}</m:sub><m:sup>${emitSequence(node.superscript, source)}</m:sup></m:sSubSup>`;
  }
  if (node.subscript) {
    return `<m:sSub>${base}<m:sub>${emitSequence(node.subscript, source)}</m:sub></m:sSub>`;
  }
  return `<m:sSup>${base}<m:sup>${emitSequence(node.superscript ?? emptySequence(), source)}</m:sup></m:sSup>`;
}

function emitSequence(sequence: FormulaSequenceNode, source: MathFormulaSource): string {
  return emitNode(sequence, source);
}

function emitToken(node: FormulaTokenNode, source: MathFormulaSource): string {
  const plain = node.role === 'function' || node.role === 'roman' || node.role === 'text';
  return emitText(node.value, source, plain);
}

function emitText(value: string, source: MathFormulaSource, plain = false): string {
  const size = Math.round(source.fontSize * 100);
  const color = source.color.slice(1);
  const style = plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : '';
  const preserve = /^\s|\s$/u.test(value) ? ' xml:space="preserve"' : '';
  return `<m:r>${style}<a:rPr lang="en-US" sz="${size}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Cambria Math"/><a:ea typeface="Cambria Math"/><a:cs typeface="Cambria Math"/></a:rPr><m:t${preserve}>${escapeXml(value)}</m:t></m:r>`;
}

function emptySequence(): FormulaSequenceNode {
  return { kind: 'sequence', children: [] };
}

function ommlSpace(widthEm: number): string {
  if (widthEm >= 2) return '\u2003\u2003';
  if (widthEm >= 1) return '\u2003';
  if (widthEm >= 0.25) return '\u2005';
  return '\u2009';
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
