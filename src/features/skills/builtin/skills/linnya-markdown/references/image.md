# Document images

An image occupies its own paragraph. Existing images are projected as `![caption](<linnya-image://image-id>)`; an empty label means no visible caption. The reference is scoped to the current document. Preserve it exactly when editing the caption or surrounding text. It identifies an image occurrence, not a local file or a readable pixel URL.

Use a plain, single-line caption of at most 200 characters. Do not use Markdown formatting or add automatic figure numbers. Escape Markdown punctuation in the label. The caption is separate from the image's accessible alt text and tooltip title; editing it preserves those existing fields, dimensions, alignment and source. For charts, edit the `title` and `description` fields of the chart specification instead.

To insert a new image, reference a real PNG, JPEG or WebP in the current conversation work directory using `conversation:/relative/path.png` as the image target. Use angle brackets around a path with spaces or encode those spaces. Linnya validates the physical file and imports it into managed storage; later edits use the returned `linnya-image://` reference and do not depend on the conversation file continuing to exist.

HTTP(S), data URLs, Workspace paths, arbitrary local paths, other documents' image references and new SVG imports are rejected. Download remote images into the conversation directory first. Images within text, headings, lists or table cells are rejected; move the image into a separate paragraph. A bad image rejects the whole write, including otherwise valid text changes.

Repeating an existing image reference creates an independent occurrence that reuses its source asset. Reordering may be represented as a deletion and an insertion with separate Pending decisions; it is not an atomic move preserving the root block identity. Current reads include Pending insertions/captions and omit Pending deletions. Rejecting a new Pending-only image releases its ownership; accepted images still reachable from retained document or block history remain available. Image listings are metadata only and do not mean the agent has viewed pixels.
