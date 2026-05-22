# DiffViewer Integration Guide

## Quick Start

### 1. Import the Component

```typescript
import { DiffViewer } from './components/DiffViewer';
import './components/DiffViewer/DiffViewer.css'; // Don't forget styles!
```

### 2. Provide Callbacks

```typescript
function MyComponent() {
  const handleFetchDiff = async (
    hash1: string,
    hash2: string,
    repoPath: string,
  ): Promise<string> => {
    // Call your git provider / API
    const response = await ipc.invoke('git-provider', {
      command: 'git-diff',
      repoPath,
      hash1,
      hash2,
      fullContext: true,
    });
    
    if (typeof response === 'string') {
      return response;
    } else if (response && 'error' in response) {
      throw new Error(response.error);
    }
    return '';
  };

  const handleSave = async (
    mergedContent: string,
    filePath: string,
  ): Promise<void> => {
    await ipc.invoke('application', {
      command: 'write-text-file',
      path: filePath,
      content: mergedContent,
    });
  };

  return (
    <DiffViewer
      onFetchDiff={handleFetchDiff}
      onSave={handleSave}
      onClose={() => {
        // Close your modal/tab
      }}
    />
  );
}
```

### 3. Use in Your App

```typescript
export function App() {
  const [showDiff, setShowDiff] = useState(false);

  return (
    <>
      <button onClick={() => setShowDiff(true)}>View Diff</button>
      
      {showDiff && (
        <div style={{ width: '100%', height: '600px' }}>
          <DiffViewer
            onFetchDiff={/* ... */}
            onSave={/* ... */}
            onClose={() => setShowDiff(false)}
          />
        </div>
      )}
    </>
  );
}
```

## State Management Integration

If your app uses a state store (Pinia/Redux/Zustand), you can connect it:

```typescript
// Example with Zustand
import { useGitStore } from './stores/gitStore';

function DiffViewerContainer() {
  const store = useGitStore();
  const [leftHash, setLeftHash] = useState('');
  const [rightHash, setRightHash] = useState('');

  const handleFetchDiff = async () => {
    return await store.gitDiff(leftHash, rightHash);
  };

  return (
    <div>
      <select 
        value={leftHash} 
        onChange={(e) => setLeftHash(e.target.value)}
      >
        {store.commits.map((c) => (
          <option key={c.hash} value={c.hash}>
            {c.message}
          </option>
        ))}
      </select>

      <DiffViewer onFetchDiff={handleFetchDiff} />
    </div>
  );
}
```

## Styling Customization

### CSS Variables

Override in your root or wrapper element:

```css
:root {
  /* Colors */
  --color-bg: #1e1e1e;
  --color-fg: #e0e0e0;
  --color-bg-secondary: #2d2d2d;
  --color-border: #404040;

  /* Diff colors */
  --color-del-bg: #4a2626;
  --color-ins-bg: #264a26;
  --color-change-bg: #4a3a26;

  /* Semantic colors */
  --color-primary: #61dafb;
  --color-success: #4ec9b0;
  --color-danger: #f48771;
  --color-warning: #dcdcaa;

  /* Word-level highlighting */
  --color-word-del-bg: #6a3a3a;
  --color-word-del-fg: #ff9999;
  --color-word-ins-bg: #3a6a3a;
  --color-word-ins-fg: #99ff99;
}

.diff-viewer {
  /* Customize any class here */
}
```

### Complete Dark Theme Example

