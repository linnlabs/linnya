// Runnable 5-slide deck.js example. Use as standalone source; do not concatenate with another example.
//
// 对应风格指南：style-consulting-report.md。
// 语法与机械做法重点：文本框内边距补偿、手排表格（按内容分列宽）、polygon 箭头段、
// 按行数估高并垂直居中的提示条，以及五种不同的页型。
// 配色、字号和版面是这份示例的一次性选择，不是默认风格；换题材时这些都要换。

const PW = 13.333;
const PH = 7.5;
const L = 0.6;
const CW = 12.13;

const C = {
  navy: "#1B2A41",
  blue: "#2F6DB5",
  tint: "#E4ECF6",
  pale: "#F4F6F9",
  line: "#CBD3DC",
  grey: "#5E6872",
  ink: "#1E2730",
  warn: "#B7791F",
  warnBg: "#FBF4E6",
  white: "#FFFFFF",
};
const FONT = "Microsoft YaHei";

// Text 自带约 0.1in 的左右内边距和 0.05in 的上内边距；整体外扩，让文字边缘落在给定坐标上。
function text(content, o) {
  const n = createText(content);
  n.position = "absolute";
  n.x = o.x - 0.1;
  n.y = o.y - 0.05;
  if (o.w) n.w = o.w + 0.2;
  if (o.h) n.h = o.h + 0.1;
  n.fontSize = o.size || 12;
  n.color = o.color || C.ink;
  n.fontFamily = FONT;
  if (o.bold) n.fontWeight = "bold";
  n.lineHeight = o.lh || 1.4;
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

// 预设 chevron 在窄长条上缺口很深；用 polygon 固定缺口深度。
function arrowBand(x, y, w, h, fill) {
  const d = Math.min(0.24, w / 4) / w;
  const s = createShape({
    geometry: {
      type: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 1 - d, y: 0 },
        { x: 1, y: 0.5 },
        { x: 1 - d, y: 1 },
        { x: 0, y: 1 },
        { x: d, y: 0.5 },
      ],
    },
    fill: fill,
  });
  s.position = "absolute";
  s.x = x;
  s.y = y;
  s.w = w;
  s.h = h;
  return s;
}

const WIDE = /[⺀-鿿＀-￯　-〿]/;
function textWidth(str, size) {
  let w = 0;
  for (const ch of str) w += WIDE.test(ch) ? 1 : /[0-9.,%]/.test(ch) ? 0.56 : 0.62;
  return (w * size) / 72;
}

function chrome(slide, section, title, source, page) {
  slide.add(
    text(section, { x: L, y: 0.36, w: 7, size: 10.5, color: C.blue, bold: true }),
    text(title, { x: L, y: 0.68, w: CW, h: 0.9, size: 24, color: C.navy, bold: true, lh: 1.2 }),
    rect(L, 1.62, CW, 0.012, C.line),
    rect(L, 1.6, 1.3, 0.04, C.blue),
    rect(L, 6.96, CW, 0.01, C.line),
    text(source, { x: L, y: 7.0, w: 10.6, size: 8.5, color: C.grey, lh: 1.25, role: "source" }),
    text(page + " / 5", { x: PW - L - 1.4, y: 7.0, w: 1.4, size: 8.5, color: C.grey, align: "right", role: "page-number" }),
  );
}

/**
 * 提示条：按行数估高，再让文字块在条内垂直居中。
 * kind "bar" 是带底色的条，"tag" 是行内标签。别在每页都用，也别总放在同一个位置。
 */
