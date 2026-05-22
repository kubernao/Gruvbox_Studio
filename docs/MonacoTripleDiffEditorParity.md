# Monaco Triple-Diff Parity Checklist

The new `MonacoTripleDiffEditor` keeps the same user contract as `MonacoDiffEditor` while adapting it to a dual-diff three-way merge layout where one result model is authoritative and one is mirrored.

- Navigation parity: toolbar `prev/next` continues to drive Monaco-native movement (`goToDiff`) on the authoritative diff, with secondary diff cursor/reveal synchronized to the same result line.
- Merge parity: merge buttons still mutate only the save-source buffer (`resultAuthoritative`), and mirror updates are applied after each edit so both diff columns stay visually consistent.
- Word wrap and diff algorithm parity: both visible diff editors use side-by-side mode, `wordWrap/diffWordWrap` enabled, and `diffAlgorithm: 'legacy'` to match current worker-stability behavior.
- Keyboard parity: F7 navigation remains available through authoritative Monaco diff navigation and toolbar bindings.
- Styling parity: merge save-buffer framing still applies to the authoritative modified pane, preserving existing merge visual affordances.
