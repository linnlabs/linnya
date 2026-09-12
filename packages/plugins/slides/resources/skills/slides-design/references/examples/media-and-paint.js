// 视觉材料与 Paint 能力对照 —— 图片、渐变、自定义几何、表格单元格与富文本。
// 这份 source 的用途是"确认某个能力怎么写"，不是版式模板。
// 每页只演示一类能力，页面本身不构成一份可提交的文稿。

const ink = "#141A20";
const sand = "#EDE7DC";
const clay = "#B4552F";

// slide 1 — 图片：适配模式、圆形遮罩、阴影与透明度。
// createImage 的 src 必须是运行时真实可读的地址：
//   - "conversation:/..."   本次对话产出的文件（generate_image 结果、shell 处理产物）
//   - "https://..."         外部 URL
//   - "data:image/..."      data URI
//   - "/绝对/路径.png"       宿主可读的绝对路径
// Workspace 虚拟路径不是图片二进制地址。下面的 locator 全是占位，提交前必须替换。
const imageSlide = createSlide({ background: { color: "#FFFFFF" } });

const imageTitle = createText("图片：fitMode 决定裁切方式，maskShape 决定轮廓");
imageTitle.fontSize = 15;
imageTitle.fontWeight = "bold";
imageTitle.color = ink;
imageTitle.height = 0.44;

function makeImageDemo(caption, image) {
  const cell = createFrame({ flexDirection: "column" });
  cell.flex = 1;

  image.flex = 1;

  const captionText = createText(caption);
  captionText.fontSize = 8.5;
  captionText.color = "#6E7781";
  captionText.height = 0.24;
  captionText.marginTop = 0.12;

  cell.add(image, captionText);
  return cell;
}

// fitMode: "cover" 铺满并裁掉溢出部分，构图优先；"contain" 完整放下，可能留边。
// "crop" 与 cover 在渲染上等价，用于表达"有意裁切"的语义。
const coverDemo = createImage({
  src: "conversation:/images/REPLACE-cover.jpg",
  fitMode: "cover",
});
const containDemo = createImage({
  src: "conversation:/images/REPLACE-contain.jpg",
  fitMode: "contain",
});
// maskShape: "circle" 把图片裁成圆形，适合人像；shadow 让它从背景浮起。
const portraitDemo = createImage({
  src: "conversation:/images/REPLACE-portrait.jpg",
  fitMode: "cover",
  maskShape: "circle",
  shadow: { color: "#000000", blur: 10, angle: 90, distance: 3, opacity: 0.28 },
});
// transparency 是 0–1 的透明度，用于把图片压成背景层而不是主体。
const fadedDemo = createImage({
  src: "conversation:/images/REPLACE-faded.jpg",
  fitMode: "cover",
  transparency: 0.55,
});

const imageRow = createFrame({ flexDirection: "row", gap: 0.26 });
imageRow.flex = 1;
imageRow.marginTop = 0.24;
imageRow.add(
  makeImageDemo('fitMode "cover"（裁切铺满）', coverDemo),
  makeImageDemo('fitMode "contain"（完整放下）', containDemo),
  makeImageDemo('maskShape "circle" + shadow', portraitDemo),
  makeImageDemo("transparency 0.55（退为背景）", fadedDemo),
);

const imageBody = createFrame({
  flexDirection: "column",
  padding: { left: 0.5, right: 0.5, top: 0.4, bottom: 0.45 },
});
imageBody.flex = 1;
imageBody.add(imageTitle, imageRow);
imageSlide.add(imageBody);

// slide 2 — Paint：纯色、线性渐变、径向渐变与渐变描边。
// 渐变至少两个 stop，position 按 0–1 非递减；stop 上的 opacity 也是 0–1。
// linear 的 angle 以 0° 向右、90° 向下为基准，顺时针增长。
const paintSlide = createSlide({ background: { color: "#FFFFFF" } });

const paintTitle = createText("Paint：纯色、linear、radial 与渐变描边");
paintTitle.fontSize = 15;
paintTitle.fontWeight = "bold";
paintTitle.color = ink;
paintTitle.height = 0.44;

// 复用型工厂：把 fill 直接写在 createShape(config) 里，是渐变唯一稳妥的写法。
// 先 createShape() 再 shape.fill = { type: "linear", ... } 会被 sandbox typecheck 拒绝，
// 因为 .js 下对象字面量赋值给属性时 "linear" 会被放宽成 string。
function makeSwatch(caption, shape) {
  const cell = createFrame({ flexDirection: "column" });
  cell.flex = 1;

  shape.flex = 1;

  const captionText = createText(caption);
  captionText.fontSize = 8.5;
  captionText.color = "#6E7781";
  captionText.height = 0.24;
  captionText.marginTop = 0.12;

  cell.add(shape, captionText);
  return cell;
}

const solidSwatch = createShape({ fill: clay, borderRadius: 0.1 });

// 半透明纯色：用 { color, transparency } 而不是另开一个 opacity 字段。
const tintedSwatch = createShape({
  fill: { color: clay, transparency: 55 },
  borderRadius: 0.1,
});

