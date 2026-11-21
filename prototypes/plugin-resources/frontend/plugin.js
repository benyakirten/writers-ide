import { mount, unmount, tick } from 'svelte';
import { Schema, Node } from 'prosemirror-model';
import { EditorState, Transaction, Plugin } from 'prosemirror-state';
import { Transform } from 'prosemirror-transform';
import Counter from './Counter.svelte';
import { childUrl, childValue } from './child.js';

const moduleUrl = import.meta.url;
globalThis.__RESOURCE_FIXTURE_EVALUATIONS__ =
	(globalThis.__RESOURCE_FIXTURE_EVALUATIONS__ ?? 0) + 1;
export const identity = {};
export const urls = {
	module: moduleUrl,
	child: childUrl,
	icon: new URL('./icon.svg', moduleUrl).href,
	worker: new URL('./worker.js', moduleUrl).href,
};
export const runtime = {
	mount,
	unmount,
	tick,
	Schema,
	Node,
	EditorState,
	Transaction,
	Plugin,
	Transform,
};
export { Counter, childValue };
export function makeTransaction() {
	const schema = new Schema({
		nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} },
	});
	return EditorState.create({ schema }).tr.insertText('fixture');
}
export function failActivation() {
	throw new Error('Expected fixture activation failure');
}
