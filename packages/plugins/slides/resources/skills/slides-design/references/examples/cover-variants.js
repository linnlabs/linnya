// 封面构造法对照 —— 五种结构上真正不同的封面，不是一份可提交的文稿。
// 目的是展示"封面可以怎么搭"，不是提供一张照抄的好封面。
// 每页的视觉系统都是这一页的一次性决策，不是 Linnya 的默认风格。

const ink = "#1B1A17";
const cream = "#FAF7F0";
const vermilion = "#C2482D";

// slide 1 — 字体主导：巨大标题 + 大留白 + 细规则线，没有任何卡片。
const typographicCover = createSlide({ background: { color: cream } });

const typoEyebrow = createText("ANNUAL REVIEW");
typoEyebrow.fontSize = 9;
typoEyebrow.color = vermilion;
typoEyebrow.letterSpacing = 3;
typoEyebrow.height = 0.26;

const typoRule = createShape({ fill: vermilion, width: 1.1, height: 0.03 });
typoRule.marginTop = 0.22;
typoRule.marginBottom = 0.34;

const typoTitle = createText("我们把增长\n重新定义为质量");
typoTitle.fontSize = 40;
typoTitle.fontWeight = "bold";
typoTitle.color = ink;
typoTitle.lineHeight = 1.08;
typoTitle.height = 2.1;

const typoFooter = createText("Strategy & Operations · FY2025");
typoFooter.fontSize = 8.5;
typoFooter.color = "#7A736A";
typoFooter.height = 0.24;

const typoSpacer = createSpacer();
typoSpacer.flex = 1;

const typoBody = createFrame({
  flexDirection: "column",
  padding: { left: 1.1, right: 2.4, top: 1.2, bottom: 0.6 },
});
typoBody.flex = 1;
typoBody.add(typoEyebrow, typoRule, typoTitle, typoSpacer, typoFooter);
typographicCover.add(typoBody);

// slide 2 — 图片主导：全幅主视觉 + 渐变遮罩 + 反白标题。
// 图片来源必须是本次对话真实存在的文件；下面的 locator 只是占位，提交前必须替换成
// 真实的 conversation:/ 图片、外部 URL 或绝对路径，禁止原样保留。
const imageCover = createSlide();

const heroImage = createImage({
  src: "conversation:/images/REPLACE-WITH-REAL-HERO.jpg",
  fitMode: "cover",
});
heroImage.position = "absolute";
heroImage.left = 0;
heroImage.top = 0;
heroImage.width = "100%";
heroImage.height = "100%";

// 遮罩让反白文字在任何照片上都保持可读；从底部深色渐变到顶部全透明。
const heroScrim = createShape({
  fill: {
    type: "linear",
    angle: 90,
    stops: [
      { color: "#000000", position: 0, opacity: 0 },
      { color: "#000000", position: 0.55, opacity: 0.35 },
      { color: "#000000", position: 1, opacity: 0.82 },
    ],
  },
});
heroScrim.position = "absolute";
heroScrim.left = 0;
heroScrim.top = 0;
heroScrim.width = "100%";
heroScrim.height = "100%";

const heroTitle = createText("走进现场");
heroTitle.fontSize = 34;
heroTitle.fontWeight = "bold";
heroTitle.color = "#FFFFFF";
heroTitle.height = 0.85;

const heroSub = createText("2025 年一线运营纪实");
heroSub.fontSize = 12;
heroSub.color = "#E8E4DE";
heroSub.height = 0.34;

const heroSpacer = createSpacer();
heroSpacer.flex = 1;

const heroText = createFrame({
  flexDirection: "column",
  padding: { left: 0.85, right: 3.2, top: 0.8, bottom: 0.75 },
});
heroText.flex = 1;
heroText.add(heroSpacer, heroTitle, heroSub);

// absolute 层级 = 添加顺序：图片在最底，遮罩居中，文字最后添加所以在最上。
imageCover.add(heroImage, heroScrim, heroText);

// slide 3 — 数据主导：一个结论级数字承担全部视觉重量。
const statCover = createSlide({ background: { color: "#0E1116" } });

const statLabel = createText("净收入留存");
statLabel.fontSize = 10;
statLabel.color = "#8B95A5";
statLabel.letterSpacing = 2;
statLabel.height = 0.28;

const statNumber = createText("132%");
statNumber.fontSize = 88;
statNumber.fontWeight = "bold";
statNumber.color = "#FFFFFF";
statNumber.lineHeight = 1;
statNumber.height = 1.6;

const statNote = createText("连续三个季度高于 130%，扩容而非新签是主要来源");
statNote.fontSize = 11.5;
statNote.color = "#B7C0CC";
statNote.height = 0.34;
statNote.marginTop = 0.3;