const linearSwatch = createShape({
  fill: {
    type: "linear",
    angle: 135,
    stops: [
      { color: "#12233F", position: 0 },
      { color: "#4E8FA8", position: 1 },
    ],
  },
  borderRadius: 0.1,
});

// radial 的 center/radius 是元素边界框内的归一化坐标，默认都是 0.5。
const radialSwatch = createShape({
  fill: {
    type: "radial",
    stops: [
      { color: "#FFD9A0", position: 0 },
      { color: "#C2482D", position: 1 },
    ],
    center: { x: 0.35, y: 0.3 },
  },
  borderRadius: 0.1,
});

// 描边可以用 border.paint 接 linear gradient；radial stroke 是明确不支持的能力边界。
const strokeSwatch = createShape({
  fill: "#FFFFFF",
  border: {
    paint: {
      type: "linear",
      angle: 90,
      stops: [
        { color: "#C2482D", position: 0 },
        { color: "#12233F", position: 1 },
      ],
    },
    width: 3,
  },
  borderRadius: 0.1,
});

const paintRow = createFrame({ flexDirection: "row", gap: 0.26 });
paintRow.flex = 1;
paintRow.marginTop = 0.24;
paintRow.add(
  makeSwatch("纯色", solidSwatch),
  makeSwatch("纯色 + transparency", tintedSwatch),
  makeSwatch("linear 135°", linearSwatch),
  makeSwatch("radial（偏心）", radialSwatch),
  makeSwatch("linear 渐变描边", strokeSwatch),
);

const paintBody = createFrame({
  flexDirection: "column",
  padding: { left: 0.5, right: 0.5, top: 0.4, bottom: 0.45 },
});
paintBody.flex = 1;
paintBody.add(paintTitle, paintRow);
paintSlide.add(paintBody);

// slide 3 — 几何：preset、参数化几何、polygon 与 typed path。
// geometry 同样必须写在 createShape(config) 里；先创建再赋值会被 typecheck 拒绝。
const geometrySlide = createSlide({ background: { color: sand } });

const geometryTitle = createText("Shape geometry：preset、参数化、polygon 与 path");
geometryTitle.fontSize = 15;
geometryTitle.fontWeight = "bold";
geometryTitle.color = ink;
geometryTitle.height = 0.44;

function makeGeometryDemo(caption, shape) {
  const cell = createFrame({ flexDirection: "column", alignItems: "center" });
  cell.flex = 1;

  shape.flex = 1;
  shape.width = "100%";

  const captionText = createText(caption);
  captionText.fontSize = 8;
  captionText.color = "#6E7781";
  captionText.textAlign = "center";
  captionText.height = 0.24;
  captionText.marginTop = 0.1;

  cell.add(shape, captionText);
  return cell;
}

// 1) preset 简写：直接传名字字符串。
const presetStar = createShape({ geometry: "star5", fill: clay });

// 2) preset 完整写法：与简写等价，适合需要显式表达意图时。
const presetChevron = createShape({ geometry: { type: "preset", name: "chevron" }, fill: "#12233F" });

// 3) 参数化正多边形：sides 决定边数，rotation 默认 -90（首个顶点朝上）。
const hexagon = createShape({ geometry: { type: "regularPolygon", sides: 6 }, fill: "#2E5F8A" });

// 4) 参数化梯形：两个 inset 是相对 shape 宽度的比例，0..1。
const trapezoid = createShape({
  geometry: { type: "trapezoid", topLeftInset: 0.28, topRightInset: 0.12 },
  fill: "#4E8FA8",
});

// 5) 参数化平行四边形：slant 是相对宽度的倾斜比例，0..0.5。
const parallelogram = createShape({
  geometry: { type: "parallelogram", slant: 0.22, direction: "right" },
  fill: "#7FA8B8",
});

// 6) polygon：任意顶点，坐标是 shape 内的归一化值（0..1），最多 256 点。
const arrowPolygon = createShape({
  geometry: {
    type: "polygon",
    points: [
      { x: 0, y: 0.3 },
      { x: 0.6, y: 0.3 },
      { x: 0.6, y: 0 },
      { x: 1, y: 0.5 },
      { x: 0.6, y: 1 },
      { x: 0.6, y: 0.7 },
      { x: 0, y: 0.7 },
    ],
  },
  fill: "#8A5A3B",
});

// 7) typed path：需要曲线时使用，坐标属于自定义 viewBox，最多 512 条命令。
// 命令类型：moveTo / lineTo / quadraticTo / cubicTo / close。
const bladePath = createShape({
  geometry: {
    type: "path",
    viewBox: { width: 100, height: 100 },
    commands: [
      { type: "moveTo", x: 4, y: 96 },
      { type: "cubicTo", x1: 18, y1: 34, x2: 52, y2: 6, x: 96, y: 4 },
      { type: "quadraticTo", x1: 62, y1: 46, x: 52, y: 96 },
      { type: "close" },
    ],
  },
  fill: "#1F6F5C",
});

