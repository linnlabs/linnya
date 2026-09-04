---
name: linnya-markdown
description: Preserve and create Linnya-compatible Markdown syntax. Use when Workspace Markdown contains or needs Linnya annotations.
---

# Linnya Markdown

- `<!-- linnya-annotation:v1 ... -->` is a canonical block annotation. Preserve the entire comment and keep it immediately after its target block unless the task explicitly changes or deletes that annotation.
- To add an annotation, place a plain `<!-- comment text -->` immediately after the target block. Do not handcraft the canonical JSON; Linnya will canonicalize it on save.