```css
/* Dark theme */
:root {
  --color-bg: #1e1e1e;
  --color-fg: #d4d4d4;
  --color-bg-secondary: #252526;
  --color-border: #3e3e42;
  --color-btn-bg: #3e3e42;
  --color-btn-bg-hover: #454547;
  --color-gutter-bg: #252526;
  --color-scrollbar-thumb: #797979;
  --color-scrollbar-thumb-hover: #999999;
  --color-del-bg: #4a2626;
  --color-del-fg: #ff9999;
  --color-ins-bg: #264a26;
  --color-ins-fg: #99ff99;
  --color-change-bg: #4a3a26;
  --color-separator-bg: #3a3a3a;
  --color-info: #1e3a5f;
  --color-info-fg: #9ecef0;
  --color-warning: #5a4a2a;
  --color-warning-fg: #dcdcaa;
  --color-success: #2a5a3a;
  --color-success-fg: #7ec9b0;
  --color-danger: #5a2a2a;
  --color-danger-fg: #f48771;
}

/* Additional overrides */
.diff-viewer {
  background: var(--color-bg);
  color: var(--color-fg);
}

.diff-row-context {
  background: var(--color-bg);
}

.diff-row-del {
  background: var(--color-del-bg);
}

.diff-row-ins {
  background: var(--color-ins-bg);
}
```

## Advanced Usage

### Programmatic Control

```typescript
const diffViewerRef = useRef<HTMLDivElement>(null);

function AdvancedDiffView() {
  const [currentChangeIdx, setCurrentChangeIdx] = useState(0);

  const jumpToChange = (idx: number) => {
    // You'd need to expose this from DiffViewer
    setCurrentChangeIdx(idx);
  };

  return (
    <div ref={diffViewerRef}>
      <DiffViewer />
    </div>
  );
}
```

### Custom Merge Logic

If you need to implement custom merge strategies, extend the component:

```typescript
import { buildMergeResult } from './components/DiffViewer/utils/mergeResolver';

function CustomMergeResolver() {
  const applySmartMerge = (
    diffRows: DiffRow[],
    changeBlocks: ChangeBlock[],
  ) => {
    const selections: Record<number, 'left' | 'right'> = {};

    for (const block of changeBlocks) {
      // Custom logic: e.g., prefer shorter lines, or check for conflicts
      const row = diffRows[block.firstRowIdx];
      
      if (row.leftText && row.leftText.length < (row.rightText?.length || 0)) {
        selections[block.id] = 'left';
      } else {
        selections[block.id] = 'right';
      }
    }

    return buildMergeResult(diffRows, selections, changeBlocks);
  };

  return <div>{/* ... */}</div>;
}
```

### Performance: Large Diffs

For diffs with 10k+ lines, consider virtualization:

```typescript
import { FixedSizeList } from 'react-window';

function VirtualizedDiffPanes({
  diffRows,
  // ...
}: DiffPanesProps) {
  const Row = ({ index, style }) => (
    <div style={style}>
      {/* Render row at index */}
    </div>
  );

  return (
    <FixedSizeList
      height={800}
      itemCount={diffRows.length}
      itemSize={20}
      width="100%"
    >
      {Row}
    </FixedSizeList>
  );
}
```

### Word-Level Diff Enhancement

Replace the simple word splitter with the `diff` package:

```typescript
// In utils/fragments.ts
import { diffWordsWithSpace } from 'diff';

function computeWordDiff(
  oldText: string,
  newText: string,
  whichSide: 'left' | 'right',
): DiffFragment[] {
  const changes = diffWordsWithSpace(oldText, newText);
  
  const fragments: DiffFragment[] = changes.map((change) => ({
    text: change.value,
    op: change.removed ? 'del' : change.added ? 'ins' : 'equal',
  }));

  return whichSide === 'left'
    ? fragments.filter((f) => f.op !== 'ins')
    : fragments.filter((f) => f.op !== 'del');
}
```

Install dependency:
```bash
npm install diff
npm install --save-dev @types/diff
```

## API Reference

### DiffViewerProps

| Prop | Type | Description |
|------|------|-------------|
| `onFetchDiff` | `(hash1, hash2, repo) => Promise<string>` | Fetch unified diff content |
| `onSave` | `(content, filePath) => Promise<void>` | Save merged result |
| `onClose` | `() => void` | Called when user closes viewer |

### Exported Utilities

#### diffParser.ts
- `parseUnifiedDiff(text: string): DiffRow[]`
- `buildSideBySideRows(rawLines): DiffRow[]`
- `buildChangeBlocks(rows): ChangeBlock[]`

