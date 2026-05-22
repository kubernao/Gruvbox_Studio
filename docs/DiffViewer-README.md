# React DiffViewer Component

A comprehensive, production-ready React implementation of a side-by-side git diff viewer, translated from the Vue.js component. Features synchronized scrolling, merge mode with per-hunk resolution, ribbon gutter visualization, and more.

## Features

✅ **Side-by-side diff rendering** - Unified diff parsed into aligned left/right panes
✅ **Synchronized scrolling** - Smooth animated scroll sync between panes
✅ **Ribbon gutter** - Meld-style visualization showing change connections
✅ **Change navigation** - Jump to previous/next change block
✅ **Merge mode** - Per-hunk resolution with accept left/right controls
✅ **Word-level highlighting** - Intra-line diff with color coding
✅ **Collapsed rows** - Large deletion/insertion blocks collapse to placeholders
✅ **Responsive layout** - Flex-based, adapts to container
✅ **Keyboard accessible** - Button-based controls, proper ARIA labels
✅ **TypeScript** - Full type safety

## Component Structure

```
src/components/DiffViewer/
├── DiffViewer.tsx              # Main component with orchestration
├── DiffToolbar.tsx             # Toolbar (nav, buttons)
├── DiffHeaders.tsx             # Column headers
├── DiffPanes.tsx               # Left/right pane rendering
├── RibbonGutter.tsx            # SVG ribbon + merge controls
├── types.ts                    # TypeScript interfaces
├── DiffViewer.css              # Comprehensive styling
└── utils/
    ├── diffParser.ts           # Unified diff parsing
    ├── rowHelpers.ts           # Row utilities, CSS classes
    ├── scrollSync.ts           # Scroll animation, sync logic
    ├── mergeResolver.ts        # Merge result building
    ├── ribbonRenderer.ts       # SVG path generation
    └── fragments.ts            # Word-level diff fragments
```

## Usage

### Basic Example

```typescript
import React from 'react';
import { DiffViewer } from './components/DiffViewer';

export function MyApp() {
  const handleFetchDiff = async (hash1: string, hash2: string, repo: string) => {
    // Fetch unified diff from your git provider
    const response = await fetch(`/api/git-diff`, {
      method: 'POST',
      body: JSON.stringify({ hash1, hash2, repoPath: repo }),
    });
    return response.text();
  };

  const handleSave = async (mergedContent: string, filePath: string) => {
    // Save merged file
    await fetch(`/api/save-file`, {
      method: 'POST',
      body: JSON.stringify({ content: mergedContent, path: filePath }),
    });
  };

  return (
    <DiffViewer
      onFetchDiff={handleFetchDiff}
      onSave={handleSave}
      onClose={() => console.log('Diff viewer closed')}
    />
  );
}
```

### Props

```typescript
interface DiffViewerProps {
  /**
   * Callback to fetch diff content.
   * @param hash1 - Left version hash
   * @param hash2 - Right version hash
   * @param repoPath - Repository path (if needed)
   * @returns Unified diff string
   */
  onFetchDiff?: (hash1: string, hash2: string, repoPath: string) => Promise<string>;

  /**
   * Callback to save merged file.
   * @param mergedContent - The resolved merge result
   * @param filePath - Target file path
   */
  onSave?: (mergedContent: string, filePath: string) => Promise<void>;

  /**
   * Callback when user closes the diff viewer
   */
  onClose?: () => void;
}
```

## Key Functions

### Diff Parsing

```typescript
import { parseUnifiedDiff, buildChangeBlocks } from './components/DiffViewer/utils/diffParser';

const diffContent = `diff --git a/file.txt b/file.txt
...
`;

const rows = parseUnifiedDiff(diffContent);
const blocks = buildChangeBlocks(rows);
```

### Merge Resolution

```typescript
import { buildMergeResult } from './components/DiffViewer/utils/mergeResolver';

const selections: Record<number, 'left' | 'right' | null> = {
  0: 'left',   // Accept left for block 0
  1: 'right',  // Accept right for block 1
};

const merged = buildMergeResult(diffRows, selections, changeBlocks);
```

### Row Helpers

```typescript
import { leftRowClass, rightRowClass, displayedLeftText } from './components/DiffViewer/utils/rowHelpers';

const leftClass = leftRowClass(row, mergeMode, changeSelections);
const rightClass = rightRowClass(row, mergeMode, changeSelections);
const text = displayedLeftText(row);
```

### Scroll Synchronization

```typescript
import { setScrollTopSmooth, scrollPaneToCenterRowEl } from './components/DiffViewer/utils/scrollSync';

// Smooth scroll with easing animation
setScrollTopSmooth(paneElement, targetScrollTop);

// Center a specific row element in the pane
scrollPaneToCenterRowEl(paneElement, rowElement);
```

