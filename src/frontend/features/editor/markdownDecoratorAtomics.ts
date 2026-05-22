/**
 * Shared markdown decorator mark detection + atomic ranges, empty-mark cleanup,
 * and helpers for toolbar toggles. Used by markdownFormattingConceal and EditorPane.
 */
import { syntaxTree } from '@codemirror/language';
import {
  ChangeSet,
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  Range,
  RangeSet,
  RangeValue,
  StateField,
  Transaction,
} from '@codemirror/state';
import type { Text } from '@codemirror/state';
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { Tree } from '@lezer/common';
import { EditorView } from '@codemirror/view';

/** Lezer markdown node names for syntax punctuation (not body text). */
export const MARKDOWN_DECOR_MARK_NAMES = new Set([
  'HeaderMark',
  'QuoteMark',
  'ListMark',
  'LinkMark',
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
]);

/**
 * ATX heading marks only cover the `#` run; spaces after hashes should be
 * concealed / atomic with the hashes.
 */
export function includeSpacesAfterHeaderMark(state: EditorState, markFrom: number, markTo: number): number {
  const line = state.doc.lineAt(markFrom);
  let end = markTo;
  while (end < line.to) {
    const ch = state.doc.sliceString(end, end + 1);
    if (ch === ' ' || ch === '\t') {
      end += 1;
    } else {
      break;
    }
  }
  return end;
}

function includeSpacesAfterHeaderMarkInText(doc: Text, markFrom: number, markTo: number): number {
  const line = doc.lineAt(markFrom);
  let end = markTo;
  while (end < line.to) {
    const ch = doc.sliceString(end, end + 1);
    if (ch === ' ' || ch === '\t') {
      end += 1;
    } else {
      break;
    }
  }
  return end;
}

export function markRangeEnd(state: EditorState, nodeName: string, from: number, to: number): number {
  return nodeName === 'HeaderMark' ? includeSpacesAfterHeaderMark(state, from, to) : to;
}

function markRangeEndInDoc(doc: Text, nodeName: string, from: number, to: number): number {
  return nodeName === 'HeaderMark' ? includeSpacesAfterHeaderMarkInText(doc, from, to) : to;
}

/**
 * Walk visible ranges and invoke visitor for each decorator mark span.
 */
export function forEachMarkdownDecorMarkInRanges(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  visitor: (from: number, to: number, nodeName: string) => void
): void {
  const tree = syntaxTree(state);
  for (const { from: rFrom, to: rTo } of ranges) {
    tree.iterate({
      from: rFrom,
      to: rTo,
      enter: (node) => {
        if (!MARKDOWN_DECOR_MARK_NAMES.has(node.type.name)) {
          return;
        }
        const end = markRangeEnd(state, node.type.name, node.from, node.to);
        visitor(node.from, end, node.type.name);
      },
    });
  }
}

export type MarkdownDecoratorPairKind =
  | 'strong'
  | 'emphasis'
  | 'strikethrough'
  | 'inlineCode'
  | 'link'
  | 'image';

export interface MarkdownDecoratorPair {
  kind: MarkdownDecoratorPairKind;
  outerFrom: number;
  outerTo: number;
  innerFrom: number;
  innerTo: number;
  leftMarkFrom: number;
  leftMarkTo: number;
  rightMarkFrom: number;
  rightMarkTo: number;
}

function pushEmphasisLikePair(
  tree: Tree,
  outerFrom: number,
  outerTo: number,
  markName: string,
  kind: MarkdownDecoratorPairKind,
  out: MarkdownDecoratorPair[]
): void {
  const marks: { from: number; to: number }[] = [];
  tree.iterate({
    from: outerFrom,
    to: outerTo,
    enter: (node) => {
      if (node.from < outerFrom || node.to > outerTo) {
        return;
      }
      if (node.type.name === markName) {
        marks.push({ from: node.from, to: node.to });
      }
    },
  });
  if (marks.length < 2) {
    return;
  }
  marks.sort((a, b) => a.from - b.from);
  const left = marks[0];
  const right = marks[marks.length - 1];
  out.push({
    kind,
    outerFrom,
    outerTo,
    innerFrom: left.to,
    innerTo: right.from,
    leftMarkFrom: left.from,
    leftMarkTo: left.to,
    rightMarkFrom: right.from,
    rightMarkTo: right.to,
  });
}

function collectLinkLikePair(
  tree: Tree,
  outerFrom: number,
  outerTo: number,
  kind: 'link' | 'image',
  out: MarkdownDecoratorPair[]
): void {
  const marks: { from: number; to: number }[] = [];
  tree.iterate({
    from: outerFrom,
    to: outerTo,
    enter: (node) => {
      if (node.from < outerFrom || node.to > outerTo) {
        return;
      }
      if (node.type.name === 'LinkMark') {
        marks.push({ from: node.from, to: node.to });
      }
    },
  });
  if (marks.length < 2) {
    return;
  }
  marks.sort((a, b) => a.from - b.from);
  const open = marks[0];
  const closeBracket = marks[1];
  const openParen = marks[marks.length - 2];
  const closeParen = marks[marks.length - 1];
  out.push({
    kind,
    outerFrom,
    outerTo,
    innerFrom: open.to,
    innerTo: closeBracket.from,
    leftMarkFrom: open.from,
    leftMarkTo: open.to,
    rightMarkFrom: openParen.from,
    rightMarkTo: closeParen.to,
  });
}

