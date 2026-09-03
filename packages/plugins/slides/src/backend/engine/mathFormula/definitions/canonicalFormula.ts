export interface FormulaSequenceNode {
  readonly kind: 'sequence';
  readonly children: readonly CanonicalFormulaNode[];
}

export type FormulaTokenRole =
  | 'identifier'
  | 'number'
  | 'operator'
  | 'relation'
  | 'punctuation'
  | 'function'
  | 'roman'
  | 'text';

export interface FormulaTokenNode {
  readonly kind: 'token';
  readonly value: string;
  readonly role: FormulaTokenRole;
}

export type CanonicalFormulaNode =
  | FormulaSequenceNode
  | FormulaTokenNode
  | { readonly kind: 'space'; readonly widthEm: number }
  | { readonly kind: 'fraction'; readonly numerator: FormulaSequenceNode; readonly denominator: FormulaSequenceNode }
  | { readonly kind: 'radical'; readonly body: FormulaSequenceNode; readonly degree?: FormulaSequenceNode }
  | { readonly kind: 'script'; readonly base: CanonicalFormulaNode; readonly subscript?: FormulaSequenceNode; readonly superscript?: FormulaSequenceNode }
  | { readonly kind: 'nary'; readonly symbol: string; readonly body: FormulaSequenceNode; readonly lower?: FormulaSequenceNode; readonly upper?: FormulaSequenceNode }
  | { readonly kind: 'delimiter'; readonly left: string; readonly right: string; readonly body: FormulaSequenceNode }
  | { readonly kind: 'matrix'; readonly rows: readonly (readonly FormulaSequenceNode[])[]; readonly left?: string; readonly right?: string }
  | { readonly kind: 'equationArray'; readonly rows: readonly FormulaSequenceNode[] }
  | { readonly kind: 'accent'; readonly character: string; readonly body: FormulaSequenceNode };

export interface CanonicalFormulaIr {
  readonly version: 2;
  readonly root: FormulaSequenceNode;
  readonly nodeCount: number;
}
