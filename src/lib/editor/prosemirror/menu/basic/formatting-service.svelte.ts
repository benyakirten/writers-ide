import type {
	FormattingCommand,
	FormattingRequest,
	FormattingService as FormattingServiceContract,
	FormattingSnapshot,
} from './contracts';
import type { Command } from 'prosemirror-state';
import type {
	EditorContext,
	EditorSnapshot,
	WordProcessingApi,
} from '@writers-ide/word-processing';
import { untrack } from 'svelte';

import { ActionUtilities } from '$lib/editor/prosemirror/view/actions';
import { SelectionUtilities } from '$lib/editor/prosemirror/view/selection';
import PageLayout, { PeerSelection } from '$lib/editor/state/page-layout.svelte';
import { INDENT_MAX, INDENT_MIN } from '$lib/editor/prosemirror/view/constants';
import { clamp } from '$lib/utils/numbers';

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

function run(command: FormattingCommand): Command {
	return (state, dispatch, view) => {
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
	};
}

function availability(current: EditorContext): FormattingSnapshot['enabled'] {
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

function snapshot(current: EditorContext, revision: number): FormattingSnapshot {
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
	private current: EditorSnapshot | null = null;
	private value: FormattingSnapshot | null = null;
	private revision = 0;

	constructor(private readonly api: WordProcessingApi) {}

	private read(): EditorSnapshot | null {
		const current = this.api.snapshot();
		return current.views.find((view) => view.viewId === current.activeViewId) ?? null;
	}

	private refresh(): void {
		const next = this.read();
		if (
			next?.viewId === this.current?.viewId &&
			next?.documentId === this.current?.documentId &&
			next?.revision === this.current?.revision
		) {
			return;
		}
		this.current = next;
		this.revision++;
		const result = next
			? this.api.inspect(next, (current) => snapshot(current, this.revision), {
					requireActive: true,
				})
			: null;
		this.value = result?.ok ? result.value : null;
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
			this.cleanup = this.api.subscribe(() => untrack(() => this.refresh()));
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
			live.documentId !== this.current.documentId ||
			live.revision !== this.current.revision ||
			!this.value.enabled[request.command]
		) {
			return false;
		}
		const result = this.api.runCommand(live, run(request.command), {
			requireActive: true,
			focus: true,
		});
		this.refresh();
		return result.ok && result.value;
	}
}
