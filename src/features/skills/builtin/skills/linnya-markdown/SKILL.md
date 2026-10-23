---
name: linnya-markdown
description: Preserve and create Linnya-compatible Markdown syntax. Use when Workspace Markdown contains or needs Linnya annotations, or when preserving or adding document images, or when a document needs a chart (bar, line, area, pie, doughnut, scatter, radar, combo).
---

# Linnya Markdown

- `<!-- linnya-annotation:v1 ... -->` is a canonical block annotation. Preserve the entire comment and keep it immediately after its target block unless the task explicitly changes or deletes that annotation.
- To add an annotation, place a plain `<!-- comment text -->` immediately after the target block. Do not handcraft the canonical JSON; Linnya will canonicalize it on save.
- A fenced block whose language is exactly `linnya-chart` is a chart: its body is one strict JSON object that Linnya renders and keeps editable. Preserve existing chart fences when you edit around them. Before writing or changing one, read [chart syntax, chart forms, palette selection and ordered colors](references/chart.md) with `read_resource`. Only `linnya-chart` is a chart; `chart`, `echarts` and `json` fences stay ordinary code.

- Images are standalone Markdown blocks. Preserve existing `linnya-image://` references from the current document; their labels are optional captions, not filenames. For image captions, copies, or new conversation images, first read [image syntax and source boundaries](references/image.md) with `read_resource`.
- Preserve block formulas using `$$` delimiters, not a `latex` code fence. A literal paragraph starting with `[` may be returned as `&#91;`; keep that encoding so it cannot be mistaken for a formula.
