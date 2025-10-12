import type { EditorView } from 'prosemirror-view';

import { Observable } from '$lib/utils/observable';

export enum ProseMirrorEventBusEventType {
	Init = 'EVENT_BUS_INIT',
	Update = 'EVENT_BUS_UPDATE',
	Paginate = 'EVENT_BUS_PAGINATE',
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

export type ProseMirrorEventBusEvent = PaginationEvent | InitEvent | UpdateEvent;

export class ProseMirrorEventBus extends Observable<{
	id: string;
	event: ProseMirrorEventBusEvent;
}> {}

const proseMirrorEventBus = new ProseMirrorEventBus();
export default proseMirrorEventBus;
