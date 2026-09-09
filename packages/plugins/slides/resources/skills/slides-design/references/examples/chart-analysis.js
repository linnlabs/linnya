// Runnable single-slide deck.js example.
// Use as standalone source; do not concatenate with another example.
//
// 语法重点：createChart(preset) 的 categories / series 结构，以及主副图的 flex 配比。
// 配色和版式是这份示例的一次性选择，不是默认风格。

// slide 1 — chart analysis · 主副 6:4 布局
const accent = "#12233F";

const slide = createSlide();
slide.background = { color: "#FFFFFF" };

const header = createFrame();
header.flexDirection = "column";
header.padding = { left: 0.5, right: 0.5, top: 0.3 };

const title = createText("企业级客户是 Q4 增长的核心驱动（贡献 68% 新 ARR）");
title.fontSize = 16;
title.fontWeight = "bold";
title.color = accent;
title.height = 0.48;
header.add(title);

const chartRow = createFrame();
chartRow.flexDirection = "row";
chartRow.gap = 0.3;
chartRow.padding = { left: 0.5, right: 0.5, top: 0.2 };
chartRow.flex = 1;

const primary = createFrame();
primary.flexDirection = "column";
primary.flex = 6;

const pLabel = createText("新 ARR 按客户分层（百万美元）");
pLabel.fontSize = 10;
pLabel.fontWeight = "bold";
pLabel.color = "#0F172A";
pLabel.height = 0.24;

const pChart = createChart("stacked-column");
pChart.flex = 1;
pChart.categories = ["Q1", "Q2", "Q3", "Q4"];
pChart.series = [
  { name: "Enterprise", values: [8, 11, 14, 21] },
  { name: "Mid-market", values: [6, 7, 8, 6] },
  { name: "SMB", values: [4, 4, 3, 4] },
];
pChart.legendPosition = "bottom";
pChart.chartStyle = {
  axisLabelColor: "#475569",
  gridlineColor: "#D7DEE5",
};
primary.add(pLabel, pChart);

const secondary = createFrame();
secondary.flexDirection = "column";
secondary.flex = 4;

const sLabel = createText("Q4 新 ARR 构成");
sLabel.fontSize = 10;
sLabel.fontWeight = "bold";
sLabel.color = "#0F172A";
sLabel.height = 0.24;

const sChart = createChart("doughnut");
sChart.flex = 1;
sChart.categories = ["Enterprise", "Mid-market", "SMB"];
sChart.series = [{ name: "Share", values: [68, 19, 13] }];
sChart.showDataLabels = true;
sChart.chartStyle = { dataLabelColor: "#12233F" };
secondary.add(sLabel, sChart);

chartRow.add(primary, secondary);
slide.add(header, chartRow);

compose({
  title: "Dual Chart · Runnable Template",
  slides: [slide],
  theme: {
    colors: { accent1: accent, background: "#FFFFFF", text: "#101820", muted: "#6B7480" },
    // theme.chart.palette 决定图表系列取色顺序；不写则由运行时默认调色板决定。
    chart: { palette: ["#12233F", "#4A7C94", "#9FB6C4"] },
  },
});
