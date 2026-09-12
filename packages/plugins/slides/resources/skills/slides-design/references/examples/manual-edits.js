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

compose({
  title: "Manual edits",
  theme: {
    colors: { accent1: "#224466" },
    fonts: { major: "Aptos Display", minor: "Aptos" },
    chart: { palette: ["#224466", "#C66A3D"] },
  },
  slides: [overview],
  manualEdits: {
    version: 1,
    slides: [{
      slideKey: "overview",
      targets: [
        { kind: "text", editKey: "headline", content: "Updated headline" },
        { kind: "chart", editKey: "revenue_chart", translation: { dx: 0.2, dy: 0 } },
      ],
    }],
  },
});