#### rowHelpers.ts
- `displayedLeftText(row): string | null`
- `displayedRightText(row): string | null`
- `leftRowClass(row, mergeMode, selections): string`
- `rightRowClass(row, mergeMode, selections): string`
- `computeCollapsedSpans(rows, blocks): void`
- `clearFragmentsForRange(rows, start, end): void`

#### scrollSync.ts
- `setScrollTopSmooth(el, target): void`
- `scrollPaneToCenterRowEl(pane, row): void`
- `setRibbonRedrawCallback(fn): void`
- `scheduleRibbonRedraw(): void`
- `shouldSuppressScrollEvent(el): boolean`
- `clearAllScrollState(): void`

#### mergeResolver.ts
- `buildMergeResult(rows, selections, blocks): string`
- `getUnresolvedBlockIds(blocks, selections): number[]`
- `resolveAllBlocksToSide(blocks, side): Record<number, 'left'|'right'>`

#### ribbonRenderer.ts
- `drawRibbons(svg, gutter, leftPane, rightPane, blocks, rows, currentIdx): void`
- `createRibbonGradient(svg, id, color1, color2): void`
- `getChangeBlockColor(row, isCurrentBlock): string`

#### fragments.ts
- `computeFragmentsForRow(row, side): DiffFragment[] | undefined`
- `getFragmentsForRow(row, side): DiffFragment[] | undefined`

## Troubleshooting

### Diff not showing
- Check if `onFetchDiff` is provided and returns valid unified diff
- Verify `diffRows.length > 0` (add console.logs)
- Check browser console for parsing errors

### Scroll sync janky
- Reduce animation parameters in `utils/scrollSync.ts` (FOLLOW_LERP, FOLLOW_MAX_STEP_PX)
- Check if large DOM elements are causing layout thrashing
- Profile with DevTools Performance tab

### Merge controls not appearing
- Ensure `mergeMode` is true
- Verify `changeBlocks.length > 0`
- Check CSS for ribbon controls (look for `.diff-ribbon-controls`)

### CSS not loading
- Verify import: `import './DiffViewer.css'`
- Check webpack/vite config includes CSS loader
- Inspect element to see if styles are applied

### Large diffs slow/hanging
- Consider virtualization for 50k+ lines
- Profile with React DevTools Profiler
- Check memory usage (diffRows array size)

## Debugging

Enable debug logging:

```typescript
// In DiffViewer.tsx
const DEBUG = true;

if (DEBUG) {
  console.log('Parsed rows:', state.diffRows.length);
  console.log('Change blocks:', state.changeBlocks);
  console.log('Current index:', state.currentChangeIdx);
  console.log('Merge selections:', state.changeSelections);
}
```

## Browser DevTools Tips

1. **Inspect rows**: `document.querySelectorAll('[data-row-idx]')`
2. **Check scroll state**: `leftPaneRef.current.scrollTop`
3. **View classes**: Right-click row → Inspect → Check classes
4. **Performance**: DevTools → Performance → Record → Scroll → Stop

## Accessibility

The component uses semantic HTML and ARIA labels:

```html
<button title="Previous change" aria-label="Previous change">↑</button>
```

Keyboard navigation:
- Tab/Shift+Tab to focus buttons
- Enter/Space to activate
- Arrow keys for scrolling (native browser behavior)

To enhance:
```typescript
// Add keyboard shortcuts
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' && e.ctrlKey) {
      jumpToChange(-1);
    } else if (e.key === 'ArrowDown' && e.ctrlKey) {
      jumpToChange(1);
    } else if (e.key === 's' && e.ctrlKey && mergeMode) {
      e.preventDefault();
      saveMerge();
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [jumpToChange, saveMerge, mergeMode]);
```

## Contributing

To extend the component:

1. Add new features in respective `utils/*.ts` files
2. Update `types.ts` with new interfaces
3. Add component props to `DiffViewerProps`
4. Update this guide with new API

## Support

For issues, check:
- Does the unified diff format match git standard?
- Are there circular dependencies?
- Is memory usage reasonable for diff size?
- Does it work in other browsers?