function collectPairsFromTree(doc: Text, tree: Tree): MarkdownDecoratorPair[] {
  const out: MarkdownDecoratorPair[] = [];
  tree.iterate({
    from: 0,
    to: doc.length,
    enter: (node) => {
      const n = node.type.name;
      if (n === 'StrongEmphasis') {
        pushEmphasisLikePair(tree, node.from, node.to, 'EmphasisMark', 'strong', out);
        return;
      }
      if (n === 'Emphasis') {
        pushEmphasisLikePair(tree, node.from, node.to, 'EmphasisMark', 'emphasis', out);
        return;
      }
      if (n === 'Strikethrough') {
        pushEmphasisLikePair(tree, node.from, node.to, 'StrikethroughMark', 'strikethrough', out);
        return;
      }
      if (n === 'InlineCode') {
        pushEmphasisLikePair(tree, node.from, node.to, 'CodeMark', 'inlineCode', out);
        return;
      }
      if (n === 'Link') {
        collectLinkLikePair(tree, node.from, node.to, 'link', out);
        return;
      }
      if (n === 'Image') {
        collectLinkLikePair(tree, node.from, node.to, 'image', out);
      }
    },
  });
  return out;
}

/** Collect inline / link decorator pairs for cleanup and toggle logic. */
export function collectMarkdownDecoratorPairs(state: EditorState): MarkdownDecoratorPair[] {
  const { doc } = state;
  return collectPairsFromTree(doc, syntaxTree(state) as Tree);
}

function sliceTrimmed(doc: Text, from: number, to: number): string {
  return doc.sliceString(from, to).trim();
}

export interface MarkdownLineMarkCleanup {
  from: number;
  to: number;
}

function collectEmptyLineMarkCleanupsFromTree(doc: Text, tree: Tree): MarkdownLineMarkCleanup[] {
  const out: MarkdownLineMarkCleanup[] = [];
  tree.iterate({
    from: 0,
    to: doc.length,
    enter: (node) => {
      const n = node.type.name;
      if (n === 'ATXHeading1' || n === 'ATXHeading2' || n === 'ATXHeading3' || n === 'ATXHeading4' || n === 'ATXHeading5' || n === 'ATXHeading6') {
        let headerMarkTo = -1;
        tree.iterate({
          from: node.from,
          to: node.to,
          enter: (inner) => {
            if (inner.type.name === 'HeaderMark') {
              headerMarkTo = markRangeEndInDoc(doc, 'HeaderMark', inner.from, inner.to);
            }
          },
        });
        if (headerMarkTo >= 0 && sliceTrimmed(doc, headerMarkTo, node.to) === '') {
          out.push({ from: node.from, to: node.to });
        }
        return;
      }
      if (n === 'Blockquote') {
        let qTo = -1;
        tree.iterate({
          from: node.from,
          to: node.to,
          enter: (inner) => {
            if (inner.type.name === 'QuoteMark') {
              qTo = inner.to;
            }
          },
        });
        if (qTo >= 0 && sliceTrimmed(doc, qTo, node.to) === '') {
          out.push({ from: node.from, to: node.to });
        }
        return;
      }
      if (n === 'ListItem') {
        let mTo = -1;
        tree.iterate({
          from: node.from,
          to: node.to,
          enter: (inner) => {
            if (inner.type.name === 'ListMark') {
              mTo = inner.to;
            }
          },
        });
        if (mTo >= 0 && sliceTrimmed(doc, mTo, node.to) === '') {
          out.push({ from: node.from, to: node.to });
        }
      }
    },
  });
  return out;
}

/** Ranges to delete for empty headings / blockquotes / list items (body empty). */
export function collectEmptyLineMarkCleanups(state: EditorState): MarkdownLineMarkCleanup[] {
  return collectEmptyLineMarkCleanupsFromTree(state.doc, syntaxTree(state) as Tree);
}

function collectEmptyPairCleanups(doc: Text, tree: Tree): MarkdownLineMarkCleanup[] {
  const out: MarkdownLineMarkCleanup[] = [];
  for (const p of collectPairsFromTree(doc, tree)) {
    if (sliceTrimmed(doc, p.innerFrom, p.innerTo) === '') {
      out.push({ from: p.outerFrom, to: p.outerTo });
    }
  }
  return out;
}

function mergeCleanups(ranges: MarkdownLineMarkCleanup[]): MarkdownLineMarkCleanup[] {
  if (ranges.length === 0) {
    return [];
  }
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: MarkdownLineMarkCleanup[] = [];
  let cur = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n.from <= cur.to) {
      cur = { from: cur.from, to: Math.max(cur.to, n.to) };
    } else {
      merged.push(cur);
      cur = n;
    }
  }
  merged.push(cur);
  return merged;
}

