# App Toolbar Behavior Contract

This contract defines the expected runtime behavior for every control in `AppToolbar.tsx`.

## File group

- `Open folder` -> opens folder chooser and sets explorer root to selected folder.
- `Print` -> prints active document as rendered HTML in a dedicated print window.
- `Refresh workspace` -> refreshes file tree and triggers git status/log/branch refresh actions.
- `Export PDF` -> exports active document to PDF through editor export pipeline.
- `Open version control tab` -> switches right sidebar to the version control tab.
- `Open AI tab` -> switches right sidebar to the AI tab.

## Insert group

- `Insert heading` -> prefixes current line with markdown heading markers (`#` to `######`).
- `Insert table` -> inserts a markdown table snippet at current selection.
- `Insert math` -> wraps selection in inline math or inserts default math snippet.
- `Insert Mermaid` -> inserts a Mermaid fenced code block.

## Format/Text/Content/Lists groups

- `Bold`, `Italic`, `Strikethrough` -> toggles markdown decorator pairs.
- `Font color`, `Font`, `Text size`, `Underline`, `Highlight`, `Text align` -> inserts HTML formatting wrappers (`Text align` wraps the selection in a block-level `span` with `text-align` and `width:100%`, not a `<p>`, so it renders correctly inside the markdown inline-HTML widget).
- `Insert link`, `Inline comment`, `Insert image` -> inserts markdown/HTML content snippets.
- `Bullet list`, `Checklist`, `Numbered list` -> prefixes current line with list marker syntax.

## Review group

- `Spell check` -> runs dictionary-backed spell checking and reports issues.
- `Grammar check` -> runs rule-based grammar/style checks and reports issues.
- `Readability check` -> computes readability metrics and reports score/band.

## History group

- `Undo` -> runs CodeMirror undo command in active editor.
- `Redo` -> runs CodeMirror redo command in active editor.
