import Shortcuts from '@/editor/state/shortcuts.svelte';
import { type Command, Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export function createShortcuts(bindings: { [key: string]: Command }): Plugin {
	return new Plugin({ props: { handleKeyDown: keydownHandler(bindings) } });
}

export function keydownHandler(bindings: {
	[key: string]: Command;
}): (view: EditorView, event: KeyboardEvent) => boolean {
	return (view, event) => {
		const command = Shortcuts.get(event);
		if (!command) {
			return false;
		}

		const binding = bindings[command];
		if (!binding) {
			return false;
		}

		return binding(view.state, view.dispatch, view);
	};
}