function shouldRunCleanupOnTransaction(tr: Transaction): boolean {
  const u = tr.annotation(Transaction.userEvent);
  if (!u || u === 'format.cleanup') {
    return false;
  }
  if (u === 'undo' || u === 'redo' || u === 'remote') {
    return false;
  }
  if (u.startsWith('select.')) {
    return false;
  }
  return u.startsWith('delete.');
}

function posStrictlyInsideDecorMark(state: EditorState, pos: number): boolean {
  let hit = false;
  forEachMarkdownDecorMarkInRanges(state, [{ from: 0, to: state.doc.length }], (from, to) => {
    if (pos > from && pos < to) {
      hit = true;
    }
  });
  return hit;
}

class AtomicDecorSpan extends RangeValue {
  static readonly value = new AtomicDecorSpan();

  private constructor() {
    super();
  }

  eq(other: RangeValue): boolean {
    return other instanceof AtomicDecorSpan;
  }
}

function buildAtomicRangeSet(state: EditorState): RangeSet<AtomicDecorSpan> {
  const ranges: Range<AtomicDecorSpan>[] = [];
  forEachMarkdownDecorMarkInRanges(state, [{ from: 0, to: state.doc.length }], (from, to) => {
    ranges.push(AtomicDecorSpan.value.range(from, to));
  });
  return ranges.length === 0 ? RangeSet.empty : RangeSet.of(ranges, true);
}

const decoratorAtomicRangeField = StateField.define<RangeSet<AtomicDecorSpan>>({
  create: (state) => buildAtomicRangeSet(state),
  update(value, tr) {
    if (!tr.docChanged) {
      return value;
    }
    return buildAtomicRangeSet(tr.state);
  },
});

const blockInsertInsideMarkFilter = EditorState.changeFilter.of((tr) => {
  if (!tr.docChanged) {
    return true;
  }
  const u = tr.annotation(Transaction.userEvent);
  if (u === 'undo' || u === 'redo' || u === 'format.cleanup' || u === 'remote') {
    return true;
  }
  let ok = true;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (inserted.length > 0 && fromA === toA && posStrictlyInsideDecorMark(tr.startState, fromA)) {
      ok = false;
    }
  });
  return ok;
});

const mergeEmptyDecorCleanupFilterInner = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !shouldRunCleanupOnTransaction(tr)) {
    return tr;
  }
  const newDoc = tr.changes.apply(tr.startState.doc);
  const tree = markdownLanguage.parser.parse(newDoc.sliceString(0));
  const pairClean = collectEmptyPairCleanups(newDoc, tree);
  const lineClean = collectEmptyLineMarkCleanupsFromTree(newDoc, tree);
  const merged = mergeCleanups([...pairClean, ...lineClean]);
  if (merged.length === 0) {
    return tr;
  }
  const cleanup = ChangeSet.of(
    merged.map((r) => ({ from: r.from, to: r.to, insert: '' })),
    newDoc.length
  );
  const combined = tr.changes.compose(cleanup);
  const selection = tr.startState.selection.map(combined);
  const userEvent = tr.annotation(Transaction.userEvent);
  return {
    changes: combined,
    selection,
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
    ...(userEvent !== undefined ? { annotations: [Transaction.userEvent.of(userEvent)] } : {}),
  };
});

export const mergeEmptyMarkdownDecorCleanupFilter = Prec.high(mergeEmptyDecorCleanupFilterInner);

/**
 * If the main selection is inside an inline pair of `kind`, remove delimiter marks.
 * @returns true when a strip was applied.
 */
export function tryStripMarkdownDecoratorPair(
  view: EditorView,
  kind: Extract<MarkdownDecoratorPairKind, 'strong' | 'emphasis' | 'strikethrough'>
): boolean {
  const state = view.state;
  const main = state.selection.main;
  const pairs = collectMarkdownDecoratorPairs(state).filter((p) => p.kind === kind);
  for (const p of pairs) {
    const anchorInsideInner =
      main.anchor >= p.innerFrom &&
      main.anchor <= p.innerTo &&
      main.head >= p.innerFrom &&
      main.head <= p.innerTo;
    const coversOuter = main.from <= p.outerFrom && main.to >= p.outerTo;
    if (!anchorInsideInner && !coversOuter) {
      continue;
    }
    view.dispatch({
      changes: [
        { from: p.rightMarkFrom, to: p.rightMarkTo, insert: '' },
        { from: p.leftMarkFrom, to: p.leftMarkTo, insert: '' },
      ],
      selection: EditorSelection.cursor(p.leftMarkFrom),
      scrollIntoView: true,
      userEvent: 'format.toggle',
    });
    view.focus();
    return true;
  }
  return false;
}

export const markdownDecoratorAtomics: Extension = [
  decoratorAtomicRangeField,
  EditorView.atomicRanges.of((view) => view.state.field(decoratorAtomicRangeField)),
  blockInsertInsideMarkFilter,
  mergeEmptyMarkdownDecorCleanupFilter,
];
