// Runnable 5-slide deck.js example. Use as standalone source; do not concatenate with another example.
//
// 对应风格指南：style-catalog-handout.md。
// 语法与机械做法重点：12 栏网格的坐标换算、编号图版与统一格式的图注、
// 用 Text 加细线手排的年表与对照表、图文对页与图录页两种页型，以及器物对照的图卡页。
// 配色、字号和版面是这份示例的一次性选择，不是默认风格；换题材时这些都要换。

const PW = 13.333;
const PH = 7.5;
const M = 0.75;
const GAP = 0.25;
const COL = (PW - 2 * M - 11 * GAP) / 12;

const PAPER = "#F7F3EA";
const INK = "#1E1C19";
const MUTED = "#5F594E";
const RULE = "#D5CDBC";
const ACCENT = "#54726B";
const SERIF = "SimSun";
const KAI = "KaiTi";

// 第 c 栏（从 0 起）的左边缘，以及跨 n 栏的宽度。所有元素的左右边线都落在栏线上。
function colX(c) { return M + c * (COL + GAP); }
function span(n) { return n * COL + (n - 1) * GAP; }

// Text 自带约 0.1in 的左右内边距和 0.05in 的上内边距；整体外扩，让文字边缘落在栏线上。
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
  n.lineHeight = o.lh || 1.6;
  if (o.align) n.textAlign = o.align;
  if (o.role) n.role = o.role;
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

function head(slide, left, right, folio) {
  slide.add(
    text(left, { x: M, y: 0.45, w: 6, size: 9, color: MUTED }),
    text(right, { x: PW - M - 6, y: 0.45, w: 6, size: 9, color: MUTED, align: "right" }),
    rect(M, 0.76, PW - 2 * M, 0.008, RULE),
    text(folio, { x: PW - M - 0.8, y: 7.05, w: 0.8, size: 9, color: MUTED, align: "right", role: "page-number" }),
  );
}

// 图注格式全稿一致：编号、名称、年代、藏地。
function caption(num, rest, x, y, w) {
  return text(num + "　" + rest, { x: x, y: y, w: w, size: 9, color: MUTED, font: KAI, lh: 1.45 });
}

// slide 1 — 图文对页：左 7 栏主图，右 5 栏正文
const s1 = createSlide({ background: { color: PAPER } });
head(s1, "汝窑　RU WARE", "宋代五大名窑　五窑之一", "01");
s1.add(
  text("汝窑：为宫廷烧了二十年的天青", { x: M, y: 0.92, w: 11, h: 0.62, size: 25, lh: 1.2 }),
  // 真实稿件在此用 createImage 放图版；示例用色块占位，避免依赖外部文件。
  rect(colX(0), 1.78, span(7), 4.2, "#C9D6D1"),
  caption("图 1", "天青釉洗　北宋　某某博物馆", colX(0), 6.1, span(7)),
  text("北宋晚期，盛烧约 1086—1106 年，窑址在河南宝丰清凉寺。釉薄而润，开片细碎，香灰色胎，满釉裹足，底留芝麻状支钉痕。", {
    x: colX(7), y: 1.78, w: span(5), size: 12, lh: 1.75,
  }),
  text("传世汝窑不足百件，窑址却出土了以吨计的标本，这种反差是理解汝窑的入口。", { x: colX(7), y: 3.6, w: span(5), size: 12, lh: 1.75 }),
  rect(colX(7), 5.3, span(5), 0.9, "#E7EDEA"),
  text("辨识要点", { x: colX(7) + 0.25, y: 5.42, w: 1.5, size: 9, color: ACCENT }),
  text("天青釉、香灰胎、芝麻钉三者齐备。", { x: colX(7) + 0.25, y: 5.72, w: span(5) - 0.4, size: 12 }),
);

// slide 2 — 图录页：一张主图加三张编号小图
const s2 = createSlide({ background: { color: PAPER } });
head(s2, "图录　PLATES", "宋代五大名窑", "02");
s2.add(text("五窑图录", { x: M, y: 0.92, w: 11, h: 0.62, size: 25, lh: 1.2 }), rect(colX(0), 1.78, span(6), 4.4, "#C9D6D1"), caption("图 2", "汝窑天青釉洗　北宋", colX(0), 6.3, span(6)));
["官窑粉青釉盘", "哥窑青釉笔洗", "钧窑玫瑰紫釉洗"].forEach(function (name, i) {
  const y = 1.78 + i * 1.5;
  s2.add(
    rect(colX(6), y, span(3), 1.18, "#D8DFE0"),
    caption("图 " + (3 + i), name, colX(6), y + 1.22, span(3)),
    text("一句话说明这件器物与上一件的区别。", { x: colX(9), y: y, w: span(3), size: 11, lh: 1.6 }),
  );
});

