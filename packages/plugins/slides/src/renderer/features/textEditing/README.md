# Slides in-place text editing

`textEditing` owns the browser-native input session for one compiler-projected plain-text author object. It is intentionally independent from `manualEditing`: the latter owns selection, drag, command submission and revision presentation, while this feature owns the active text target, draft, IME state and DOM visual projection.

## Contract

- `createTextEditingTarget` consumes one world-coordinate `RenderNodeSelectionGeometry` and the committed `TextRenderNode`. It accepts only `authoringEdit.text.kind === 'plain_text'`; rich runs and formula runs are rejected because a whole-string replacement cannot preserve their semantics.
- The target records the world polygon origin, dimensions, cumulative rotation, padding, vertical alignment offset and the first rendered text style. It never reads Konva instances or DOM layout back into author state.
- `InlineTextEditor` converts inches and points into CSS pixels using the current stage scale. During the session, `SlideStage` passes the target element ID down the Konva render tree so exactly one duplicate Canvas text node is hidden.
- The feature emits the existing `set_text_content` operation. The backend remains the only source writer, and the draft stays open until `manualEditing` observes the committed revision in a complete visual frame. A failed command therefore preserves the user's draft.

## Interaction

- Double-click opens the textarea and places the caret at the end.
- Blur or `Ctrl/Cmd+Enter` requests a commit. An unchanged draft closes without a command.
- `Escape` cancels the local draft.
- Composition events block commit and cancel shortcuts until the browser ends the IME composition.
- Pointer events inside the textarea do not reach the stage drag interaction.

## Layers

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
- `orchestration/useSlideTextEditingSession.test.ts` covers IME blocking, command creation, draft retention until presentation and unchanged-draft close.
- `manualEditing/orchestration/useSlideManualEditingInteraction.test.ts` covers the stage integration and failed-command draft retention.