function callout(slide, kind, label, body, x, y, w) {
  const size = 11.5;
  const lineH = (size * 1.35) / 72;
  const labelW = 0.62;
  const avail = w - labelW - 0.55;
  const lines = Math.max(1, Math.ceil((textWidth(body, size) * 1.05) / avail));
  const textH = lines * lineH;
  if (kind === "tag") {
    const rowH = Math.max(textH, 0.3);
    slide.add(
      rect(x, y + (rowH - 0.28) / 2, 0.52, 0.28, C.warn),
      text(label, { x: x, y: y + (rowH - 0.28) / 2 + 0.035, w: 0.52, size: 11, color: C.white, bold: true, align: "center" }),
      text(body, { x: x + 0.7, y: y + (rowH - textH) / 2, w: w - 0.7, size: size, color: C.navy }),
    );
    return rowH;
  }
  const h = Math.max(0.56, textH + 0.32);
  const ty = y + (h - textH) / 2;
  slide.add(
    rect(x, y, w, h, C.warnBg),
    text(label, { x: x + 0.2, y: ty, w: labelW, size: size, color: C.warn, bold: true }),
    text(body, { x: x + 0.2 + labelW, y: ty, w: avail + 0.15, size: size, color: C.navy }),
  );
  return h;
}

/**
 * 手排表格：原生 Table 没有单元格内边距和列宽。按内容给列分配宽度，左右内边距 0.16in，
 * 同一行单元格顶对齐，数字列右对齐；返回表格总高度，后续元素据此定位。
 */
function gridTable(slide, x, y, w, headers, rows, aligns) {
  const size = 12;
  const padX = 0.16;
  const padY = 0.12;
  const lineH = (size * 1.4) / 72;
  const need = headers.map(function (head, j) {
    let m = textWidth(head, size) * 1.08;
    for (const r of rows) {
      for (const par of r[j].split("\n")) m = Math.max(m, textWidth(par, size));
    }
    return m + 2 * padX;
  });
  const total = need.reduce(function (a, v) { return a + v; }, 0);
  const widths = need.map(function (v) { return (v * w) / total; });
  const colX = [];
  let acc = x;
  for (const cw of widths) { colX.push(acc); acc += cw; }
  const headH = lineH + 0.2;
  slide.add(rect(x, y, w, headH, C.navy));
  headers.forEach(function (head, j) {
    slide.add(text(head, { x: colX[j] + padX, y: y + 0.1, w: widths[j] - 2 * padX, size: size, color: C.white, bold: true, align: aligns[j] }));
  });
  let ry = y + headH;
  rows.forEach(function (r, i) {
    let lines = 1;
    r.forEach(function (cell, j) {
      let n = 0;
      for (const par of cell.split("\n")) n += Math.max(1, Math.ceil((textWidth(par, size) * 1.05) / (widths[j] - 2 * padX - 0.06)));
      lines = Math.max(lines, n);
    });
    const rh = lines * lineH + 2 * padY;
    if (i % 2 === 1) slide.add(rect(x, ry, w, rh, C.pale));
    r.forEach(function (cell, j) {
      slide.add(text(cell, { x: colX[j] + padX, y: ry + padY, w: widths[j] - 2 * padX, size: size, color: j === 0 ? C.navy : C.ink, bold: j === 0, align: aligns[j] }));
    });
    slide.add(rect(x, ry + rh - 0.008, w, 0.008, C.line));
    ry += rh;
  });
  return ry - y;
}

// slide 1 — 执行摘要：三列结论 + 建议条
const s1 = createSlide({ background: { color: C.white } });
chrome(s1, "执行摘要", "结论：先买可验证的任务经济性，不为未经证明的通用性付溢价", "来源：示例数据，仅演示版式；真实稿件在此写明来源、期间与口径。", 1);
const findings = [
  ["01", "需求已被验证", "年度新增安装量说明自动化需求真实存在，但这是存量设备，不能直接当作新品类的可服务市场。"],
  ["02", "证据在客户侧", "两个客户案例都限定在单一工序，缺少单台分母、人工介入和总成本，不能外推到整条产线。"],
  ["03", "回本取决于运行小时", "基准情景低于人工成本，保守情景回收期超过设备寿命；结论对运行小时与支持投入最敏感。"],
];
findings.forEach(function (f, i) {
  const x = L + i * 4.1;
  s1.add(
    rect(x, 1.95, 3.95, 0.012, C.navy),
    text(f[0], { x: x + 0.25, y: 2.15, w: 1.2, size: 30, color: C.blue, bold: true }),
    text(f[1], { x: x + 0.25, y: 2.95, w: 3.5, size: 16, color: C.navy, bold: true }),
    text(f[2], { x: x + 0.25, y: 3.75, w: 3.5, size: 12, lh: 1.55 }),
  );
});
s1.add(
  rect(L, 5.75, CW, 0.62, C.navy),
  text("建议", { x: L + 0.25, y: 5.97, w: 0.8, size: 12, color: "#A9BED8", bold: true }),
  text("优先尽调可靠性关键件与可复用交付；整机条件式关注；模型与数据保留长期选择权。", { x: L + 1.1, y: 5.95, w: CW - 1.3, size: 13, color: C.white, bold: true }),
);

