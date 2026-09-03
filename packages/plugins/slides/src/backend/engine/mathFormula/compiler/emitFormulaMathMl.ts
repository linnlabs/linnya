import type { MathFormulaSource } from '@plugin/slides/shared';
import type {
  CanonicalFormulaIr,
  CanonicalFormulaNode,
  FormulaSequenceNode,
  FormulaTokenNode,
} from '../definitions/canonicalFormula';

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

/**
 * SVG 与 OMML 必须消费同一份 canonical IR。这里输出 Presentation MathML，
 * 只作为 MathJax 的排版输入，不进入持久化合同或 renderer。
 */
export function emitFormulaMathMl(ir: CanonicalFormulaIr, source: MathFormulaSource): string {
  const display = source.display === 'block' ? 'block' : 'inline';
  return `<math xmlns="${MATHML_NS}" display="${display}" mathcolor="${source.color}">${emitSequence(ir.root)}</math>`;
}

function emitNode(node: CanonicalFormulaNode): string {
  switch (node.kind) {
    case 'sequence': return emitSequence(node);
    case 'token': return emitToken(node);
    case 'space': return `<mspace width="${round(node.widthEm)}em"/>`;
    case 'fraction':
      return `<mfrac>${emitSequence(node.numerator)}${emitSequence(node.denominator)}</mfrac>`;
    case 'radical':
      return node.degree
        ? `<mroot>${emitSequence(node.body)}${emitSequence(node.degree)}</mroot>`
        : `<msqrt>${emitSequence(node.body)}</msqrt>`;
    case 'script': return emitScript(node);
    case 'nary': return emitNary(node);
    case 'delimiter':
      return `<mrow>${emitFence(node.left)}${emitSequence(node.body)}${emitFence(node.right)}</mrow>`;
    case 'matrix': return emitMatrix(node);
    case 'equationArray':
      return `<mtable columnalign="left" rowspacing="0.35em">${node.rows.map((row) => `<mtr><mtd>${emitSequence(row)}</mtd></mtr>`).join('')}</mtable>`;
    case 'accent': {
      const tag = node.character === '_' ? 'munder' : 'mover';
      const attribute = node.character === '_' ? 'accentunder' : 'accent';
      return `<${tag} ${attribute}="true">${emitSequence(node.body)}<mo stretchy="true">${escapeXml(node.character)}</mo></${tag}>`;
    }
  }
}

function emitSequence(node: FormulaSequenceNode): string {
  return `<mrow>${node.children.map(emitNode).join('')}</mrow>`;
}

function emitToken(node: FormulaTokenNode): string {
  const value = escapeXml(node.value);
  switch (node.role) {
    case 'number': return `<mn>${value}</mn>`;
    case 'operator':
    case 'relation':
    case 'punctuation': return `<mo>${value}</mo>`;
    case 'function':
    case 'roman': return `<mi mathvariant="normal">${value}</mi>`;
    case 'text': return `<mtext>${value}</mtext>`;
    case 'identifier': return `<mi>${value}</mi>`;
  }
}

function emitScript(node: Extract<CanonicalFormulaNode, { kind: 'script' }>): string {
  if (node.base.kind === 'nary') {
    return emitNary({ ...node.base, lower: node.subscript, upper: node.superscript });
  }
  const base = emitNode(node.base);
  if (node.subscript && node.superscript) {
    return `<msubsup>${base}${emitSequence(node.subscript)}${emitSequence(node.superscript)}</msubsup>`;
  }
  if (node.subscript) return `<msub>${base}${emitSequence(node.subscript)}</msub>`;
  return `<msup>${base}${emitSequence(node.superscript ?? emptySequence())}</msup>`;
}

function emitNary(node: Extract<CanonicalFormulaNode, { kind: 'nary' }>): string {
  const operator = `<mo largeop="true" movablelimits="true">${escapeXml(node.symbol)}</mo>`;
  let decorated = operator;
  if (node.lower && node.upper) {
    decorated = `<munderover>${operator}${emitSequence(node.lower)}${emitSequence(node.upper)}</munderover>`;
  } else if (node.lower) {
    decorated = `<munder>${operator}${emitSequence(node.lower)}</munder>`;
  } else if (node.upper) {
    decorated = `<mover>${operator}${emitSequence(node.upper)}</mover>`;
  }
  return node.body.children.length > 0
    ? `<mrow>${decorated}${emitSequence(node.body)}</mrow>`
    : decorated;
}

function emitMatrix(node: Extract<CanonicalFormulaNode, { kind: 'matrix' }>): string {
  const table = `<mtable columnspacing="0.8em" rowspacing="0.35em">${node.rows.map((row) => (
    `<mtr>${row.map((cell) => `<mtd>${emitSequence(cell)}</mtd>`).join('')}</mtr>`
  )).join('')}</mtable>`;
  if (node.left == null && node.right == null) return table;
  return `<mrow>${emitFence(node.left ?? '')}${table}${emitFence(node.right ?? '')}</mrow>`;
}

function emitFence(value: string): string {
  return value ? `<mo fence="true" stretchy="true">${escapeXml(value)}</mo>` : '';
}

function emptySequence(): FormulaSequenceNode {
  return { kind: 'sequence', children: [] };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
