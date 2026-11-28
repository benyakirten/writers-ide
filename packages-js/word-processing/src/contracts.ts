import type { Dispose } from '@writers-ide/plugins';
import type { Command, EditorState, Plugin, Transaction } from 'prosemirror-state';
import type { EditorView, NodeViewConstructor, MarkViewConstructor } from 'prosemirror-view';

export type { Dispose } from '@writers-ide/plugins';

export interface WordProcessingSources {
	listViews(): readonly {
		viewId: string;
		documentId: string;
		name: string;
		view: EditorView;
	}[];
	activeViewId(): string | null | undefined;
	subscribe(listener: () => void): Dispose;
	reportBehaviorError?(failure: EditorBehaviorFailure): void;
	invalidateLayout?(viewId: string): void;
	/** Prepare managed appended transactions for host model invariants before application. Must be synchronous. */
	prepareTransaction?(transaction: Transaction): Transaction;
}

export type EditorBehaviorFailure = {
	ownerId: string;
	id: string;
	viewId?: string;
	phase: string;
	error: unknown;
};

export type EditorBehaviorContext = {
	readonly viewId: string;
	readonly documentId: string;
	readonly name: string;
	readonly state: EditorState;
	readonly view: EditorView;
	readonly signal: AbortSignal;
};

export type EditorBehaviorRegistration = {
	id: string;
	name: string;
	priority?: number;
	views?: readonly string[];
	create(context: EditorBehaviorContext): Plugin | readonly Plugin[];
};

export type EditorRendererContext = EditorBehaviorContext & {
	reportError(error: unknown): void;
};

export type EditorNodeViewRegistration = {
	id: string;
	name: string;
	nodeType: string;
	views?: readonly string[];
	create(context: EditorRendererContext): NodeViewConstructor;
};

export type EditorMarkViewRegistration = {
	id: string;
	name: string;
	markType: string;
	views?: readonly string[];
	create(context: EditorRendererContext): MarkViewConstructor;
};

export type EditorBehaviorSnapshot = {
	readonly id: string;
	readonly name: string;
	readonly ownerId: string;
	readonly priority: number;
	readonly views?: readonly string[];
	readonly status: 'active' | 'failed';
	readonly error?: string;
};

export type EditorTarget = {
	readonly viewId: string;
	readonly documentId: string;
	readonly revision: number;
};

export type EditorSnapshot = EditorTarget & {
	readonly name: string;
	readonly editable: boolean;
};

export type WordProcessingSnapshot = {
	readonly activeViewId: string | null;
	readonly views: readonly EditorSnapshot[];
};

/** Trusted live objects for this synchronous callback only. Do not retain them. */
export type EditorContext = EditorSnapshot & {
	readonly state: EditorState;
	readonly view: EditorView;
};

export type EditorFailureReason =
	| 'unavailable'
	| 'stale'
	| 'readonly'
	| 'cancelled'
	| 'revoked'
	| 'unknown-command'
	| 'busy';

export type EditorResult<T> = { ok: true; value: T } | { ok: false; reason: EditorFailureReason };

export type EditorReadOptions = {
	readonly signal?: AbortSignal;
	readonly requireActive?: boolean;
};

export type EditorEditOptions = EditorReadOptions & {
	readonly focus?: boolean;
};

export type EditorCommandRegistration = {
	readonly id: string;
	readonly name: string;
	readonly command: Command;
};

export type EditorCommandSnapshot = {
	readonly id: string;
	readonly name: string;
	readonly ownerId: string;
};

export interface WordProcessingApi {
	snapshot(): WordProcessingSnapshot;
	subscribe(listener: (snapshot: WordProcessingSnapshot) => void): Dispose;
	inspect<T>(
		target: EditorTarget,
		read: (current: EditorContext) => T,
		options?: EditorReadOptions,
	): EditorResult<T>;
	edit(
		target: EditorTarget,
		build: (current: EditorContext) => Transaction | null,
		options?: EditorEditOptions,
	): EditorResult<boolean>;
	runCommand(
		target: EditorTarget,
		command: Command,
		options?: EditorEditOptions,
	): EditorResult<boolean>;
	registerNodeView(registration: EditorNodeViewRegistration): Dispose;
	registerMarkView(registration: EditorMarkViewRegistration): Dispose;
	registerBehavior(registration: EditorBehaviorRegistration): Dispose;
	behaviors(): readonly EditorBehaviorSnapshot[];
	subscribeBehaviors(listener: (snapshot: readonly EditorBehaviorSnapshot[]) => void): Dispose;
	registerCommand(registration: EditorCommandRegistration): Dispose;
	executeCommand(
		target: EditorTarget,
		id: string,
		options?: EditorEditOptions,
	): EditorResult<boolean>;
	commands(): readonly EditorCommandSnapshot[];
	applyResult<T>(
		target: EditorTarget,
		result: T,
		apply: (result: T, current: EditorContext) => Transaction | null,
		options?: EditorEditOptions,
	): EditorResult<boolean>;
}

export interface WordProcessingService extends WordProcessingApi {
	dispose(): void;
}
