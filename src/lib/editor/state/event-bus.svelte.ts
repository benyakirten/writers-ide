import type { EditorView } from 'prosemirror-view';

import { Observable } from '$lib/utils/observable';

export class ProseMirrorEventBus extends Observable<{ id: string; view: EditorView }> {}

const proseMirrorEventBus = new ProseMirrorEventBus();
export default proseMirrorEventBus;
