const overview = createSlide({
  slideKey: "overview",
  background: { color: "#FFFFFF" },
});

overview.add(createText({
  editKey: "headline",
  content: "Original headline",
  x: 0.8,
  y: 0.6,
  w: 6,
  h: 0.8,
  fontSize: 28,
  fontWeight: "bold",
}));

overview.add(createChart({
  editKey: "revenue_chart",
  preset: "clean-column",
  categories: ["Q1", "Q2"],
  series: [{ name: "Revenue", values: [10, 18] }],
  x: 0.8,
  y: 1.7,
  w: 6,
  h: 3.2,
}));

overview.add(createShape({
  editKey: "obsolete_badge",
  x: 7.2,
  y: 0.6,
  w: 1.2,
  h: 0.4,
  fill: "#C66A3D",
}));

compose({
  title: "Manual edits",
  theme: {
    colors: { accent1: "#224466" },
    fonts: { major: "Aptos Display", minor: "Aptos" },
    chart: { palette: ["#224466", "#C66A3D"] },
  },
  slides: [overview],
  manualEdits: {
    version: 2,
    slides: [{
      slideKey: "overview",
      targets: [
        { kind: "text", editKey: "headline", content: "Updated headline" },
        { kind: "chart", editKey: "revenue_chart", translation: { dx: 0.2, dy: 0 } },
        { kind: "shape", editKey: "obsolete_badge", deleted: true },
      ],
      // 用户在编辑器里插入的对象：改稿时原样保留。
      additions: [
        {
          kind: "text",
          editKey: "inserted-note",
          box: { x: 7.2, y: 4.6, w: 2.4, h: 0.5 },
          content: "Source: Q2 report",
          style: { fontSize: 12, color: "#475569" },
        },
      ],
    }],
  },
});
