// 卡片行版式对照 —— 同一种"一行卡片"骨架的四种变形，全在一份 source 里。
// 收录它是为了说明：卡片行是一种版式，不是默认版式。
// 一份 deck 里连续多页都是卡片行，会读起来像同一页换了文字。
// 这一页的视觉系统同样是一次性决策，不要当成 Linnya 的 house style。

const ink = "#101820";
const slate = "#5A6672";
const teal = "#0F6B5C";
const amber = "#B87333";

// 共享的卡片壳：所有变形都从它出发，只改内部结构与强调方式。
function makeCardShell(weight) {
  const card = createFrame({ flexDirection: "column", padding: 0.22 });
  card.flex = weight;
  return card;
}

// 变形 A — 等权卡片：六个要点平摊，没有主次。
// 适合"并列的六件事"，不适合"其中一件最重要"。
const evenSlide = createSlide({ background: { color: "#FFFFFF" } });

const evenTitle = createText("变形 A · 等权卡片：并列要点，无主次");
evenTitle.fontSize = 15;
evenTitle.fontWeight = "bold";
evenTitle.color = ink;
evenTitle.height = 0.42;

function makeEvenCard(index, headline, detail) {
  const card = makeCardShell(1);
  card.backgroundColor = "#F4F6F7";

  const indexText = createText(index);
  indexText.fontSize = 14;
  indexText.fontWeight = "bold";
  indexText.color = teal;
  indexText.height = 0.3;

  const headlineText = createText(headline);
  headlineText.fontSize = 12;
  headlineText.fontWeight = "bold";
  headlineText.color = ink;
  headlineText.lineHeight = 1.2;
  headlineText.height = 0.34;

  const detailText = createText(detail);
  detailText.fontSize = 8.5;
  detailText.color = slate;
  detailText.lineHeight = 1.4;
  detailText.flex = 1;
  detailText.marginTop = 0.08;

  card.add(indexText, headlineText, detailText);
  return card;
}

function makeCardRow(cards) {
  const row = createFrame({ flexDirection: "row", gap: 0.18 });
  row.flex = 1;
  row.add(cards);
  return row;
}

const evenGrid = createFrame({ flexDirection: "column", gap: 0.18 });
evenGrid.flex = 1;
evenGrid.marginTop = 0.22;
evenGrid.add(
  makeCardRow([
    makeEvenCard("01", "北美 +38%", "ARR $115M，新签额创历史新高"),
    makeEvenCard("02", "欧洲 +22%", "合规推进，德法为主力"),
    makeEvenCard("03", "亚太 +58%", "日本与东南亚增速最快"),
  ]),
  makeCardRow([
    makeEvenCard("04", "NRR 132%", "连续三季度高于 130%"),
    makeEvenCard("05", "Churn 2.1%", "同比下降 0.4pp"),
    makeEvenCard("06", "Rule of 40 · 41%", "增长与利润率双达标"),
  ]),
);

const evenBody = createFrame({
  flexDirection: "column",
  padding: { left: 0.5, right: 0.5, top: 0.38, bottom: 0.42 },
});
evenBody.flex = 1;
evenBody.add(evenTitle, evenGrid);
evenSlide.add(evenBody);

// 变形 B — 加权卡片：用 flex 权重让主指标占更大面积。
// 这是让卡片行产生视觉锚点最省事的办法：改权重，不是改颜色。
const weightedSlide = createSlide({ background: { color: "#FFFFFF" } });

const weightedEyebrow = createText("经营概览 · FY2025 Q4");
weightedEyebrow.fontSize = 8.5;
weightedEyebrow.color = slate;
weightedEyebrow.letterSpacing = 1.5;
weightedEyebrow.height = 0.22;

const weightedTitle = createText("变形 B · 加权卡片：主指标占更大面积");
weightedTitle.fontSize = 15;
weightedTitle.fontWeight = "bold";
weightedTitle.color = ink;
weightedTitle.height = 0.44;

function makeWeightedCard(value, label, delta, weight, isPrimary) {
  const card = makeCardShell(weight);
  card.backgroundColor = isPrimary ? "#0F6B5C" : "#F4F6F7";
  card.borderRadius = 0.08;

  const valueText = createText(value);
  valueText.fontSize = isPrimary ? 34 : 22;
  valueText.fontWeight = "bold";
  valueText.color = isPrimary ? "#FFFFFF" : ink;
  valueText.lineHeight = 1.1;
  valueText.height = isPrimary ? 0.72 : 0.5;

  const labelText = createText(label);
  labelText.fontSize = 9.5;
  labelText.color = isPrimary ? "#BFE0D8" : slate;
  labelText.height = 0.24;

  const deltaText = createText(delta);
  deltaText.fontSize = 9;
  deltaText.fontWeight = "bold";
  deltaText.color = isPrimary ? "#FFFFFF" : teal;
  deltaText.height = 0.24;
  deltaText.marginTop = 0.06;

  card.add(valueText, labelText, deltaText);
  return card;
}

const weightedRow = createFrame({ flexDirection: "row", gap: 0.18 });
weightedRow.flex = 1;
weightedRow.marginTop = 0.22;
weightedRow.add(
  makeWeightedCard("$240M", "ARR", "↑ +38% YoY", 2, true),
  makeWeightedCard("132%", "净收入留存", "↑ +5pp", 1, false),
  makeWeightedCard("2.1%", "月度流失", "↓ -0.4pp", 1, false),
);

const weightedBody = createFrame({
  flexDirection: "column",
  padding: { left: 0.5, right: 0.5, top: 0.34, bottom: 0.42 },
});
weightedBody.flex = 1;
weightedBody.add(weightedEyebrow, weightedTitle, weightedRow);
weightedSlide.add(weightedBody);

