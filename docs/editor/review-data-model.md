# Review Data Model (Comments + Suggestions)

## Objectives
- Keep metadata stable across document edits.
- Use explicit IDs and lifecycle states for deterministic UI behavior.
- Keep structures transport-friendly for future remote sync.

## Comment thread model
```ts
type CommentThread = {
  id: string;
  anchor: { from: number; to: number };
  createdAt: number;
  updatedAt: number;
  status: 'open' | 'resolved';
  authorId: string;
  snippet: string;
};
```

- `anchor.from`/`anchor.to` are mapped through `ChangeDesc.mapPos` on every transaction.
- `snippet` stores creation-time context for list previews when the live range becomes empty.

## Suggestion model
```ts
type Suggestion = {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: 'pending' | 'accepted' | 'rejected';
  authorId: string;
  from: number;
  to: number;
  originalText: string;
  suggestedText: string;
};
```

- Suggestions in suggest mode are non-destructive by default; edits become metadata entries first.
- Accept applies document changes and marks `accepted`.
- Reject preserves the base document and marks `rejected`.

## Command taxonomy
- `editor.review.createComment`
- `editor.review.nextComment`
- `editor.review.previousComment`
- `editor.review.resolveComment`
- `editor.review.reopenComment`
- `editor.review.toggleSuggestMode`
- `editor.review.acceptSuggestion`
- `editor.review.rejectSuggestion`

## Persistence notes
- Current run keeps review state in editor runtime state fields.
- Persisting to workspace metadata can be added later by serializing fields to JSON and restoring via startup effects.
