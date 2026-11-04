// Runnable 3-slide deck.js example. Use as standalone source; do not concatenate with another example.
//
// 对应风格指南：style-cultural-imagery.md。
// 语法与机械做法重点：书法大字与去背实物的位置关系（实物压住大字边缘）、器物落影的径向渐变椭圆、
// 朱印（Frame 加居中 Text）、原生竖排小字、墨色页与宣纸页的节奏。
// 颜色和字体都从顶部的 direction 读取，这里填的是中性占位值，不是推荐配色；
// 实际取值来自本稿的视觉方向。字号和版面也是一次性选择，换题材时要换。

const PW = 13.333;
const PH = 7.5;

const direction = {
  drawId: "example",
  cardId: "example",
  palette: { backgrounds: ["#EFEFEC", "#1C1C1C"], ink: "#1C1C1C", accents: ["#6A6A6A"] },
  fonts: ["SimSun", "KaiTi", "STXingkai"],
};
const INK = direction.palette.ink;
const PAPER = direction.palette.backgrounds[0];
const CREAM = "#E6E6E3";
const MUTED = "#8A8A8A";
const SEAL = direction.palette.accents[0];
const SERIF = direction.fonts[0];
const KAI = direction.fonts[1];
const BRUSH = direction.fonts[2];

// Text 自带约 0.1in 的左右内边距和 0.05in 的上内边距；整体外扩，让文字边缘落在给定坐标上。
function text(content, o) {
  const n = createText(content);
  n.position = "absolute";
  n.x = o.x - 0.1;
  n.y = o.y - 0.05;
  if (o.w) n.w = o.w + 0.2;
  if (o.h) n.h = o.h + 0.1;
  n.fontSize = o.size || 12;
  n.color = o.color || INK;
  n.fontFamily = o.font || SERIF;
  n.lineHeight = o.lh || 1.5;
  if (o.align) n.textAlign = o.align;
  if (o.writingMode) n.writingMode = o.writingMode;
  return n;
}

function rect(x, y, w, h, fill) {
  const s = createShape({ fill: fill });
  s.position = "absolute";
  s.x = x;
  s.y = y;
  s.w = w;
  s.h = h;
  return s;
}

// 透明 PNG 不要用矩形 shadow；在器物下垫一个径向渐变椭圆。
function groundShadow(x, y, w, h, strength) {
  const s = createShape({
    geometry: "ellipse",
    fill: {
      type: "radial",
      stops: [
        { color: "#000000", position: 0, opacity: strength },
        { color: "#000000", position: 1, opacity: 0 },
      ],
    },
  });
  s.position = "absolute";
  s.x = x;
  s.y = y;
  s.w = w;
  s.h = h;
  return s;
}

// 朱印：矩形底加居中原生 Text，导出后仍可编辑。字号要算上 Text 默认的左右内边距，否则会折行。
function seal(char, x, y, size) {
  const f = createFrame({
    flexDirection: "column",
    backgroundColor: SEAL,
    borderRadius: 0.03,
    justifyContent: "center",
    alignItems: "center",
  });
  f.position = "absolute";
  f.x = x;
  f.y = y;
  f.w = size;
  f.h = size;
  const t = createText(char);
  t.fontFamily = BRUSH;
  t.fontSize = size * 40;
  t.color = PAPER;
  f.add(t);
  return f;
}

// slide 1 — 封面：书法大字（图）在左，去背器物在右并压住版面
const s1 = createSlide({
  background: {
    gradient: {
      type: "radial",
      center: { x: 0.7, y: 0.5 },
      stops: [
        { color: "#2A2A2A", position: 0 },
        { color: "#1B1B1B", position: 0.6 },
        { color: "#151515", position: 1 },
      ],
    },
  },
});
// 真实稿件在此用 createImage 放书法字 PNG 与去背器物 PNG；示例用形状占位，避免依赖外部文件。
const glyph = createShape({ geometry: "roundRect", fill: CREAM });
glyph.position = "absolute";
glyph.x = 0.85;
glyph.y = 0.7;
glyph.w = 3.2;
glyph.h = 4.2;
const vessel = createShape({ geometry: "ellipse", fill: "#4A4A4A" });
vessel.position = "absolute";
vessel.x = 5.6;
vessel.y = 1.6;
vessel.w = 6.8;
vessel.h = 3.2;
s1.add(
  glyph,
  groundShadow(6.2, 4.3, 5.6, 0.8, 0.75),
  vessel,
  text("中国茶事", { x: 0.95, y: 5.3, w: 5, size: 34, color: CREAM }),
  text("从唐人煎茶，到宋人点茶，到明清的一壶散茶。", { x: 0.98, y: 6.3, w: 7, size: 15, color: "#A0A0A0", font: KAI }),
  seal("茶", 4.7, 5.45, 0.5),
);

// slide 2 — 宣纸页：正文与引文，旁边一条原生竖排小字
const s2 = createSlide({ background: { color: PAPER } });
s2.add(
  text("黑盏白沫", { x: 0.9, y: 0.7, w: 5, size: 30 }),
  text("宋人点茶，茶汤要白，盏要黑。福建建窑烧的黑釉盏胎厚、保温久，是斗茶时最受欢迎的盏。", { x: 0.9, y: 1.6, w: 4.6, size: 12, lh: 1.75 }),
  text("建安所造者绀黑，纹如兔毫，其坯微厚，熁之久热难冷，最为要用。", { x: 1.2, y: 3.4, w: 4.2, size: 15, font: KAI, lh: 1.8 }),
  text("蔡襄《茶录》，北宋", { x: 1.2, y: 5.0, w: 4.2, size: 9.5, color: MUTED, font: KAI }),
  text("一盏千年", { x: 12.1, y: 0.8, h: 2.6, size: 18, color: MUTED, font: KAI, writingMode: "vertical-rl" }),
  rect(6.2, 1.0, 5.4, 4.8, "#D6D6D6"),
);

// slide 3 — 章节页：墨色底、一个大字、一条图带，给节奏换气
const s3 = createSlide({
  background: {
    gradient: {
      type: "radial",
      center: { x: 0.7, y: 0.5 },
      stops: [
        { color: "#2A2A2A", position: 0 },
        { color: "#1B1B1B", position: 0.6 },
        { color: "#151515", position: 1 },
      ],
    },
  },
});
s3.add(
  text("贰", { x: 0.95, y: 0.8, w: 1.2, size: 30, color: SEAL, font: KAI }),
  text("宋", { x: 0.95, y: 1.5, w: 1.2, size: 15, color: "#A0A0A0", font: KAI }),
  rect(0, 2.9, PW, 1.7, "#333333"),
  text("一盏白沫", { x: 0.95, y: 5.1, w: 8, size: 30, color: CREAM }),
  text("茶末入盏，注水，用茶筅击出一层汤花。", { x: 0.98, y: 5.85, w: 8, size: 15, color: "#A0A0A0", font: KAI }),
);

compose({
  title: "Cultural Imagery · Runnable Example",
  layout: { width: PW, height: PH, unit: "in" },
  slides: [s1, s2, s3],
  theme: {
    colors: { accent1: SEAL, accent2: MUTED, background: PAPER, text: INK, muted: MUTED },
    fonts: { major: SERIF, minor: KAI },
    direction,
  },
});