const statBody = createFrame({
  flexDirection: "column",
  justifyContent: "center",
  padding: { left: 1.0, right: 2.2, top: 0.6, bottom: 0.6 },
});
statBody.flex = 1;
statBody.add(statLabel, statNumber, statNote);
statCover.add(statBody);

// slide 4 — 编辑出版：多栏网格 + 规则线，标题不再独占整页。
const editorialCover = createSlide({ background: { color: "#FFFFFF" } });

const edTopRule = createShape({ fill: ink, width: "100%", height: 0.02 });

const edKicker = createText("ISSUE 04 · 供应链");
edKicker.fontSize = 8.5;
edKicker.color = vermilion;
edKicker.letterSpacing = 2;
edKicker.height = 0.24;
edKicker.marginTop = 0.34;

const edTitle = createText("把韧性做进流程，而不是做进库存");
edTitle.fontSize = 26;
edTitle.fontWeight = "bold";
edTitle.color = ink;
edTitle.lineHeight = 1.18;
edTitle.height = 1.5;
edTitle.marginTop = 0.22;

const edLead = createFrame({ flexDirection: "column" });
edLead.flex = 5;
edLead.add(edKicker, edTitle);

function makeEditorialColumn(heading, body) {
  const column = createFrame({ flexDirection: "column" });
  column.flex = 1;

  const columnRule = createShape({ fill: "#D9D4CC", width: "100%", height: 0.012 });

  const columnHeading = createText(heading);
  columnHeading.fontSize = 9.5;
  columnHeading.fontWeight = "bold";
  columnHeading.color = ink;
  columnHeading.height = 0.26;
  columnHeading.marginTop = 0.16;

  const columnBody = createText(body);
  columnBody.fontSize = 8.5;
  columnBody.color = "#6B655C";
  columnBody.lineHeight = 1.45;
  columnBody.flex = 1;
  columnBody.marginTop = 0.08;

  column.add(columnRule, columnHeading, columnBody);
  return column;
}

const edColumns = createFrame({ flexDirection: "row", gap: 0.4 });
edColumns.flex = 4;
edColumns.add(
  makeEditorialColumn("现状", "单一来源占比 47%，交付周期波动最大。"),
  makeEditorialColumn("动作", "双源认证、就近备料、按风险分级安全库存。"),
  makeEditorialColumn("结果", "缺料停线从 11 天降到 3 天，库存未上升。"),
);

const edBody = createFrame({
  flexDirection: "column",
  padding: { left: 0.75, right: 0.75, top: 0.55, bottom: 0.55 },
});
edBody.flex = 1;
edBody.add(edLead, edColumns);
editorialCover.add(edTopRule, edBody);

// slide 5 — 色块宣言：渐变背景 + 几何图形，文案极短。
const manifestoCover = createSlide({
  background: {
    gradient: {
      type: "linear",
      angle: 135,
      stops: [
        { color: "#12233F", position: 0 },
        { color: "#2E5F8A", position: 0.6 },
        { color: "#4E8FA8", position: 1 },
      ],
    },
  },
});

// 自定义几何：正六边形，旋转后作为大面积低透明度装饰，不承载信息。
const manifestoMark = createShape({
  geometry: { type: "regularPolygon", sides: 6 },
  fill: "#FFFFFF",
  opacity: 0.08,
  rotate: 18,
});
manifestoMark.position = "absolute";
manifestoMark.left = 6.6;
manifestoMark.top = -0.9;
manifestoMark.width = 4.6;
manifestoMark.height = 4.6;

const manifestoTitle = createText("少做一点，\n做深一点。");
manifestoTitle.fontSize = 36;
manifestoTitle.fontWeight = "bold";
manifestoTitle.color = "#FFFFFF";
manifestoTitle.lineHeight = 1.12;
manifestoTitle.height = 1.9;

const manifestoSub = createText("2026 产品原则");
manifestoSub.fontSize = 11;
manifestoSub.color = "#C6DBE8";
manifestoSub.letterSpacing = 1.5;
manifestoSub.height = 0.3;
manifestoSub.marginTop = 0.25;

const manifestoBody = createFrame({
  flexDirection: "column",
  justifyContent: "center",
  padding: { left: 0.95, right: 3.6, top: 0.6, bottom: 0.6 },
});
manifestoBody.flex = 1;
manifestoBody.add(manifestoTitle, manifestoSub);
manifestoCover.add(manifestoMark, manifestoBody);

compose({
  title: "封面构造法对照",
  slides: [
    typographicCover,
    imageCover,
    statCover,
    editorialCover,
    manifestoCover,
  ],
  theme: {
    colors: { accent1: vermilion, accent2: ink, background: cream, text: ink, muted: "#7A736A" },
  },
});
