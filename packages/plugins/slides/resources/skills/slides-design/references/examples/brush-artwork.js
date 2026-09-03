// Runnable single-slide deck.js example.
// Brush 是不透明图片资产；文字始终使用原生 Text 覆盖。

const paper = "#F2E4C7";
const ink = "#2F2923";
const rust = "#A7472F";
const olive = "#66704A";
const blue = "#627B91";

/** @type {Array<[number, number]>} */
const flowerCenters = [
  [20, 74],
  [36, 82],
  [73, 75],
  [86, 87],
];
/** @type {Array<{type: "ellipse", center: [number, number], radiusX: number, radiusY: number, irregularity: number}>} */
const petals = [];
for (const [cx, cy] of flowerCenters) {
  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI * 2 * index) / 6;
    petals.push({
      type: "ellipse",
      center: [cx + Math.cos(angle) * 4.2, cy + Math.sin(angle) * 3.2],
      radiusX: 3.3,
      radiusY: 1.8,
      irregularity: 0.55,
    });
  }
}

/** @type {Array<{type: "spline", points: Array<[number, number]>, curvature: number}>} */
const stems = [];
/** @type {Array<{type: "ellipse", center: [number, number], radiusX: number, radiusY: number, irregularity: number}>} */
const flowerDiscs = [];
for (const [index, [x, y]] of flowerCenters.entries()) {
  stems.push({
    type: "spline",
    points: [[50, 98], [48 + index * 2, 88], [x + 3, y + 7], [x, y]],
    curvature: 0.58,
  });
  flowerDiscs.push({
    type: "ellipse",
    center: [x, y],
    radiusX: 2.1,
    radiusY: 1.7,
    irregularity: 0.35,
  });
}

const slide = createSlide({ background: { color: paper } });

slide.add(createBrushArtwork({
  seed: 1907,
  backgroundColor: paper,
  quality: "standard",
  layers: [
    {
      fill: {
        kind: "watercolor",
        color: rust,
        opacity: 52,
        bleed: 0.26,
        texture: 0.72,
        border: 0.22,
      },
      marks: [
        { type: "ellipse", center: [23, 28], radiusX: 25, radiusY: 17, irregularity: 0.48 },
        { type: "ellipse", center: [78, 24], radiusX: 20, radiusY: 14, irregularity: 0.36 },
      ],
    },
    {
      fill: {
        kind: "mass",
        brush: "pastel",
        color: blue,
        precision: 0.62,
        strength: 0.72,
        gradient: 0.2,
      },
      marks: [{
        type: "polygon",
        points: [[0, 64], [18, 57], [37, 63], [58, 52], [77, 60], [100, 48], [100, 100], [0, 100]],
      }],
    },
    {
      stroke: { brush: "charcoal", color: olive, weight: 0.48 },
      field: "hand",
      marks: stems,
    },
    {
      fill: { kind: "wash", color: "#D18B6E", opacity: 178 },
      stroke: { brush: "crayon", color: rust, weight: 0.34 },
      marks: petals,
    },
    {
      fill: { kind: "wash", color: "#D8B45B", opacity: 220 },
      marks: flowerDiscs,
    },
    {
      stroke: { brush: "rotring", color: ink, weight: 0.18 },
      hatch: {
        brush: "2H",
        color: "#756556",
        weight: 0.16,
        spacing: 2.4,
        angle: 28,
        randomness: 0.08,
      },
      marks: [{ type: "rect", x: 6, y: 5, width: 88, height: 90 }],
    },
  ],
  position: "absolute",
  x: 0,
  y: 0,
  width: 8.5,
  height: 11,
  alt: "复古纸张上的水彩山丘、炭笔花茎与手绘花朵",
}));

slide.add(createText({
  content: "FIELD NOTES",
  position: "absolute",
  x: 0.85,
  y: 1.12,
  width: 6.8,
  height: 0.62,
  fontFamily: "Georgia",
  fontSize: 28,
  fontWeight: "bold",
  color: ink,
  textAlign: "center",
  letterSpacing: 2.2,
}));

slide.add(createText({
  content: "A SMALL STUDY OF WILD GROWTH · 1907 / 2026",
  position: "absolute",
  x: 1.15,
  y: 1.88,
  width: 6.2,
  height: 0.36,
  fontFamily: "Georgia",
  fontSize: 9,
  color: ink,
  textAlign: "center",
  letterSpacing: 1.1,
}));

compose({
  title: "Brush Artwork · Declarative Drawing",
  layout: { width: 8.5, height: 11, unit: "in" },
  slides: [slide],
  theme: {
    colors: { accent1: rust, background: paper, text: ink, muted: "#756556" },
    fonts: { major: "Georgia", minor: "Songti SC" },
  },
});
