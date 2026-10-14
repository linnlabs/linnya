// Runnable single-slide deck.js example.
// Use as standalone source; do not concatenate with another example.
//
// SVG 负责整体矢量图，标签是独立可编辑 Text；Frame 把两者纳入同一移动/删除范围。
// Frame 与 viewBox 同比例，采用每英寸 100 个 SVG 单位；标签坐标直接除以 100。
// 这不是自动标签 API；不要单独移动/旋转 SVG 后假定同级 Text 会自动跟随。

const palette = {
  accent1: "#175B73",
  accent2: "#DCEEF2",
  background: "#FFFFFF",
  surface: "#F3F7F8",
  text: "#163544",
  muted: "#526B78",
};
const diagramWidth = 9;
const diagramHeight = 3.6;
const viewWidth = diagramWidth * 100;
const viewHeight = diagramHeight * 100;
const modules = [
  { key: "collect", x: 60, label: "采集" },
  { key: "process", x: 345, label: "处理" },
  { key: "deliver", x: 630, label: "交付" },
];

// 重复图元由普通 JavaScript 展开，不依赖 use/symbol；所有色值与 theme 共用同一组常量。
const moduleGraphics = modules.map(module => `
  <g transform="translate(${module.x} 80)">
    <rect width="210" height="120" rx="16" fill="url(#module-fill)" stroke="${palette.accent1}" stroke-width="2"/>
    <path d="M16 20H194" stroke="${palette.accent1}" stroke-width="2"/>
    <circle cx="24" cy="100" r="4" fill="${palette.accent1}"/>
    <circle cx="40" cy="100" r="4" fill="${palette.accent1}"/>
    <circle cx="56" cy="100" r="4" fill="${palette.accent1}"/>
  </g>`).join("");
const svg = `<svg viewBox="0 0 ${viewWidth} ${viewHeight}">
  <defs>
    <linearGradient id="module-fill" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0" stop-color="${palette.background}"/>
      <stop offset="1" stop-color="${palette.accent2}"/>
    </linearGradient>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0 0L10 5L0 10Z" fill="${palette.accent1}"/>
    </marker>
  </defs>
  <path d="M270 140H333" fill="none" stroke="${palette.accent1}" stroke-width="3" marker-end="url(#arrow)"/>
  <path d="M555 140H618" fill="none" stroke="${palette.accent1}" stroke-width="3" marker-end="url(#arrow)"/>
  <path d="M735 206C735 300 165 300 165 206" fill="none" stroke="${palette.accent1}" stroke-width="2" stroke-dasharray="8 6" marker-end="url(#arrow)"/>
  ${moduleGraphics}
</svg>`;

const slide = createSlide({ slideKey: "pipeline-overview", background: { color: palette.background } });
slide.add(createText({
  editKey: "headline", content: "处理链路与反馈回路", fontSize: 24, fontWeight: "bold",
  color: palette.text, position: "absolute", x: 0.5, y: 0.3, width: 9, height: 0.6,
}));
slide.add(createText({
  editKey: "intro", content: "实线表示正向传递，虚线表示交付后的反馈。",
  fontSize: 13, color: palette.muted, position: "absolute", x: 0.5, y: 0.95, width: 9, height: 0.35,
}));

const diagram = createFrame({
  editKey: "pipeline", position: "absolute", x: 0.5, y: 1.4,
  width: diagramWidth, height: diagramHeight, backgroundColor: palette.surface,
});
diagram.add(createSvgGraphic({
  editKey: "pipeline-art", source: svg, fit: "contain",
  position: "absolute", x: 0, y: 0, width: diagramWidth, height: diagramHeight,
  altText: "三个模块依次连接；末端沿下方弧线向首端反馈。模块名称由覆盖的原生文字提供。",
}));
for (const module of modules) {
  diagram.add(createText({
    editKey: `label-${module.key}`, content: module.label,
    position: "absolute", x: (module.x + 16) / 100, y: 115 / 100,
    width: 178 / 100, height: 50 / 100,
    fontSize: 16, fontWeight: "bold", color: palette.text,
    textAlign: "center", verticalAlign: "middle",
  }));
}
slide.add(diagram);
slide.add(createText({
  editKey: "caption", content: "示意图：模块与连接关系为虚构示例。", role: "footnote",
  fontSize: 10, color: palette.muted, position: "absolute", x: 0.5, y: 5.1, width: 9, height: 0.32,
}));

compose({
  title: "SVG Graphic · Runnable Example",
  layout: "16x9",
  slides: [slide],
  theme: {
    colors: palette,
    fonts: { major: "Arial", minor: "Arial" },
  },
});
