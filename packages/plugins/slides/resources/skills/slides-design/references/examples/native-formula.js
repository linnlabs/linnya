// Runnable single-slide deck.js example.
// Use as standalone source; do not concatenate with another example.
//
// 语法重点：独立原生公式与同段行内公式。公式不是 SVG 或图片，导出后可在 PowerPoint 编辑。

const ink = "#173B57";

const slide = createSlide({ background: { color: "#F7F8FA" } });

const title = createText("从一般形式到求根公式");
title.fontSize = 18;
title.fontWeight = "bold";
title.color = ink;

const explanation = createText([
  { text: "对于二次方程 " },
  { formula: { latex: "ax^2+bx+c=0", altText: "一元二次方程一般形式" }, style: { fontSize: 18, color: ink } },
  { text: "，判别式决定实根数量。" },
]);
explanation.fontSize = 15;
explanation.color = "#344054";
explanation.width = 8.8;

const formula = createFormula({
  latex: "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}",
  fontSize: 34,
  color: ink,
  align: "center",
  altText: "一元二次方程求根公式",
});
formula.width = 8.8;
formula.height = 1.45;

const content = createFrame();
content.flexDirection = "column";
content.gap = 0.35;
content.padding = { left: 0.6, right: 0.6, top: 0.55, bottom: 0.55 };
content.add(title, explanation, formula);

slide.add(content);

compose({
  title: "Native Formula · Runnable Example",
  slides: [slide],
  theme: {
    colors: { accent1: ink, background: "#F7F8FA", text: "#101828", muted: "#667085" },
    fonts: { major: "Arial", minor: "Arial" },
  },
});
