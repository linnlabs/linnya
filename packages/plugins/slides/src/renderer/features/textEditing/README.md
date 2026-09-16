# Slides in-place text editing

`textEditing` owns the browser-native input session for one compiler-projected plain-text author object. It is intentionally independent from `manualEditing`: the latter owns selection, drag, command submission and revision presentation, while this feature owns the active text target, draft, IME state and DOM visual projection.

## Contract

- `createTextEditingTarget` consumes one world-coordinate `RenderNodeSelectionGeometry` and the committed `TextRenderNode` or Shape's `innerText`. It accepts only `authoringEdit.text.kind === 'plain_text'`; rich runs and formula runs are rejected because a whole-string replacement cannot preserve their semantics.
- The target records the world polygon origin, dimensions, cumulative rotation, padding, vertical alignment offset and the first rendered text style. It never reads Konva instances or DOM layout back into author state.
- `InlineTextEditor` converts inches and points into CSS pixels using the current stage scale. During the session, `SlideStage` passes the target element ID down the Konva render tree so exactly one duplicate Canvas text node is hidden.
- The feature emits the existing `set_text_content` operation into `manualEditing`'s typed intent queue. The editor owns only its local submission-pending flag, so another manual command does not prevent opening or committing a text session. The backend remains the only source writer, and the draft stays open until `manualEditing` observes that text intent's committed revision in a complete visual frame. A failed active command rolls back the queue, preserves the user's draft and cancels any deferred outside-click selection.

## Interaction

- Plain-string Shape content uses the same session and commit flow as Text. Immediately after a move/resize, opening uses the currently projected geometry. The Shape stays visible while only its Canvas inner text is hidden. The canvas selection owns the single blue editing outline; the textarea adds no second border or focus ring.
- During Shape resizing, local previews update the inner text box and realign existing committed line slices immediately. They preserve font size and line breaks; final reflow/autofit remains owned by backend text finalization, without a second browser measurement algorithm.

- Double-click opens the textarea and places the caret at the end.
- Blur or `Ctrl/Cmd+Enter` requests one commit and locally blocks duplicate submission until success or failure settles. An unchanged draft closes without a command. When the user clicks another slide object to blur a changed draft, `manualEditing` retains that click and applies the requested selection after the committed visual revision is presented.
- `Escape` cancels the local draft.
- Composition events block commit and cancel shortcuts until the browser ends the IME composition.
- Pointer events inside the textarea do not reach the stage drag interaction.

## Layers

`InlineTextEditor.css` is feature-owned and registered by the Renderer entry through `slidesStylesheets`. Do not add an SFC side-effect style import: installed plugin artifacts must declare this stylesheet and load it through the Host lifecycle.

```text
definitions/
  input-session and committed visual projection contracts
functions/
  RenderModel-to-editor target and target-to-CSS projection
orchestration/
  open, IME, commit, cancel and presentation-complete session flow
store/
  active target, draft and composition state
ui/
  thin textarea overlay
```

## Tests

- `functions/createTextEditingTarget.test.ts` covers world rotation, geometry, vertical alignment, font-scale projection and the rich-text boundary.
- `functions/createInlineTextEditorStyle.test.ts` covers the stage-to-DOM coordinate conversion under zoom.
- `orchestration/useSlideTextEditingSession.test.ts` covers IME blocking, duplicate-submit blocking, failed-draft retry, draft retention until presentation and unchanged-draft close.
- `manualEditing/orchestration/useSlideManualEditingInteraction.test.ts` covers the stage integration and failed-command draft retention.
- `smoke:preview-transitions` drives a native Chromium double click on a production Shape preview, checks that only one outline and one text representation remain, blocks IME submission, and commits one Shape-typed command. Its resize fixture checks text alignment before pointer release, across consecutive resizes and Escape rollback. These synthetic browser checks do not replace real-document save/reopen/history acceptance.