// 变形 C — 阶段递进：卡片有方向性，颜色深浅表达时间推进。
const stageSlide = createSlide({ background: { color: "#FFFFFF" } });

const stageTitle = createText("变形 C · 阶段递进：颜色深浅表达先后");
stageTitle.fontSize = 15;
stageTitle.fontWeight = "bold";
stageTitle.color = ink;
stageTitle.height = 0.44;

function makeStageCard(tag, timeframe, goal, detail, barColor) {
  const card = makeCardShell(1);
  card.backgroundColor = "#F7F8F9";

  // absolute 顶栏：先添加则位于内容之后方，颜色深浅承担"第几阶段"的信号。
  const topBar = createShape({ fill: barColor });
  topBar.position = "absolute";
  topBar.left = 0;
  topBar.top = 0;
  topBar.width = "100%";
  topBar.height = 0.07;

  const tagText = createText(tag);
  tagText.fontSize = 9;
  tagText.fontWeight = "bold";
  tagText.color = barColor;
  tagText.height = 0.22;

  const timeframeText = createText(timeframe);
  timeframeText.fontSize = 8;
  timeframeText.color = slate;
  timeframeText.height = 0.2;

  const goalText = createText(goal);
  goalText.fontSize = 12.5;
  goalText.fontWeight = "bold";
  goalText.color = ink;
  goalText.lineHeight = 1.2;
  goalText.height = 0.42;
  goalText.marginTop = 0.1;

  const detailText = createText(detail);
  detailText.fontSize = 8;
  detailText.color = slate;
  detailText.lineHeight = 1.42;
  detailText.flex = 1;
  detailText.marginTop = 0.1;

  card.add(topBar, tagText, timeframeText, goalText, detailText);
  return card;
}

const stageRow = createFrame({ flexDirection: "row", gap: 0.18 });
stageRow.flex = 1;
stageRow.marginTop = 0.22;
stageRow.add(
  makeStageCard("Phase 1 · 验证", "第 1–30 天", "锁定可复制打法",
    "完成重点行业复盘，明确客户画像与关键销售动作。", "#9FB6C4"),
  makeStageCard("Phase 2 · 复制", "第 31–60 天", "两区域跑通",
    "在两个新增区域运行同一套获客与交付机制，验证单位经济性。", "#4A7C94"),
  makeStageCard("Phase 3 · 规模化", "第 61–90 天", "进入经营循环",
    "把有效打法固化为节奏、看板与负责人机制。", "#12455C"),
);

const stageBody = createFrame({
  flexDirection: "column",
  padding: { left: 0.5, right: 0.5, top: 0.38, bottom: 0.42 },
});
stageBody.flex = 1;
stageBody.add(stageTitle, stageRow);
stageSlide.add(stageBody);

// 变形 D — 打破卡片行：同样的三条信息，改成左侧结论 + 右侧证据列。
// 放在这里是为了对照：内容没变，读起来完全不是同一页。
const brokenSlide = createSlide({ background: { color: "#0E1116" } });

const brokenTitle = createText("变形 D · 不用卡片行：结论居左，证据成列");
brokenTitle.fontSize = 15;
brokenTitle.fontWeight = "bold";
brokenTitle.color = "#FFFFFF";
brokenTitle.height = 0.44;

const brokenLead = createText("增长质量已经改善，\n下一步是复制而不是加投。");
brokenLead.fontSize = 22;
brokenLead.fontWeight = "bold";
brokenLead.color = "#FFFFFF";
brokenLead.lineHeight = 1.24;
brokenLead.height = 1.3;
brokenLead.marginTop = 0.3;

const brokenNote = createText("三项指标同时达标，说明改善来自机制而非单点。");
brokenNote.fontSize = 10;
brokenNote.color = "#8B95A5";
brokenNote.lineHeight = 1.45;
brokenNote.marginTop = 0.22;
brokenNote.flex = 1;

const brokenLeft = createFrame({ flexDirection: "column" });
brokenLeft.flex = 5;
brokenLeft.add(brokenTitle, brokenLead, brokenNote);

function makeEvidenceRow(value, label, isLast) {
  const row = createFrame({ flexDirection: "column" });
  row.flex = 1;

  const valueText = createText(value);
  valueText.fontSize = 20;
  valueText.fontWeight = "bold";
  valueText.color = "#FFFFFF";
  valueText.height = 0.46;

  const labelText = createText(label);
  labelText.fontSize = 9;
  labelText.color = "#8B95A5";
  labelText.height = 0.24;

  row.add(valueText, labelText);

  if (!isLast) {
    const rule = createShape({ fill: "#2A323C", width: "100%", height: 0.008 });
    rule.marginTop = 0.2;
    row.add(rule);
  }
  return row;
}

const brokenRight = createFrame({ flexDirection: "column", gap: 0.2, justifyContent: "center" });
brokenRight.flex = 3;
brokenRight.add(
  makeEvidenceRow("$240M", "ARR · 同比 +38%", false),
  makeEvidenceRow("132%", "净收入留存 · +5pp", false),
  makeEvidenceRow("41%", "Rule of 40 · 连续两季达标", true),
);

const brokenBody = createFrame({
  flexDirection: "row",
  gap: 0.6,
  padding: { left: 0.6, right: 0.6, top: 0.42, bottom: 0.45 },
});
brokenBody.flex = 1;
brokenBody.add(brokenLeft, brokenRight);
brokenSlide.add(brokenBody);

compose({
  title: "卡片行版式对照",
  slides: [evenSlide, weightedSlide, stageSlide, brokenSlide],
  theme: {
    colors: { accent1: teal, accent2: amber, background: "#FFFFFF", text: ink, muted: slate },
  },
});