// slide 2 — 图表加漏斗：左边比较，右边收窄，底部一条提示
const s2 = createSlide({ background: { color: C.white } });
chrome(s2, "需求基准与市场口径", "自动化需求已被验证，但不能把存量设备当作新品类的市场", "来源：示例数据，仅演示版式。", 2);
s2.add(text("图表 1　年度新增安装量（万台）", { x: L, y: 1.9, w: 6, size: 12, color: C.navy, bold: true }));
const chart = createChart("horizontal-bar");
chart.position = "absolute";
chart.x = L;
chart.y = 2.3;
chart.w = 5.9;
chart.h = 3.2;
chart.categories = ["甲地", "乙地", "丙地", "丁地", "戊地"];
chart.series = [{ name: "万台", values: [29.5, 4.5, 3.4, 3.1, 2.7] }];
chart.showDataLabels = true;
chart.legendPosition = "none";
s2.add(chart);
s2.add(text("图表 2　机会池从客户愿意付费的任务出发", { x: 7.0, y: 1.9, w: 5.7, size: 12, color: C.navy, bold: true }));
const funnel = [
  { t: "任务工位 × 可服务比例 × 年度付费", w: 5.6, bg: C.tint, fg: C.navy },
  { t: "可技术覆盖", w: 4.6, bg: "#9DB9DB", fg: C.navy },
  { t: "可经济覆盖", w: 3.6, bg: C.blue, fg: C.white },
  { t: "可商业取得", w: 2.6, bg: C.navy, fg: C.white },
];
funnel.forEach(function (f, i) {
  s2.add(
    rect(7.0 + (5.6 - f.w) / 2, 2.4 + i * 0.8, f.w, 0.68, f.bg),
    text(f.t, { x: 7.0 + (5.6 - f.w) / 2 + 0.1, y: 2.4 + i * 0.8 + 0.2, w: f.w - 0.2, size: 12, color: f.fg, bold: i === 0, align: "center" }),
  );
});
callout(s2, "bar", "反证", "若任务工位分母、可接受价格与采用率无法核实，不给出伪精确的可服务市场规模。", L, 6.1, CW);

// slide 3 — 手排表格加侧栏框：表格列距由代码控制
const s3 = createSlide({ background: { color: C.white } });
chrome(s3, "落地瓶颈与验证指标", "商业化瓶颈是整班可靠性，不是单次动作成功", "来源：示例数据，仅演示版式。", 3);
const tableH = gridTable(s3, L, 1.95, 8.6, ["瓶颈", "经济后果", "应索取的指标"], [
  ["关节与线缆", "停机、备件、返工\n侵蚀单任务利润", "满载寿命分布\n故障间隔、维修时长"],
  ["长任务与恢复", "失败累积\n需要人工兜底", "整段任务完成率\n接管次数与支持工时"],
  ["节拍与良率", "无法匹配产线\n停线损失超过设备价", "同工位周期分布\n合格产出与误放率"],
], ["left", "left", "left"]);
// 侧栏框：位置与形式和别页的提示不同，文字在框内垂直居中。
callout(s3, "bar", "反证", "若耐久与接管日志无法复核，应拒绝用演示视频替代验收。", 9.55, 1.95, 3.18);
s3.add(text("投资抓手：能降低故障与现场工程量的部件、校准、诊断和运维，比“更多自由度”更可检验。", { x: L, y: 1.95 + tableH + 0.35, w: 8.6, size: 12.5, color: C.blue, bold: true }));