const geometryRow = createFrame({ flexDirection: "row", gap: 0.2 });
geometryRow.flex = 1;
geometryRow.marginTop = 0.24;
geometryRow.add(
  makeGeometryDemo('preset "star5"', presetStar),
  makeGeometryDemo('preset "chevron"', presetChevron),
  makeGeometryDemo("regularPolygon 6", hexagon),
  makeGeometryDemo("trapezoid", trapezoid),
  makeGeometryDemo("parallelogram", parallelogram),
  makeGeometryDemo("polygon（箭头）", arrowPolygon),
  makeGeometryDemo("path（曲线）", bladePath),
);

const geometryBody = createFrame({
  flexDirection: "column",
  padding: { left: 0.5, right: 0.5, top: 0.4, bottom: 0.45 },
});
geometryBody.flex = 1;
geometryBody.add(geometryTitle, geometryRow);
geometrySlide.add(geometryBody);

// slide 4 — 富文本 run。
// Text 在普通页面和含 chart/table 的页面都保留 run 及局部样式。
// Shape 内文只支持纯文本；需要段落内混合样式时使用独立 Text。
const richSlide = createSlide({ background: { color: "#FFFFFF" } });

const richTitle = createText("富文本 run：段落内混合样式");
richTitle.fontSize = 15;
richTitle.fontWeight = "bold";
richTitle.color = ink;
richTitle.height = 0.44;

// createText 接受 run 数组，用于在一段文字内混合样式；
// 只有确实需要局部强调时才用，整段同样式时直接传字符串。
const richParagraph = createText([
  { text: "结论：", style: { bold: true, color: ink } },
  { text: "混合方案在 " },
  { text: "3 个月", style: { bold: true, color: clay } },
  { text: " 内可上线，TCO 比自研低 " },
  { text: "39%", style: { bold: true, color: "#1F6F5C" } },
  { text: "，且保留关键链路的自主可控。" },
]);
richParagraph.fontSize = 13;
richParagraph.color = "#3D444D";
richParagraph.lineHeight = 1.55;
richParagraph.height = 0.9;
richParagraph.marginTop = 0.2;

const richNote = createText("同一段落内，只有需要被单独读出的词才加重；整段同样式时直接传字符串，不要拆成 run。");
richNote.fontSize = 9.5;
richNote.color = "#6E7781";
richNote.lineHeight = 1.45;
richNote.marginTop = 0.35;
richNote.flex = 1;

const richBody = createFrame({
  flexDirection: "column",
  padding: { left: 0.5, right: 1.6, top: 0.4, bottom: 0.45 },
});
richBody.flex = 1;
richBody.add(richTitle, richParagraph, richNote);
richSlide.add(richBody);

// slide 5 — TableCell 逐格样式：底色、文字样式与强调列。
const tableSlide = createSlide({ background: { color: "#FFFFFF" } });

const tableTitle = createText("TableCell：逐格样式、rowspan 与 colspan");
tableTitle.fontSize = 15;
tableTitle.fontWeight = "bold";
tableTitle.color = ink;
tableTitle.height = 0.44;

// headers 与 rows 的每一格都可以是纯字符串，或带 fill / style 的 TableCell 对象。
const styledTable = createTable({
  headers: [
    { text: "维度组", fill: "#12233F", style: { color: "#FFFFFF", bold: true } },
    { text: "指标", fill: "#12233F", style: { color: "#FFFFFF", bold: true } },
    { text: "自研", fill: "#12233F", style: { color: "#FFFFFF", bold: true } },
    { text: "混合方案", fill: clay, style: { color: "#FFFFFF", bold: true } },
  ],
  rows: [
    [
      { text: "交付", rowspan: 2, fill: "#F2F4F5", style: { bold: true } },
      "上线速度",
      "9 个月",
      { text: "3 个月", style: { bold: true } },
    ],
    ["变更响应", "慢", { text: "快", style: { bold: true } }],
    ["经济性", "三年 TCO", "$180k", { text: "$110k", style: { bold: true } }],
    [
      { text: "建议", colspan: 2, fill: "#E8F1EC", style: { color: "#1F6F5C", bold: true } },
      { text: "采用混合方案", colspan: 2, fill: "#E8F1EC", style: { color: "#1F6F5C", bold: true } },
    ],
  ],
});
styledTable.flex = 1;
styledTable.marginTop = 0.24;

const tableBody = createFrame({
  flexDirection: "column",
  padding: { left: 0.5, right: 0.5, top: 0.4, bottom: 0.45 },
});
tableBody.flex = 1;
tableBody.add(tableTitle, styledTable);
tableSlide.add(tableBody);

compose({
  title: "视觉材料与 Paint 能力对照",
  slides: [imageSlide, paintSlide, geometrySlide, richSlide, tableSlide],
  theme: {
    colors: { accent1: clay, accent2: "#12233F", background: "#FFFFFF", text: ink, muted: "#6E7781" },
  },
});
