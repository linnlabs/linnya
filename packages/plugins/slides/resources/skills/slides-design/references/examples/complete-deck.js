// Runnable multi-slide deck.js example.
// Top-level createSlide() calls keep page boundaries visible to source inspection.
//
// 这份 source 的用途是展示"多页 deck 怎么组织"：共享常量、页面变量、唯一的 compose()，
// 以及一份写进 theme 的视觉系统。它的配色和版式是这份示例的选择，不是默认风格——
// 真实任务应当根据受众和内容另行决定颜色、字体与页面节奏。
//
// 注意页面节奏：封面留白、指标页密集、路线图递进、收束页回到留白。
// 四页都用同一种卡片行会让整份 deck 读起来像一页换了文字。

const navy = "#12233F";
const green = "#1F6F5C";
const muted = "#6B7480";
const surface = "#F5F7F8";

function makeMetricCard(value, label, detail, color) {
  const card = createFrame();
  card.flex = 1;
  card.flexDirection = "column";
  card.backgroundColor = surface;
  card.padding = 0.22;

  const valueText = createText(value);
  valueText.fontSize = 24;
  valueText.fontWeight = "bold";
  valueText.color = color;
  valueText.height = 0.5;

  const labelText = createText(label);
  labelText.fontSize = 10;
  labelText.fontWeight = "bold";
  labelText.color = "#0F172A";
  labelText.height = 0.26;

  const detailText = createText(detail);
  detailText.fontSize = 9;
  detailText.color = muted;
  detailText.lineHeight = 1.35;
  detailText.flex = 1;
  detailText.marginTop = 0.08;

  card.add(valueText, labelText, detailText);
  return card;
}

function makePhaseCard(number, title, detail) {
  const card = createFrame();
  card.flex = 1;
  card.flexDirection = "column";
  card.backgroundColor = surface;
  card.padding = 0.22;

  const numberText = createText(number);
  numberText.fontSize = 12;
  numberText.fontWeight = "bold";
  numberText.color = green;
  numberText.height = 0.28;

  const titleText = createText(title);
  titleText.fontSize = 13;
  titleText.fontWeight = "bold";
  titleText.color = navy;
  titleText.height = 0.38;

  const detailText = createText(detail);
  detailText.fontSize = 9;
  detailText.color = muted;
  detailText.lineHeight = 1.4;
  detailText.flex = 1;

  card.add(numberText, titleText, detailText);
  return card;
}

// slide 1 — cover
const coverSlide = createSlide();
coverSlide.background = { color: "#FFFFFF" };

const coverBar = createShape();
coverBar.position = "absolute";
coverBar.left = 0;
coverBar.top = 0;
coverBar.width = "100%";
coverBar.height = 0.05;
coverBar.fill = navy;

const coverContent = createFrame();
coverContent.flex = 1;
coverContent.flexDirection = "column";
coverContent.padding = { left: 0.7, right: 0.7, top: 1.5, bottom: 0.6 };

const coverEyebrow = createText("年度经营复盘 · FY2025");
coverEyebrow.fontSize = 9;
coverEyebrow.color = muted;
coverEyebrow.height = 0.24;

const coverTitle = createText("增长质量持续改善\n下一阶段聚焦规模化复制");
coverTitle.fontSize = 27;
coverTitle.fontWeight = "bold";
coverTitle.color = navy;
coverTitle.lineHeight = 1.15;
coverTitle.height = 1.35;

const coverSubtitle = createText("经营结果、关键洞察与未来 90 天行动方案");
coverSubtitle.fontSize = 11;
coverSubtitle.color = muted;
coverSubtitle.height = 0.3;

const coverSpacer = createSpacer();
coverSpacer.flex = 1;

const coverFooter = createText("Strategy & Operations · 2026-01-15");
coverFooter.fontSize = 8;
coverFooter.color = muted;
coverFooter.height = 0.22;

coverContent.add(coverEyebrow, coverTitle, coverSubtitle, coverSpacer, coverFooter);
coverSlide.add(coverBar, coverContent);

// slide 2 — key metrics
const metricsSlide = createSlide();
metricsSlide.background = { color: "#FFFFFF" };

const metricsTitle = createText("ARR 增长 38%，留存与盈利同步改善");
metricsTitle.fontSize = 18;
metricsTitle.fontWeight = "bold";
metricsTitle.color = navy;
metricsTitle.position = "absolute";
metricsTitle.left = 0.55;
metricsTitle.top = 0.35;
metricsTitle.width = 8.9;
metricsTitle.height = 0.48;

