/**
 * @file apps/renderer/features/LatexBlock/ui/symbols.js
 * @description 该文件定义了 LaTeX 编辑器中用于快捷插入的符号数据。
 *
 * 功能 (What):
 * - 导出 `symbolCategories` 数组，其中包含了多个符号类别。
 * - 每个类别包含一个符号列表，每个符号对象定义了其显示方式、要插入的 LaTeX 代码，以及插入后的光标偏移量。
 *
 * 输入 (Input / @param):
 * - 无
 *
 * 输出 (Output / @returns):
 * - `symbolCategories` (Array): 一个包含所有符号类别及其符号的数组。
 *
 * 副作用 (Side-effects):
 * - 无
 */

export const symbolCategories = [
  {
    id: 'math',
    symbols: [
      // 运算符
      { display: '×', insert: '\\times ', preview: '\\times' },
      { display: '÷', insert: '\\div ', preview: '\\div' },
      { display: '±', insert: '\\pm ', preview: '\\pm' },
      { display: '·', insert: '\\cdot ', preview: '\\cdot' },
      { display: '°', insert: '^{\\circ}', preview: '^{\\circ}' },
      { display: '%', insert: '\\% ', preview: '\\%' },
      // 关系符
      { display: '≠', insert: '\\neq ', preview: '\\neq' },
      { display: '≈', insert: '\\approx ', preview: '\\approx' },
      { display: '≤', insert: '\\leq ', preview: '\\leq' },
      { display: '≥', insert: '\\geq ', preview: '\\geq' },
      { display: '≡', insert: '\\equiv ', preview: '\\equiv' },
      // 分数
      { display: 'a/b', insert: '\\frac{}{}', moveCursor: -3, preview: '\\frac{a}{b}' },
      // 根号
      { display: '√a', insert: '\\sqrt{}', moveCursor: -1, preview: '\\sqrt{a}' },
      { display: '√ⁿa', insert: '\\sqrt[]{}', moveCursor: -3, preview: '\\sqrt[n]{a}' },
      // 上下标
      { display: 'aᵇ', insert: '^{}', moveCursor: -1, preview: 'a^{b}' },
      { display: 'a₆', insert: '_{}', moveCursor: -1, preview: 'a_{b}' },
      { display: '|a|', insert: '|{}|', moveCursor: -1, preview: '|a|' },
      // 集合
      { display: '∈', insert: '\\in ', preview: '\\in' },
      { display: '∉', insert: '\\notin ', preview: '\\notin' },
      { display: '⊂', insert: '\\subset ', preview: '\\subset' },
      { display: '⊃', insert: '\\supset ', preview: '\\supset' },
      { display: '∪', insert: '\\cup ', preview: '\\cup' },
      { display: '∩', insert: '\\cap ', preview: '\\cap' },
      { display: '∅', insert: '\\emptyset ', preview: '\\emptyset' },
      
      // 函数与算子
      { display: 'logₐb', insert: '\\log_{a}{b}', preview: '\\log_{a}{b}' },
      { display: 'lim', insert: '\\lim_{x \\to \\infty}', preview: '\\lim' },
      { display: '∑', insert: '\\sum_{i=1}^{n}', preview: '\\sum' },
      { display: '∏', insert: '\\prod_{i=1}^{n}', preview: '\\prod' },
      { display: '∫', insert: '\\int_{a}^{b}', preview: '\\int' },
      { display: '∬', insert: '\\iint ', preview: '\\iint' },
      { display: '∭', insert: '\\iiint ', preview: '\\iiint' },
      { display: '∮', insert: '\\oint ', preview: '\\oint' },
      { display: 'f∘g', insert: ' \\circ ', preview: 'f \\circ g' },

      // 其他
      { display: '∞', insert: '\\infty ', preview: '\\infty' },
      { display: '∇', insert: '\\nabla ', preview: '\\nabla' },
      { display: '∂', insert: '\\partial ', preview: '\\partial' },
      { display: 'ℝ', insert: '\\mathbb{R} ', preview: '\\mathbb{R}' },
      { display: '𝔽', insert: '\\mathbb{F} ', preview: '\\mathbb{F}' },
      { display: '𝕋', insert: '\\mathbb{T} ', preview: '\\mathbb{T}' },
      { display: '≪', insert: '\\ll ', preview: '\\ll' },
      { display: '≫', insert: '\\gg ', preview: '\\gg' },
      { display: '⊥', insert: '\\perp ', preview: '\\perp' },
      { display: '≅', insert: '\\cong ', preview: '\\cong' },
      { display: '↦', insert: '\\mapsto ', preview: '\\mapsto' },

      // 省略号
      { display: '…', insert: '\\ldots ', preview: '\\ldots' },
      { display: '⋯', insert: '\\cdots ', preview: '\\cdots' },
      { display: '⋮', insert: '\\vdots ', preview: '\\vdots' },
      { display: '⋱', insert: '\\ddots ', preview: '\\ddots' },
      
      // 结构
      { display: 'det', insert: '\\begin{vmatrix}\n\t &  \\\\\n\t &  \n\\end{vmatrix}', moveCursor: -21, preview: '|A|' },
      { display: 'matrix', insert: '\\begin{pmatrix}\n\t &  \\\\\n\t &  \n\\end{pmatrix}', moveCursor: -20, preview: '\\begin{pmatrix} \\dots \\end{pmatrix}' },
      { display: 'cases', insert: '\\begin{cases}\n\t & \\\\\n\t & \n\\end{cases}', moveCursor: -15, preview: '\\begin{cases} \\dots \\end{cases}' },
    ],
  },
  {
    id: 'physics',
    symbols: [
      { display: 'v⃗', insert: '\\vec{}', moveCursor: -1, preview: '\\vec{v}' },
      { display: 'Fₙ', insert: 'F_{net}', preview: 'F_{\\text{net}}' },
      { display: 'x̄', insert: '\\bar{x}', preview: '\\bar{x}' },
      { display: '°C', insert: '^{\\circ}C', preview: '^{\\circ}\\text{C}' },
      { display: 'ħ', insert: '\\hbar ', preview: '\\hbar' },
      { display: '∮', insert: '\\oint ', preview: '\\oint' },
      { display: '∝', insert: '\\propto ', preview: '\\propto' },
      { display: '∇', insert: '\\nabla ', preview: '\\nabla' },
      { display: 'kg', insert: '\\text{kg}', preview: '\\text{kg}' },
      { display: 'm/s²', insert: '\\text{m/s}^2', preview: '\\text{m/s}^{2}' },
    ],
  },
  {
    id: 'chemistry',
    symbols: [
      { display: '→', insert: '\\rightarrow ', preview: '\\rightarrow' },
      { display: '⇌', insert: '\\rightleftharpoons ', preview: '\\rightleftharpoons' },
      { display: 'Å', insert: '\\AA ', preview: '\\AA' },
      { display: 'H₂O', insert: 'H_{2}O', preview: 'H_{2}O' },
      { display: '(s)', insert: '_{(s)}', preview: '\\text{(s)}' },
      { display: '(l)', insert: '_{(l)}', preview: '\\text{(l)}' },
      { display: '(g)', insert: '_{(g)}', preview: '\\text{(g)}' },
      { display: '(aq)', insert: '_{(aq)}', preview: '\\text{(aq)}' },
      { display: 'X⁺', insert: '^{+}', moveCursor: -1, preview: 'X^{+}' },
      { display: 'X⁻', insert: '^{-}', moveCursor: -1, preview: 'X^{-}' },
      { display: 'ΔH', insert: '\\Delta H', preview: '\\Delta H' },
      { display: 'Kₐ', insert: 'K_{a}', preview: 'K_{a}' },
      { display: 'pH', insert: '\\text{pH}', preview: '\\text{pH}' },
    ],
  },
  {
    id: 'arrows',
    symbols: [
      { display: '←', insert: '\\leftarrow ', preview: '\\leftarrow' },
      { display: '→', insert: '\\rightarrow ', preview: '\\rightarrow' },
      { display: '↑', insert: '\\uparrow ', preview: '\\uparrow' },
      { display: '↓', insert: '\\downarrow ', preview: '\\downarrow' },
      { display: '↔', insert: '\\leftrightarrow ', preview: '\\leftrightarrow' },
      { display: '⇐', insert: '\\Leftarrow ', preview: '\\Leftarrow' },
      { display: '⇒', insert: '\\Rightarrow ', preview: '\\Rightarrow' },
      { display: '⇑', insert: '\\Uparrow ', preview: '\\Uparrow' },
      { display: '⇓', insert: '\\Downarrow ', preview: '\\Downarrow' },
      { display: '⇔', insert: '\\Leftrightarrow ', preview: '\\Leftrightarrow' },
    ],
  },
  {
    id: 'greekLetters',
    symbols: [
      { display: 'α', insert: '\\alpha ', preview: '\\alpha' },
      { display: 'β', insert: '\\beta ', preview: '\\beta' },
      { display: 'γ', insert: '\\gamma ', preview: '\\gamma' },
      { display: 'δ', insert: '\\delta ', preview: '\\delta' },
      { display: 'ε', insert: '\\epsilon ', preview: '\\epsilon' },
      { display: 'ζ', insert: '\\zeta ', preview: '\\zeta' },
      { display: 'η', insert: '\\eta ', preview: '\\eta' },
      { display: 'θ', insert: '\\theta ', preview: '\\theta' },
      { display: 'ι', insert: '\\iota ', preview: '\\iota' },
      { display: 'κ', insert: '\\kappa ', preview: '\\kappa' },
      { display: 'λ', insert: '\\lambda ', preview: '\\lambda' },
      { display: 'μ', insert: '\\mu ', preview: '\\mu' },
      { display: 'ν', insert: '\\nu ', preview: '\\nu' },
      { display: 'ξ', insert: '\\xi ', preview: '\\xi' },
      { display: 'ο', insert: '\\omicron ', preview: '\\omicron' },
      { display: 'π', insert: '\\pi ', preview: '\\pi' },
      { display: 'ρ', insert: '\\rho ', preview: '\\rho' },
      { display: 'σ', insert: '\\sigma ', preview: '\\sigma' },
      { display: 'τ', insert: '\\tau ', preview: '\\tau' },
      { display: 'υ', insert: '\\upsilon ', preview: '\\upsilon' },
      { display: 'φ', insert: '\\phi ', preview: '\\phi' },
      { display: 'χ', insert: '\\chi ', preview: '\\chi' },
      { display: 'ψ', insert: '\\psi ', preview: '\\psi' },
      { display: 'ω', insert: '\\omega ', preview: '\\omega' },
      { display: 'Γ', insert: '\\Gamma ', preview: '\\Gamma' },
      { display: 'Δ', insert: '\\Delta ', preview: '\\Delta' },
      { display: 'Θ', insert: '\\Theta ', preview: '\\Theta' },
      { display: 'Λ', insert: '\\Lambda ', preview: '\\Lambda' },
      { display: 'Ξ', insert: '\\Xi ', preview: '\\Xi' },
      { display: 'Π', insert: '\\Pi ', preview: '\\Pi' },
      { display: 'Σ', insert: '\\Sigma ', preview: '\\Sigma' },
      { display: 'Φ', insert: '\\Phi ', preview: '\\Phi' },
      { display: 'Ψ', insert: '\\Psi ', preview: '\\Psi' },
      { display: 'Ω', insert: '\\Omega ', preview: '\\Omega' },
    ],
  },
];
