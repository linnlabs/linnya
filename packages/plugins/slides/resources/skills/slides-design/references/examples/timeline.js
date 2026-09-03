// Runnable single-slide deck.js example.
// Use as standalone source; do not concatenate with another example.
//
// 语法重点：absolute 定位的坐标算术与添加顺序决定的层级——
// 脊线先添加、节点后添加，所以圆点压在线上。这类几何从 .d.ts 推不出来。
// 配色和版式是这份示例的一次性选择，不是默认风格。

// slide 1 — timeline · 6 节点纵向左右交错
const accent = "#12233F";

const slide = createSlide();
slide.background = { color: "#FFFFFF" };

const title = createText("公司六大里程碑：从车库初创到 ARR $240M");
title.fontSize = 16;
title.fontWeight = "bold";
title.color = accent;
title.position = "absolute";
title.x = 0.5;
title.y = 0.3;
title.w = 9;
title.h = 0.5;

const events = [
  { year: "2019",     side: "left",  heading: "公司成立",     caption: "种子轮 $2M，3 人团队" },
  { year: "2020 H2",  side: "right", heading: "首个付费客户", caption: "ARR 首破 $100k" },
  { year: "2021",     side: "left",  heading: "A 轮 $25M",   caption: "团队扩张到 35 人" },
  { year: "2022 Q4",  side: "right", heading: "ARR $20M",    caption: "正向现金流首年" },
  { year: "2024",     side: "left",  heading: "B 轮 $80M",   caption: "进入欧洲 + 亚太市场" },
  { year: "2025 Q4",  side: "right", heading: "ARR $240M",   caption: "Rule of 40 达标，准备 IPO" },
];

const SPINE_X = 5.0;
const TOP_Y = 1.05;
const STEP_Y = 0.7;
const NODE_R = 0.17;

const baseLine = createShape();
baseLine.position = "absolute";
baseLine.x = SPINE_X - 0.015;
baseLine.y = TOP_Y - 0.05;
baseLine.w = 0.03;
baseLine.h = STEP_Y * (events.length - 1) + 0.1;
baseLine.fill = "#E4E7EC";

function makeEvent(ev, index) {
  const y = TOP_Y + index * STEP_Y;

  const dot = createShape();
  dot.position = "absolute";
  dot.x = SPINE_X - NODE_R / 2;
  dot.y = y - NODE_R / 2;
  dot.w = NODE_R;
  dot.h = NODE_R;
  dot.geometry = "ellipse";
  dot.fill = accent;

  const isLeft = ev.side === "left";
  const blockWidth = 4.0;
  const blockX = isLeft ? SPINE_X - 0.4 - blockWidth : SPINE_X + 0.4;
  const align = isLeft ? "right" : "left";

  const yearText = createText(ev.year);
  yearText.position = "absolute";
  yearText.x = blockX;
  yearText.y = y - 0.13;
  yearText.w = blockWidth;
  yearText.h = 0.22;
  yearText.fontSize = 9;
  yearText.fontWeight = "bold";
  yearText.color = accent;
  yearText.textAlign = align;

  const headingText = createText(ev.heading);
  headingText.position = "absolute";
  headingText.x = blockX;
  headingText.y = y + 0.1;
  headingText.w = blockWidth;
  headingText.h = 0.26;
  headingText.fontSize = 13;
  headingText.fontWeight = "bold";
  headingText.color = "#0F172A";
  headingText.textAlign = align;

  const capText = createText(ev.caption);
  capText.position = "absolute";
  capText.x = blockX;
  capText.y = y + 0.34;
  capText.w = blockWidth;
  capText.h = 0.22;
  capText.fontSize = 9;
  capText.color = "#64748B";
  capText.textAlign = align;

  return [dot, yearText, headingText, capText];
}

slide.add(
  title,
  baseLine,
  ...events.flatMap(makeEvent),
);

compose({
  title: "Timeline · Runnable Template",
  slides: [slide],
  theme: {
    colors: { accent1: accent, background: "#FFFFFF", text: "#101820", muted: "#6B7480" },
  },
});
