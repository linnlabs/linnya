// 原子能力示例，不是模板。每页仅放一张图，数据均为演示数据。
// 独立运行此文件；实际稿件的构图、字号和配色由作者决定。
const combo = createSlide();
combo.add(createChart({
  position: "absolute", x: 0.8, y: 0.7, width: 8.4, height: 4.2,
  chartType: "combo", categories: ["2023", "2024", "2025", "2026E"],
  series: [
    { name: "营收", chartType: "bar", values: [80, 100, 128, 156], color: "#CBD5E1", pointColors: [null, null, "#2563EB", null] },
    { name: "利润率", chartType: "line", axis: "secondary", values: [0.12, 0.16, 0.19, 0.22], color: "#C2410C", lineWidth: 2.5, marker: "circle", dataLabelFormat: "0%" },
    { name: "利润率目标", chartType: "line", axis: "secondary", values: [0.2, 0.2, 0.2, 0.2], color: "#64748B", lineDash: "dash", marker: "none", showDataLabels: false },
  ],
  categoryAxis: { title: "年度" },
  valueAxis: { title: "营收（亿元）", min: 0, max: 180, majorUnit: 30, numberFormat: "#,##0" },
  secondaryValueAxis: { title: "利润率", min: 0, max: 0.3, majorUnit: 0.1, numberFormat: "0%", showGridlines: false },
  showDataLabels: true, dataLabelPosition: "outside", legendPosition: "bottom",
  chartStyle: { axisLabelFontSize: 11, dataLabelFontSize: 10, legendFontSize: 11, axisLabelColor: "#334155", gridlineColor: "#E2E8F0" },
}));

const stacked = createSlide();
stacked.add(createChart({
  position: "absolute", x: 0.8, y: 0.7, width: 8.4, height: 4.2,
  chartType: "bar", stacking: "percent", categories: ["2024", "2025", "2026"],
  series: [
    { name: "订阅", values: [30, 45, 70], color: "#2563EB" },
    { name: "服务", values: [70, 55, 30], color: "#94A3B8" },
  ],
  showDataLabels: true, dataLabelPosition: "center", legendPosition: "bottom",
  chartStyle: { axisLabelFontSize: 11, dataLabelFontSize: 10, legendFontSize: 11 },
}));

const share = createSlide();
share.add(createChart({
  position: "absolute", x: 0.8, y: 0.7, width: 8.4, height: 4.2,
  chartType: "doughnut", categories: ["主业务", "其他"],
  series: [{ name: "构成", values: [72, 28], pointColors: ["#2563EB", "#CBD5E1"] }],
  showDataLabels: true, dataLabelContent: "percentage", dataLabelFormat: "0.0%", dataLabelPosition: "inside",
  legendPosition: "bottom", chartStyle: { dataLabelFontSize: 13, legendFontSize: 11 },
}));

compose({ title: "图表控制能力示例", slides: [combo, stacked, share], theme: { chart: { palette: ["#2563EB", "#94A3B8", "#C2410C"] } } });
