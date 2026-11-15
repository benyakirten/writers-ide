import type {
	FormattingCommand,
	FormattingRequest,
	FormattingService as FormattingServiceContract,
	FormattingSnapshot,
} from './contracts';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { untrack } from 'svelte';

import Editors from '$lib/editor/prosemirror/prose-mirror-editor.svelte';
import { ActionUtilities } from '$lib/editor/prosemirror/view/actions';
import { SelectionUtilities } from '$lib/editor/prosemirror/view/selection';
import proseMirrorEventBus, {
	ProseMirrorEventBusEventType,
} from '$lib/editor/state/event-bus.svelte';
import TabState from '$lib/editor/state/tab-state.svelte';
import PageLayout, { PeerSelection } from '$lib/editor/state/page-layout.svelte';
import { INDENT_MAX, INDENT_MIN } from '$lib/editor/prosemirror/view/constants';
import { clamp } from '$lib/utils/numbers';

/** Internal editor sources, not presentation props. Getters must track reactive registry changes. */
export interface FormattingSources {
	activeId(): string | null | undefined;
	getView(id: string): { view: EditorView } | null;
	subscribe(listener: () => void): () => void;
}

const defaultSources: FormattingSources = {
	activeId: () => {
		const documentId = TabState.active;
		return documentId ? Editors.get(documentId)?.viewId : undefined;
	},
	getView: (id) => Editors.getView(id),
	subscribe: (listener) =>
		proseMirrorEventBus.subscribe(({ event }) => {
			if (
				event.type === ProseMirrorEventBusEventType.Init ||
				event.type === ProseMirrorEventBusEventType.Update ||
				event.type === ProseMirrorEventBusEventType.SetActiveTab
			) {
				listener();
			}
		}),
};

const marks = [
	'bold',
	'italic',
	'superscript',
	'subscript',
	'underline',
	'overline',
	'strikethrough',
] as const;
const blocks = [
	'indent',
	'dedent',
	'align-left',
	'align-center',
	'align-right',
	'align-justify',
] as const;
const commands: readonly string[] = [...marks, ...blocks];

type Current = { viewId: string; view: EditorView; state: EditorState; editable: boolean };

function run(command: FormattingCommand, current: Current, dispatch: (tr: Transaction) => void) {
	const { state, view } = current;
	switch (command) {
		case 'indent':
		case 'dedent':
			return ActionUtilities.dent(command, state, dispatch);
		case 'align-left':
			return ActionUtilities.setTextAlignment('left', state, dispatch);
		case 'align-center':
			return ActionUtilities.setTextAlignment('center', state, dispatch);
		case 'align-right':
			return ActionUtilities.setTextAlignment('right', state, dispatch);
		case 'align-justify':
			return ActionUtilities.setTextAlignment('justify', state, dispatch);
		default: {
			if (!state.schema.marks[command]) {
				return false;
			}
			const exclusive =
				command === 'superscript'
					? 'subscript'
					: command === 'subscript'
						? 'superscript'
						: undefined;
			return ActionUtilities.toggleTextMark(command, state, dispatch, view, exclusive);
		}
	}
}

function availability(current: Current): FormattingSnapshot['enabled'] {
	const result = Object.fromEntries(
		commands.map((command) => [command, false]),
	) as FormattingSnapshot['enabled'];
	if (!current.editable) {
		return result;
	}

	const { state } = current;
	const { selection, doc } = state;
	if (!selection.empty) {
		// One read-only text pass for all marks, including schema-specific mark restrictions.
		doc.nodesBetween(selection.from, selection.to, (node, _pos, parent) => {
			if (!node.isText || !parent) {
				return;
			}
			for (const mark of marks) {
				const type = state.schema.marks[mark];
				if (type && parent.type.allowsMarkType(type)) {
					result[mark] = true;
				}
			}
		});
	}

	// Match ActionUtilities: indentation changes only a peer group's head, whereas
	// alignment changes both halves and resets their indentation.
	for (const group of PageLayout.groupPeerParagraphs(state)) {
		const head = group.type === PeerSelection.Peered ? group.head.node : group.details.node;
		if (head.type.name === 'paragraph') {
			const indent = head.attrs.indent;
			result.indent ||= clamp((indent || INDENT_MIN) + 1, INDENT_MIN, INDENT_MAX) !== indent;
			result.dedent ||= clamp((indent || 0) - 1, INDENT_MIN, INDENT_MAX) !== indent;
		}
		const nodes = group.type === PeerSelection.Peered ? [head, group.peer.node] : [head];
		for (const node of nodes) {
			if (node.type.name !== 'paragraph') {
				continue;
			}
			for (const alignment of ['left', 'center', 'right', 'justify'] as const) {
				result[`align-${alignment}`] ||=
					node.attrs.align !== alignment || node.attrs.indent !== INDENT_MIN;
			}
		}
	}
	return result;
}