// slide 3 — 年表：手排，公元与纪年左对齐，说明可换行
const s3 = createSlide({ background: { color: PAPER } });
head(s3, "年表　CHRONOLOGY", "宋代五大名窑", "03");
s3.add(text("年表：五窑并不在同一条时间线上", { x: M, y: 0.92, w: 11, h: 0.62, size: 25, lh: 1.2 }));
const years = [
  ["960", "建隆元年", "定窑白瓷已行销南北", "赵匡胤代周建宋"],
  ["1086—1106", "元祐—崇宁", "汝窑为宫廷烧造天青釉御用瓷，约二十年", "哲宗、徽宗朝"],
  ["1127", "靖康二年", "汝窑与北宋官窑停烧，窑工南迁", "北宋亡"],
  ["约 1150—1200", "绍兴—庆元", "修内司官窑烧造，其后郊坛下别立新窑", "南宋定都临安"],
];
const xs = [colX(0), colX(2), colX(4), colX(9)];
const ws = [span(2) - 0.1, span(2) - 0.1, span(5) - 0.1, span(3)];
s3.add(rect(M, 1.85, PW - 2 * M, 0.012, INK));
years.forEach(function (r, i) {
  const y = 2.05 + i * 0.62;
  r.forEach(function (cell, j) {
    s3.add(text(cell, { x: xs[j], y: y, w: ws[j], size: j === 0 ? 13 : 11.5, color: j === 1 || j === 3 ? MUTED : INK, lh: 1.4 }));
  });
  s3.add(rect(M, y + 0.5, PW - 2 * M, 0.008, RULE));
});

// slide 4 — 对照表：首列是维度，其余列等宽，每格不超过两行
const s4 = createSlide({ background: { color: PAPER } });
head(s4, "对照表　COMPARISON", "宋代五大名窑", "04");
s4.add(text("五窑一览：把特征放回工艺里", { x: M, y: 0.92, w: 11, h: 0.62, size: 25, lh: 1.2 }));
const kilns = ["汝窑", "官窑", "哥窑"];
const dims = [
  ["釉", "天青，薄而润", "粉青，多次施釉", "灰青、米黄，厚"],
  ["开片", "细碎稀疏", "大开片，冰裂", "金丝铁线，双色"],
  ["装烧", "满釉支钉烧", "素烧后多次施釉", "与官窑相近"],
];
const cx = [colX(0), colX(2), colX(5), colX(8)];
const cwid = [span(2) - 0.1, span(3) - 0.1, span(3) - 0.1, span(4) - 0.1];
s4.add(rect(M, 2.0, PW - 2 * M, 0.012, INK));
kilns.forEach(function (k, j) {
  s4.add(text(k, { x: cx[j + 1], y: 1.62, w: cwid[j + 1], size: 14 }));
});
dims.forEach(function (r, i) {
  const y = 2.2 + i * 0.7;
  r.forEach(function (cell, j) {
    s4.add(text(cell, { x: cx[j], y: y, w: cwid[j], size: j === 0 ? 9 : 11.5, color: j === 0 ? MUTED : INK }));
  });
  s4.add(rect(M, y + 0.55, PW - 2 * M, 0.008, RULE));
});

// slide 5 — 图卡对照：器物对照先给图。每张图下半部叠一层由透明到不透明的黑色渐变，
// 名称和一句特征写在渐变上；一页放三到四张，器物多就拆成两页，表格只留给图上放不下的细节。
const s5 = createSlide({ background: { color: PAPER } });
head(s5, "对照　COMPARISON", "宋代五大名窑", "05");
s5.add(text("看釉看片：三窑放在一起比", { x: M, y: 0.92, w: 11, h: 0.62, size: 25, lh: 1.2 }));
const cards = [
  ["汝窑", "天青釉，薄而润，开片细碎", "#9FB3AE"],
  ["官窑", "粉青厚釉，大开片如冰裂", "#B9B7A6"],
  ["哥窑", "米黄灰青，金丝铁线", "#B7A78C"],
];
cards.forEach(function (c, i) {
  const x = colX(i * 4);
  const w = span(4);
  // 真实稿件在这里用 createImage({ ..., fitMode: "cover" }) 放器物照片；示例用色块占位。
  s5.add(
    rect(x, 1.85, w, 4.6, c[2]),
    createShape({
      position: "absolute", x: x, y: 1.85 + 4.6 * 0.45, width: w, height: 4.6 * 0.55,
      fill: { type: "linear", direction: "to-bottom", stops: [
        { color: "#000000", position: 0, opacity: 0 },
        { color: "#000000", position: 0.6, opacity: 0.55 },
        { color: "#000000", position: 1, opacity: 0.85 },
      ] },
    }),
    text(c[0], { x: x + 0.3, y: 5.3, w: w - 0.6, size: 20, color: "#FFFFFF" }),
    text(c[1], { x: x + 0.3, y: 5.82, w: w - 0.6, size: 11.5, color: "#E9E4DA", lh: 1.45 }),
  );
});
s5.add(text("图片：此处写明器物名称、藏地与图片许可。", { x: M, y: 6.62, w: 8, size: 9, color: MUTED }));

compose({
  title: "Catalog Handout · Runnable Example",
  layout: { width: PW, height: PH, unit: "in" },
  slides: [s1, s2, s3, s4, s5],
  theme: {
    colors: { accent1: ACCENT, accent2: "#9E3B2A", background: PAPER, text: INK, muted: MUTED },
    fonts: { major: SERIF, minor: KAI },
  },
});
