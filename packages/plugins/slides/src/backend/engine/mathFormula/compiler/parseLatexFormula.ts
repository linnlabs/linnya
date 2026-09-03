import { MathFormulaCompileError } from '../definitions/MathFormulaCompileError';
import type {
  CanonicalFormulaIr,
  CanonicalFormulaNode,
  FormulaSequenceNode,
  FormulaTokenNode,
  FormulaTokenRole,
} from '../definitions/canonicalFormula';

const MAX_DEPTH = 32;
const MAX_NODES = 2_048;
const MAX_MATRIX_CELLS = 256;

const SYMBOLS: Readonly<Record<string, string>> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ',
  lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ',
  omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ',
  Phi: 'Φ', Omega: 'Ω', pm: '±', mp: '∓', times: '×', cdot: '·', div: '÷',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
  equiv: '≡', in: '∈', notin: '∉', subset: '⊂', supset: '⊃', subseteq: '⊆',
  supseteq: '⊇', cup: '∪', cap: '∩', infty: '∞', partial: '∂', nabla: '∇',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', forall: '∀', exists: '∃',
  ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱',
};

const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'log', 'ln', 'exp', 'lim', 'max', 'min', 'det']);
const NARY: Readonly<Record<string, string>> = {
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
};
const ACCENTS: Readonly<Record<string, string>> = {
  hat: '̂', bar: '̄', vec: '⃗', dot: '̇', ddot: '̈', tilde: '̃', overline: '¯', underline: '_',
};
const ENVIRONMENTS = new Set(['matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'cases', 'aligned']);
const RELATIONS = new Set([
  '=', '<', '>', '≤', '≥', '≠', '≈', '≡', '∈', '∉', '⊂', '⊃', '⊆', '⊇',
  '→', '←', '↔', '⇒', '⇐', '⇔',
]);
const OPERATORS = new Set(['+', '−', '±', '∓', '×', '·', '÷', '∪', '∩', '/', '*']);
const PUNCTUATION = new Set([',', ';', ':', '.']);
const SPACES_EM: Readonly<Record<string, number>> = {
  ',': 1 / 6,
  ':': 2 / 9,
  ';': 5 / 18,
  quad: 1,
  qquad: 2,
};

export function parseLatexFormula(latex: string): CanonicalFormulaIr {
  const parser = new FormulaParser(latex, { nodeCount: 0 }, 0);
  const root = parser.parseRoot();
  return { version: 2, root, nodeCount: parser.nodeCount };
}

interface FormulaParseBudget {
  nodeCount: number;
}

class FormulaParser {
  private index = 0;
  private depth: number;

  constructor(
    private readonly source: string,
    private readonly budget: FormulaParseBudget,
    parentDepth: number,
  ) {
    this.depth = parentDepth;
  }

  get nodeCount(): number { return this.budget.nodeCount; }

  parseRoot(): FormulaSequenceNode {
    const root = this.parseSequence();
    this.skipWhitespace();
    if (!this.atEnd()) this.unsupported(`无法解析位置 ${this.index + 1} 附近的语法。`);
    return root;
  }

  private parseSequence(stopCharacter?: string, stopAtRight = false): FormulaSequenceNode {
    this.enter();
    const children: CanonicalFormulaNode[] = [];
    while (!this.atEnd()) {
      this.skipWhitespace();
      if (this.atEnd() || (stopCharacter && this.peek() === stopCharacter)) break;
      if (stopAtRight && this.source.startsWith('\\right', this.index)) break;
      if (this.peek() === '}') this.unsupported('存在没有对应左花括号的 }。');
      children.push(this.parseAtomWithScripts());
    }
    this.leave();
    return this.sequence(children);
  }

  private parseAtomWithScripts(): CanonicalFormulaNode {
    let base = this.parseAtom();
    let subscript: FormulaSequenceNode | undefined;
    let superscript: FormulaSequenceNode | undefined;
    while (this.peek() === '_' || this.peek() === '^') {
      const marker = this.take();
      const value = this.parseScriptValue();
      if (marker === '_') {
        if (subscript) this.unsupported('同一个公式原子不能重复声明下标。');
        subscript = value;
      } else {
        if (superscript) this.unsupported('同一个公式原子不能重复声明上标。');
        superscript = value;
      }
    }
    if (subscript || superscript) {
      base = this.node({ kind: 'script', base, subscript, superscript });
    }
    return base;
  }

  private parseAtom(): CanonicalFormulaNode {
    const char = this.peek();
    if (char === '{') return this.parseRequiredGroup();
    if (char === '\\') return this.parseCommand();
    if (char === '&') this.unsupported('& 只允许出现在 matrix/cases/aligned 环境中。');
    this.take();
    return this.token(normalizeLiteral(char), classifyLiteral(char));
  }

  private parseCommand(): CanonicalFormulaNode {
    const command = this.readCommand();
    if (command === 'frac' || command === 'dfrac' || command === 'tfrac' || command === 'binom') {
      const numerator = this.parseRequiredGroup();
      const denominator = this.parseRequiredGroup();
      const fraction = this.node({ kind: 'fraction', numerator, denominator });
      return command === 'binom'
        ? this.node({ kind: 'delimiter', left: '(', right: ')', body: this.sequence([fraction]) })
        : fraction;
    }
    if (command === 'sqrt') {
      const degree = this.peek() === '[' ? this.parseBracketGroup() : undefined;
      return this.node({ kind: 'radical', body: this.parseRequiredGroup(), degree });
    }
    if (command === 'left') return this.parseDelimited();
    if (command === 'begin') return this.parseEnvironment();
    if (command === 'text') return this.token(this.readLiteralGroup(), 'text');
    if (command === 'mathrm') return this.token(this.readLiteralGroup(), 'roman');
    if (command === 'operatorname') return this.token(this.readLiteralGroup(), 'function');
    const accent = ACCENTS[command];
    if (accent) return this.node({ kind: 'accent', character: accent, body: this.parseRequiredGroup() });
    const nary = NARY[command];
    if (nary) return this.node({ kind: 'nary', symbol: nary, body: this.sequence([]) });
    const symbol = SYMBOLS[command];
    if (symbol) return this.token(symbol, classifyLiteral(symbol));
    if (FUNCTIONS.has(command)) return this.token(command, 'function');
    const spaceWidth = SPACES_EM[command];
    if (spaceWidth != null) {
      return this.node({ kind: 'space', widthEm: spaceWidth });
    }
    if (command === '{' || command === '}' || command === '_' || command === '%' || command === '#') {
      return this.token(command, classifyLiteral(command));
    }
    this.unsupported(`不支持 LaTeX 命令 \\${command}。`);
  }

  private parseDelimited(): CanonicalFormulaNode {
    const left = this.readDelimiter();
    const body = this.parseSequence(undefined, true);
    if (this.readCommand() !== 'right') this.unsupported('\\left 必须与 \\right 配对。');
    const right = this.readDelimiter();
    return this.node({ kind: 'delimiter', left, right, body });
  }

  private parseEnvironment(): CanonicalFormulaNode {
    const environment = this.readLiteralGroup();
    if (!ENVIRONMENTS.has(environment)) this.unsupported(`不支持公式环境 ${environment}。`);
    const endToken = `\\end{${environment}}`;
    const end = this.source.indexOf(endToken, this.index);
    if (end < 0) this.unsupported(`公式环境 ${environment} 缺少 \\end。`);
    const body = this.source.slice(this.index, end);
    this.index = end + endToken.length;
    const rows = splitEnvironment(body).map((row) => row.map((cell) => (
      new FormulaParser(cell, this.budget, this.depth).parseRoot()
    )));
    const cellCount = rows.reduce((sum, row) => sum + row.length, 0);
    if (cellCount > MAX_MATRIX_CELLS) this.limit(`公式矩阵不能超过 ${MAX_MATRIX_CELLS} 个单元格。`);
    if (environment === 'aligned') {
      return this.node({ kind: 'equationArray', rows: rows.map((row) => this.sequence(row)) });
    }
    const delimiters = environmentDelimiters(environment);
    return this.node({ kind: 'matrix', rows, ...delimiters });
  }

  private parseRequiredGroup(): FormulaSequenceNode {
    this.skipWhitespace();
    if (this.take() !== '{') this.unsupported('公式命令缺少必需的 {…} 参数。');
    const value = this.parseSequence('}');
    if (this.take() !== '}') this.unsupported('公式花括号没有闭合。');
    return value;
  }

  private parseBracketGroup(): FormulaSequenceNode {
    if (this.take() !== '[') this.unsupported('根式次数参数无效。');
    const start = this.index;
    while (!this.atEnd() && this.peek() !== ']') this.index += 1;
    if (this.take() !== ']') this.unsupported('根式次数参数没有闭合。');
    return parseLatexFormula(this.source.slice(start, this.index - 1)).root;
  }

  private parseScriptValue(): FormulaSequenceNode {
    this.skipWhitespace();
    if (this.peek() === '{') return this.parseRequiredGroup();
    return this.sequence([this.parseAtom()]);
  }

  private readLiteralGroup(): string {
    this.skipWhitespace();
    if (this.take() !== '{') this.unsupported('公式命令缺少必需的文本参数。');
    const start = this.index;
    let level = 1;
    while (!this.atEnd() && level > 0) {
      const char = this.take();
      if (char === '{') level += 1;
      if (char === '}') level -= 1;
    }
    if (level !== 0) this.unsupported('公式文本参数没有闭合。');
    return this.source.slice(start, this.index - 1);
  }

  private readDelimiter(): string {
    this.skipWhitespace();
    if (this.peek() !== '\\') return this.take();
    const command = this.readCommand();
    const mapped: Readonly<Record<string, string>> = {
      lbrace: '{', rbrace: '}', langle: '⟨', rangle: '⟩', vert: '|', Vert: '‖', '.': '',
    };
    const delimiter = mapped[command];
    if (delimiter == null) this.unsupported(`不支持定界符 \\${command}。`);
    return delimiter;
  }

  private readCommand(): string {
    this.skipWhitespace();
    if (this.take() !== '\\') this.unsupported('预期 LaTeX 命令。');
    const start = this.index;
    while (/[A-Za-z]/.test(this.peek())) this.index += 1;
    if (this.index === start) return this.take();
    return this.source.slice(start, this.index);
  }

  private sequence(children: readonly CanonicalFormulaNode[]): FormulaSequenceNode {
    return this.node({ kind: 'sequence', children });
  }

  private token(value: string, role: FormulaTokenRole): FormulaTokenNode {
    return this.node({ kind: 'token', value, role });
  }

  private node<T extends CanonicalFormulaNode>(value: T): T {
    this.budget.nodeCount += 1;
    if (this.budget.nodeCount > MAX_NODES) this.limit(`公式不能超过 ${MAX_NODES} 个语义节点。`);
    return value;
  }

  private enter(): void {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) this.limit(`公式嵌套不能超过 ${MAX_DEPTH} 层。`);
  }

  private leave(): void { this.depth -= 1; }
  private skipWhitespace(): void { while (/\s/.test(this.peek())) this.index += 1; }
  private peek(): string { return this.source[this.index] ?? ''; }
  private take(): string { const value = this.peek(); this.index += value ? 1 : 0; return value; }
  private atEnd(): boolean { return this.index >= this.source.length; }

  private unsupported(message: string): never {
    throw new MathFormulaCompileError('slides.formula.unsupported_syntax', message);
  }

  private limit(message: string): never {
    throw new MathFormulaCompileError('slides.formula.resource_limit_exceeded', message);
  }
}

function normalizeLiteral(value: string): string {
  return value === '-' ? '−' : value;
}

function classifyLiteral(value: string): FormulaTokenRole {
  const normalized = normalizeLiteral(value);
  if (/^\d$/u.test(normalized)) return 'number';
  if (RELATIONS.has(normalized)) return 'relation';
  if (OPERATORS.has(normalized) || '()[]{}|‖'.includes(normalized)) return 'operator';
  if (PUNCTUATION.has(normalized)) return 'punctuation';
  return 'identifier';
}

function splitEnvironment(source: string): string[][] {
  const rows: string[][] = [[]];
  let buffer = '';
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0 && char === '&') {
      rows[rows.length - 1]?.push(buffer.trim());
      buffer = '';
      continue;
    }
    if (depth === 0 && char === '\\' && source[index + 1] === '\\') {
      rows[rows.length - 1]?.push(buffer.trim());
      rows.push([]);
      buffer = '';
      index += 1;
      continue;
    }
    buffer += char;
  }
  rows[rows.length - 1]?.push(buffer.trim());
  return rows.filter((row) => row.some((cell) => cell.length > 0));
}

function environmentDelimiters(environment: string): { readonly left?: string; readonly right?: string } {
  switch (environment) {
    case 'pmatrix': return { left: '(', right: ')' };
    case 'bmatrix': return { left: '[', right: ']' };
    case 'Bmatrix': return { left: '{', right: '}' };
    case 'vmatrix': return { left: '|', right: '|' };
    case 'Vmatrix': return { left: '‖', right: '‖' };
    case 'cases': return { left: '{', right: '' };
    default: return {};
  }
}