function snapshot(current: Current, revision: number): FormattingSnapshot {
	const { selection, doc } = current.state;
	const presence = SelectionUtilities.findTextMarks(selection, doc);
	const indent = SelectionUtilities.getIndentRatio(selection, doc);
	const alignment = (value: string | ((value: string) => boolean)) =>
		SelectionUtilities.getBlockAttributeRatio(
			selection,
			doc,
			'align',
			typeof value === 'string' ? (attribute) => attribute === value : value,
		);
	return {
		viewId: current.viewId,
		revision,
		marks: Object.fromEntries(
			marks.map((mark) => [mark, presence.get(mark) ?? 0]),
		) as FormattingSnapshot['marks'],
		blocks: {
			indent: indent ?? 0,
			dedent: indent === null ? 0 : 1 - indent,
			'align-left': alignment((value) => value === 'left' || value === 'start'),
			'align-center': alignment('center'),
			'align-right': alignment((value) => value === 'right' || value === 'end'),
			'align-justify': alignment('justify'),
		},
		enabled: availability(current),
	};
}

function copy(value: FormattingSnapshot | null): FormattingSnapshot | null {
	return (
		value && {
			...value,
			marks: { ...value.marks },
			blocks: { ...value.blocks },
			enabled: { ...value.enabled },
		}
	);
}

/** Lazy feature bridge. Only transferable summaries and validated requests cross its boundary. */
export class FormattingService implements FormattingServiceContract {
	private listeners = new Set<(snapshot: FormattingSnapshot | null) => void>();
	private cleanup: (() => void) | undefined;
	private current: Current | null = null;
	private value: FormattingSnapshot | null = null;
	private revision = 0;

	constructor(private readonly sources: FormattingSources = defaultSources) {}

	private read(): Current | null {
		const viewId = this.sources.activeId();
		const view = viewId ? this.sources.getView(viewId)?.view : null;
		return viewId && view && !view.isDestroyed
			? { viewId, view, state: view.state, editable: view.editable }
			: null;
	}

	private refresh(): void {
		const next = this.read();
		if (
			next?.viewId === this.current?.viewId &&
			next?.view === this.current?.view &&
			next?.state === this.current?.state &&
			next?.editable === this.current?.editable
		) {
			return;
		}
		this.current = next;
		this.revision++;
		this.value = next ? snapshot(next, this.revision) : null;
		for (const listener of [...this.listeners]) {
			if (this.listeners.has(listener)) {
				try {
					listener(copy(this.value));
				} catch (error) {
					// Plugin notification failures must not escape a ProseMirror update.
					console.error('Formatting subscriber failed', error);
				}
			}
		}
	}

	subscribe(listener: (snapshot: FormattingSnapshot | null) => void): () => void {
		if (!this.cleanup) {
			this.cleanup = $effect.root(() => {
				const unsubscribe = this.sources.subscribe(() => untrack(() => this.refresh()));
				$effect(() => {
					const id = this.sources.activeId();
					if (id) {
						this.sources.getView(id);
					}
					untrack(() => this.refresh());
				});
				return unsubscribe;
			});
		}
		untrack(() => this.refresh());
		// Each subscription has its own identity, even when the callback is reused.
		const deliver = (value: FormattingSnapshot | null) => listener(value);
		this.listeners.add(deliver);
		try {
			deliver(copy(this.value));
		} catch (error) {
			this.listeners.delete(deliver);
			this.stopIfUnused();
			throw error;
		}
		return () => {
			this.listeners.delete(deliver);
			this.stopIfUnused();
		};
	}

	private stopIfUnused(): void {
		if (this.listeners.size === 0) {
			this.cleanup?.();
			this.cleanup = undefined;
			this.current = null;
			this.value = null;
			// Keep the counter across stop/start so a re-enabled consumer cannot replay a token.
		}
	}

	execute(request: FormattingRequest): boolean {
		if (!request || !commands.includes(request.command) || !this.value || !this.current) {
			return false;
		}
		const live = this.read();
		if (
			!live ||
			request.viewId !== this.value.viewId ||
			request.revision !== this.value.revision ||
			live.viewId !== this.current.viewId ||
			live.view !== this.current.view ||
			live.state !== this.current.state ||
			live.editable !== this.current.editable ||
			!this.value.enabled[request.command]
		) {
			return false;
		}
		const result = run(request.command, live, (tr) => live.view.dispatch(tr));
		if (result && !live.view.isDestroyed) {
			live.view.focus();
		}
		this.refresh();
		return result;
	}
}

export const Formatting = new FormattingService();
export default Formatting;