// slide 4 — 流程箭头段加三个大数字
const s4 = createSlide({ background: { color: C.white } });
chrome(s4, "决策顺序与回本测算", "回本取决于可替代的有效产出，而不只是设备降价", "来源：示例数据，仅演示版式。", 4);
const steps = ["定任务与产出", "排除更简单方案", "比较全系统成本", "再选形态"];
steps.forEach(function (t, i) {
  const x = L + i * 3.05;
  s4.add(arrowBand(x, 1.95, 3.0, 0.7, i === 3 ? C.blue : C.navy), text(t, { x: x + 0.45, y: 2.16, w: 2.2, size: 12.5, color: C.white, bold: true, align: "center" }));
});
const kpis = [
  ["36.7", "元 / 等效小时", "基准情景的机器人成本"],
  ["60", "元 / 小时", "同产出人工成本假设"],
  ["8.0", "年", "保守情景回收期，超过 5 年寿命"],
];
kpis.forEach(function (k, i) {
  const x = L + i * 4.1;
  s4.add(
    rect(x, 3.3, 3.95, 2.4, i === 2 ? C.warnBg : C.pale),
    text(k[0], { x: x + 0.3, y: 3.55, w: 3.3, size: 44, color: i === 2 ? C.warn : C.navy, bold: true }),
    text(k[1], { x: x + 0.3, y: 4.6, w: 3.3, size: 13, color: C.grey }),
    text(k[2], { x: x + 0.3, y: 5.05, w: 3.3, size: 12.5, color: C.ink }),
  );
});

// slide 5 — 照片证据页：图片占主体，署名写进页脚
const s5 = createSlide({ background: { color: C.white } });
chrome(s5, "真实应用证据", "客户已验证指定工序，尚未公开完整的替人经济账", "图片：此处写明拍摄对象、版权方与许可，例如“某某，CC BY 4.0”。无关对象的图写“示意”。", 5);
// 真实稿件在这里用 createImage 放现场照片；示例用色块占位，避免依赖外部文件。
const photoA = rect(L, 1.95, 5.6, 3.15, "#C9D3DE");
const photoB = rect(L + 5.8, 1.95, 3.2, 3.15, "#D8DFE7");
s5.add(
  photoA,
  photoB,
  rect(L, 4.78, 5.6, 0.32, C.navy),
  text("现场 A · 拍摄对象与版权方", { x: L + 0.1, y: 4.85, w: 5.4, size: 10, color: C.white }),
  rect(L + 5.8, 4.78, 3.2, 0.32, C.navy),
  text("现场 B · 示意", { x: L + 5.9, y: 4.85, w: 3.0, size: 10, color: C.white }),
  text("两个案例，都是限定工序", { x: 9.9, y: 1.95, w: 2.83, size: 15, color: C.navy, bold: true }),
  text("案例一：试点十个月，辅助生产超过 9 万个零件。\n案例二：多年按任务收费协议，搬箱超过 10 万次。", { x: 9.9, y: 2.5, w: 2.83, size: 12, lh: 1.6 }),
  text("边界：均不等于通用或整线无人化。", { x: L, y: 5.4, w: 9, size: 12.5, color: C.blue, bold: true }),
);
callout(s5, "tag", "反证", "累计产出缺少台数与有效工时分母，不能外推单台吞吐、可用率与节省人数。", L, 5.95, CW);

compose({
  title: "Consulting Report · Runnable Example",
  layout: { width: PW, height: PH, unit: "in" },
  slides: [s1, s2, s3, s4, s5],
  theme: {
    colors: { accent1: C.navy, accent2: C.blue, background: C.white, text: C.ink, muted: C.grey },
    fonts: { major: FONT, minor: FONT },
    chart: { palette: [C.navy, C.blue, "#9DB9DB", C.line] },
  },
});