### Ribbon Rendering

```typescript
import { drawRibbons } from './components/DiffViewer/utils/ribbonRenderer';

drawRibbons(
  svgElement,
  gutterElement,
  leftPaneElement,
  rightPaneElement,
  changeBlocks,
  diffRows,
  currentChangeIdx,
);
```

## Types

### DiffRow

```typescript
interface DiffRow {
  type: 'context' | 'del' | 'ins' | 'change' | 'separator' | 'collapsed';
  leftLineNo: number | null;
  rightLineNo: number | null;
  leftText: string | null;
  rightText: string | null;
  changeBlockId: number | null;
  collapsedSide?: 'left' | 'right';
  collapsedSpan?: number;
  collapsedSkip?: boolean;
  omittedCount?: number;
  leftFragments?: DiffFragment[];
  rightFragments?: DiffFragment[];
}
```

### ChangeBlock

```typescript
interface ChangeBlock {
  id: number;
  firstRowIdx: number;
  lastRowIdx: number;
}
```

## Styling

The component comes with comprehensive CSS (DiffViewer.css) that uses CSS custom properties for theming:

```css
--color-bg: #ffffff
--color-fg: #000000
--color-border: #e0e0e0
--color-bg-secondary: #f5f5f5
--color-del-bg: #ffe6e6
--color-ins-bg: #e6ffe6
--color-change-bg: #fff0e6
--color-primary: #007bff
--color-success: #28a745
--color-danger: #dc3545
--color-word-del-bg: #ffcccc
--color-word-ins-bg: #ccffcc
```

Override these in your CSS:

```css
:root {
  --color-bg: #1e1e1e;
  --color-fg: #e0e0e0;
  --color-primary: #61dafb;
}
```

## Performance Considerations

- **Lazy rendering**: Rows rendered only when visible (consider using react-window for very large diffs)
- **RAF throttling**: Ribbon redraws use requestAnimationFrame to avoid layout thrashing
- **Scroll animation state**: Uses WeakMap for efficient memory management
- **Fragment caching**: Word-level diff fragments cached per row
- **Bounds caching**: Block bounds cached per pane to avoid excessive getBoundingClientRect calls

## Implementation Notes

### Parsing Strategy

The parser converts unified diff format to a flat DiffRow array:
1. Parse hunk headers and extract line numbers
2. Classify lines as context, deletion, insertion, or separator
3. Pair consecutive del/ins lines as "change" rows
4. Collapse large pure-del or pure-ins blocks to placeholders

### Scroll Synchronization

Two-pane scroll sync uses ratio-based mapping with eased animation:
1. Calculate scroll position ratio in master pane (0-1)
2. Apply same ratio to slave pane's scroll height
3. Animate to target position with configurable easing (lerp-based)
4. Handle hysteresis and direction reversal for smooth UX

### Merge Mode

When merge mode is active:
1. Each change block can be resolved to 'left', 'right', or null (unresolved)
2. Rows re-colored based on resolution status (opaque/dimmed/hidden)
3. Collapsed spans recomputed to show the empty side
4. On save, merged content built by choosing per-block selections

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

Requires ES2020+ support. Uses:
- CSS Flexbox
- ES6 modules
- TypeScript (transpiled)
- SVG manipulation

## Testing

```typescript
// Example test
import { parseUnifiedDiff } from './utils/diffParser';

const diff = `diff --git a/test.txt b/test.txt
--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,4 @@
 line 1
-old line
+new line
 line 3`;

const rows = parseUnifiedDiff(diff);
expect(rows.length).toBe(4);
expect(rows[1].type).toBe('change');
```

## Known Limitations

1. **Word-level diff**: Uses simple word-boundary split. For production, integrate `diff` package's `diffWordsWithSpace` 
2. **Merge conflicts**: Doesn't handle existing git merge conflict markers
3. **Binary files**: Skips Binary files sections but doesn't render them specially
4. **Large diffs**: For 50k+ lines, consider virtualization (react-window)
5. **Modes/permissions**: Doesn't display file mode changes

## Future Enhancements

- [ ] Virtualization for massive diffs
- [ ] Context menu for copying lines
- [ ] Diff statistics (additions/deletions counts)
- [ ] 3-way merge mode
- [ ] Side-by-side branch comparison UI
- [ ] Undo/redo for merge resolutions
- [ ] Export merge result as patch
- [ ] Dark mode theme variants

## License

MIT (same as original Vue component)

## Credits

Translated from the original Vue.js DiffViewer component.
React translation maintains feature parity while following React best practices.