const metricsRow = createFrame();
metricsRow.flexDirection = "row";
metricsRow.gap = 0.2;
metricsRow.padding = { left: 0.55, right: 0.55, top: 1.15, bottom: 0.65 };
metricsRow.flex = 1;
metricsRow.add(
  makeMetricCard("$240M", "ARR", "同比增长 38%，连续四个季度保持加速。", navy),
  makeMetricCard("132%", "净收入留存", "重点行业扩容推动留存同比提升 5 个百分点。", green),
  makeMetricCard("41%", "Rule of 40", "增长与利润率组合首次连续两个季度达标。", green),
);

metricsSlide.add(metricsTitle, metricsRow);

// slide 3 — action roadmap
const roadmapSlide = createSlide();
roadmapSlide.background = { color: "#FFFFFF" };

const roadmapTitle = createText("未来 90 天：验证、复制、规模化");
roadmapTitle.fontSize = 18;
roadmapTitle.fontWeight = "bold";
roadmapTitle.color = navy;
roadmapTitle.position = "absolute";
roadmapTitle.left = 0.55;
roadmapTitle.top = 0.35;
roadmapTitle.width = 8.9;
roadmapTitle.height = 0.48;

const phaseRow = createFrame();
phaseRow.flexDirection = "row";
phaseRow.gap = 0.2;
phaseRow.padding = { left: 0.55, right: 0.55, top: 1.15, bottom: 0.65 };
phaseRow.flex = 1;
phaseRow.add(
  makePhaseCard("01 · 第 1–30 天", "验证", "完成重点行业打法复盘，明确可复制的客户画像与销售动作。"),
  makePhaseCard("02 · 第 31–60 天", "复制", "在两个新增区域运行同一套获客与交付机制，验证单位经济性。"),
  makePhaseCard("03 · 第 61–90 天", "规模化", "把有效打法固化为节奏、看板和负责人机制，进入季度经营循环。"),
);

roadmapSlide.add(roadmapTitle, phaseRow);

// slide 4 — closing：回到留白，收束为需要批准的事项。
// 结尾不再是一行卡片，避免整份 deck 以同一种构图结束。
const closingSlide = createSlide({ background: { color: navy } });

const closingEyebrow = createText("需要本次会议确认");
closingEyebrow.fontSize = 9;
closingEyebrow.color = "#8FA8C8";
closingEyebrow.letterSpacing = 1.5;
closingEyebrow.height = 0.24;

const closingTitle = createText("批准两个新增区域的\n90 天复制计划");
closingTitle.fontSize = 26;
closingTitle.fontWeight = "bold";
closingTitle.color = "#FFFFFF";
closingTitle.lineHeight = 1.2;
closingTitle.height = 1.4;
closingTitle.marginTop = 0.2;

const closingNote = createText("需要的支持：两名区域负责人到岗，Q1 市场预算 +$1.2M。");
closingNote.fontSize = 11;
closingNote.color = "#C3D2E4";
closingNote.lineHeight = 1.45;
closingNote.marginTop = 0.3;

const closingSpacer = createSpacer();
closingSpacer.flex = 1;

const closingFooter = createText("Strategy & Operations · 2026-01-15");
closingFooter.fontSize = 8;
closingFooter.color = "#7E93AC";
closingFooter.height = 0.22;

const closingBody = createFrame({
  flexDirection: "column",
  padding: { left: 0.7, right: 2.4, top: 1.2, bottom: 0.6 },
});
closingBody.flex = 1;
closingBody.add(closingEyebrow, closingTitle, closingNote, closingSpacer, closingFooter);
closingSlide.add(closingBody);

compose({
  title: "年度经营复盘",
  slides: [coverSlide, metricsSlide, roadmapSlide, closingSlide],
  // 视觉系统写进 theme，后续增删页面时 DECK_DESIGN 会带着这些值回到 sandbox，
  // 跨页一致性才有据可依。新建文稿时不要省略这一段。
  theme: {
    colors: {
      accent1: navy,
      accent2: green,
      background: "#FFFFFF",
      text: "#101820",
      muted: muted,
    },
    // 字体必须先用 `linnya-slides fonts check` 验证；这里仅展示 major/minor 必须成对声明。
    fonts: { major: "Aptos Display", minor: "Aptos" },
  },
});
