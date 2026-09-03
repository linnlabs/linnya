// Runnable single-slide deck.js example.
// Use as standalone source; do not concatenate with another example.
//
// 语法重点：createTable 的 headers / rows 结构。逐格底色与文字样式见 media-and-paint.js。
// 配色和版式是这份示例的一次性选择，不是默认风格。

// slide 1 — table · 对比评估矩阵
const accent = "#12233F";

const slide = createSlide();
slide.background = { color: "#FFFFFF" };

const title = createText("技术方案评估：自研 vs SaaS vs 混合");
title.fontSize = 16;
title.fontWeight = "bold";
title.color = accent;
title.position = "absolute";
title.x = 0.5;
title.y = 0.3;
title.w = 9;
title.h = 0.5;

const container = createFrame();
container.flexDirection = "column";
container.padding = { left: 0.5, right: 0.5, top: 1.0 };
container.flex = 1;

const table = createTable();
table.flex = 1;
table.headers = ["评估维度", "自研", "SaaS", "混合方案"];
table.rows = [
  ["定制能力", "●●●", "●", "●●●"],
  ["上线速度", "●", "●●●", "●●"],
  ["TCO（3 年）", "$180k", "$90k", "$110k"],
  ["安全可控", "●●●", "●", "●●"],
  ["团队要求", "全栈 5 人", "1 人运营", "后端 2 人"],
  ["推荐度", "×", "△", "✓"],
];
container.add(table);

const recommend = createText("推荐：混合方案 — 兼顾上线速度（3 个月）与定制能力；TCO 中等可控。");
recommend.fontSize = 10;
recommend.color = accent;
recommend.fontWeight = "bold";
recommend.position = "absolute";
recommend.left = 0.5;
recommend.bottom = 0.35;
recommend.width = 9;
recommend.height = 0.3;

slide.add(title, container, recommend);

compose({
  title: "Pure Table · Runnable Template",
  slides: [slide],
  theme: {
    colors: { accent1: accent, background: "#FFFFFF", text: "#101820", muted: "#6B7480" },
  },
});
