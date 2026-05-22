import { Annotation, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';

type PresenceRecord = {
  clientId: string;
  color: string;
  label: string;
  from: number;
  to: number;
  updatedAt: number;
};

type PresenceState = Record<string, PresenceRecord>;

const applyRemoteDoc = Annotation.define<boolean>();
const setPresenceEffect = StateEffect.define<PresenceState>();

const presenceField = StateField.define<PresenceState>({
  create: () => ({}),
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setPresenceEffect)) {
        next = effect.value;
      }
    }
    return next;
  },
});

const presenceDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_value, tr) {
    const peers = tr.state.field(presenceField);
    const ranges = Object.values(peers)
      .filter((peer) => Date.now() - peer.updatedAt < 6_000)
      .flatMap((peer) => {
        const selection = peer.from !== peer.to ? [Decoration.mark({ class: 'cm-remote-selection', attributes: { style: `--peer-color:${peer.color}` } }).range(peer.from, peer.to)] : [];
        const cursor = Decoration.widget({
          side: 1,
          widget: new (class extends WidgetType {
            toDOM(): HTMLElement {
              const el = document.createElement('span');
              el.className = 'cm-remote-cursor';
              el.style.setProperty('--peer-color', peer.color);
              el.setAttribute('data-peer-label', peer.label);
              return el;
            }
          })(),
        }).range(peer.to);
        return [...selection, cursor];
      });
    return Decoration.set(ranges, true);
  },
  provide: (f) => EditorView.decorations.from(f),
});

type CollabMessage =
  | { type: 'doc'; clientId: string; revision: number; doc: string }
  | {
      type: 'presence';
      clientId: string;
      from: number;
      to: number;
      label: string;
      color: string;
      updatedAt: number;
    };

function randomColor(clientId: string): string {
  const palette = ['#d3869b', '#8ec07c', '#83a598', '#fabd2f', '#b8bb26', '#fe8019'];
  const hash = [...clientId].reduce((acc, curr) => acc + curr.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

export function collabBroadcastExtension(docId: string): Extension {
  const clientId = `client_${Math.random().toString(36).slice(2, 9)}`;
  const channel =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`gruvbox-editor:${docId}`) : null;
  let revision = 0;
  const label = 'peer';
  const color = randomColor(clientId);

  const syncPlugin = ViewPlugin.fromClass(
    class {
      constructor(private readonly view: EditorView) {
        if (!channel) {
          return;
        }
        channel.onmessage = (event: MessageEvent<CollabMessage>) => {
          const message = event.data;
          if (!message || message.clientId === clientId) {
            return;
          }
          if (message.type === 'doc') {
            const current = this.view.state.doc.toString();
            if (current === message.doc) {
              return;
            }
            this.view.dispatch({
              changes: { from: 0, to: current.length, insert: message.doc },
              annotations: applyRemoteDoc.of(true),
            });
            return;
          }
          const presence = this.view.state.field(presenceField);
          this.view.dispatch({
            effects: setPresenceEffect.of({
              ...presence,
              [message.clientId]: {
                clientId: message.clientId,
                color: message.color,
                label: message.label,
                from: message.from,
                to: message.to,
                updatedAt: message.updatedAt,
              },
            }),
          });
        };
      }

      update(update: ViewUpdate): void {
        if (!channel) {
          return;
        }
        if (update.docChanged && !update.transactions.some((tr) => tr.annotation(applyRemoteDoc))) {
          revision += 1;
          channel.postMessage({
            type: 'doc',
            clientId,
            revision,
            doc: update.state.doc.toString(),
          } satisfies CollabMessage);
        }
        if (update.selectionSet || update.docChanged) {
          const main = update.state.selection.main;
          channel.postMessage({
            type: 'presence',
            clientId,
            from: main.from,
            to: main.to,
            label,
            color,
            updatedAt: Date.now(),
          } satisfies CollabMessage);
        }
      }

      destroy(): void {
        if (!channel) {
          return;
        }
        channel.close();
      }
    }
  );

  return [
    presenceField,
    presenceDecorations,
    EditorView.theme({
      '.cm-remote-selection': {
        backgroundColor: 'color-mix(in srgb, var(--peer-color) 24%, transparent)',
      },
      '.cm-remote-cursor': {
        borderLeft: '2px solid var(--peer-color)',
        marginLeft: '-1px',
        display: 'inline-block',
        height: '1.1em',
        verticalAlign: 'text-top',
      },
      '.cm-remote-cursor::after': {
        content: 'attr(data-peer-label)',
        position: 'absolute',
        transform: 'translate(2px, -1.1rem)',
        fontSize: '10px',
        color: 'var(--peer-color)',
      },
    }),
    syncPlugin,
  ];
}
