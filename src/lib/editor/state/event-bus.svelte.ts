import type { EditorView } from 'prosemirror-view';
import type { Transaction } from 'prosemirror-state';

import { Observable } from '$lib/utils/observable';

export enum ProseMirrorEventBusEventType {
	Init = 'EVENT_BUS_INIT',
	PreUpdate = 'EVENT_BUS_PRE_UPDATE',
	Update = 'EVENT_BUS_UPDATE',
	Paginate = 'EVENT_BUS_PAGINATE',
	SetActiveTab = 'EVENT_BUS_SET_ACTIVE_TAB',
}

type PaginationEvent = {
	type: ProseMirrorEventBusEventType.Paginate;
	paginatedTo: number;
};

type InitEvent = {
	type: ProseMirrorEventBusEventType.Init;
	view: EditorView;
};
type UpdateEvent = {
	type: ProseMirrorEventBusEventType.Update;
	view: EditorView;
};

type SetActiveTabEvent = {
	type: ProseMirrorEventBusEventType.SetActiveTab;
};

type PreUpdateEvent = {
	type: ProseMirrorEventBusEventType.PreUpdate;
	view: EditorView;
	tr: Transaction;
};

export type ProseMirrorEventBusEvent =
	| PaginationEvent
	| InitEvent
	| UpdateEvent
	| SetActiveTabEvent
	| PreUpdateEvent;

export class ProseMirrorEventBus extends Observable<{
	id: string;
	event: ProseMirrorEventBusEvent;
}> {}

const proseMirrorEventBus = new ProseMirrorEventBus();
export default proseMirrorEventBus;
