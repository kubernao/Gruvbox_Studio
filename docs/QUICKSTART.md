# Quick Start: React DiffViewer

## 🚀 Get Started in 5 Minutes

### 1️⃣ Import the Component
```typescript
import { DiffViewer } from './components/DiffViewer';
import './components/DiffViewer/DiffViewer.css';
```

### 2️⃣ Provide Callbacks
```typescript
const handleFetchDiff = async (hash1: string, hash2: string, repo: string) => {
  // Call your git provider
  const result = await fetch('/api/diff', {
    method: 'POST',
    body: JSON.stringify({ hash1, hash2 }),
  });
  return result.text();
};

const handleSave = async (content: string, path: string) => {
  // Save merged file
  await fetch('/api/save', {
    method: 'POST',
    body: JSON.stringify({ content, path }),
  });
};
```

### 3️⃣ Render Component
```typescript
<DiffViewer
  onFetchDiff={handleFetchDiff}
  onSave={handleSave}
  onClose={() => console.log('closed')}
/>
```

## 📋 What's Included

- ✅ **DiffViewer.tsx** - Main component (13.5 KB)
- ✅ **Sub-Components** - Toolbar, Headers, Panes, RibbonGutter (8.5 KB)
- ✅ **Utilities** - Parser, scrollSync, mergeResolver, etc. (6 files, 28 KB)
- ✅ **Types** - Full TypeScript support (2.4 KB)
- ✅ **Styling** - Comprehensive CSS with dark mode (10.3 KB)
- ✅ **Documentation** - README + Integration Guide (20 KB)

**Total: 16 files, 89 KB of production-ready code**

## 🎯 Key Features

| Feature | Status | Details |
|---------|--------|---------|
| Side-by-side diff | ✅ | Unified diff parsing & rendering |
| Sync scrolling | ✅ | Smooth eased animation |
| Ribbon gutter | ✅ | SVG visualization |
| Merge mode | ✅ | Per-hunk resolution |
| Change nav | ✅ | Jump to prev/next |
| Word highlighting | ✅ | Intra-line diff |
| Collapsed rows | ✅ | Large blocks collapse |
| Responsive | ✅ | Mobile-friendly layout |
| Dark mode | ✅ | CSS variables support |
| TypeScript | ✅ | Full type safety |

## 📦 File Structure

```
src/components/DiffViewer/
├── DiffViewer.tsx           # Main (state, refs, callbacks)
├── DiffToolbar.tsx          # Toolbar (nav, merge buttons)
├── DiffHeaders.tsx          # Column headers
├── DiffPanes.tsx            # Table rendering
├── RibbonGutter.tsx         # SVG ribbon + controls
├── types.ts                 # TypeScript interfaces
├── DiffViewer.css           # Comprehensive styling
├── index.ts                 # Exports
├── utils/
│   ├── diffParser.ts        # Unified diff → DiffRow[]
│   ├── rowHelpers.ts        # Row utilities
│   ├── scrollSync.ts        # Smooth scroll animation
│   ├── mergeResolver.ts     # Merge result building
│   ├── ribbonRenderer.ts    # SVG generation
│   └── fragments.ts         # Word-level diff
├── README.md                # Full documentation
└── INTEGRATION_GUIDE.md     # Setup & advanced usage
```

## 🔧 Core API

```typescript
interface DiffViewerProps {
  onFetchDiff?: (hash1, hash2, repo) => Promise<string>;
  onSave?: (content, filePath) => Promise<void>;
  onClose?: () => void;
}

// Example exports
export {
  parseUnifiedDiff,
  buildChangeBlocks,
  leftRowClass,
  rightRowClass,
  buildMergeResult,
  setScrollTopSmooth,
  drawRibbons,
  // ... 10+ more utilities
};
```

## 🎨 Theming

Override CSS variables:

```css
:root {
  --color-bg: #1e1e1e;
  --color-fg: #e0e0e0;
  --color-del-bg: #4a2626;
  --color-ins-bg: #264a26;
  --color-primary: #61dafb;
  /* 20+ more variables available */
}
```

## 🧪 Testing

Utilities are pure functions - easy to test:

```typescript
import { parseUnifiedDiff } from './utils/diffParser';

const diff = `diff --git a/test.txt b/test.txt
...`;

const rows = parseUnifiedDiff(diff);
expect(rows.length).toBeGreaterThan(0);
```

## 📚 Documentation

1. **README.md** - Features, usage, types, performance
2. **INTEGRATION_GUIDE.md** - Setup, customization, troubleshooting
3. **Inline comments** - Every function documented
4. **TypeScript** - Type hints on all APIs

## ⚡ Performance

- RAF-throttled ribbon redraws
- Scroll animation with hysteresis
- Fragment caching
- Block bounds caching
- Efficient scroll suppression
- Lazy computation

## 🌐 Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## 🚦 Next Steps

1. ✅ All 16 files created
2. ✅ Ready to import
3. ✅ Full TypeScript support
4. ✅ Ready for production use

**No additional setup required!**

## 💡 Example: Dark Theme

```css
/* app.css */
:root {
  --color-bg: #1e1e1e;
  --color-fg: #e0e0e0;
  --color-bg-secondary: #252526;
  --color-border: #3e3e42;
  --color-del-bg: #4a2626;
  --color-del-fg: #ff9999;
  --color-ins-bg: #264a26;
  --color-ins-fg: #99ff99;
  --color-primary: #61dafb;
}
```

## 📞 Support

- See README.md for detailed documentation
- See INTEGRATION_GUIDE.md for troubleshooting
- Check inline comments in source files

---

**Ready to use! Just import and provide callbacks.** 🎉
