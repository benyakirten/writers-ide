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
		const commands = Shortcuts.get(event);
		if (!commands) {
			return false;
		}

		let anyCommand = false;
		for (const command of commands) {
			const binding = bindings[command];
			if (!anyCommand && typeof binding === 'function') {
				anyCommand = true;
			}

			binding(view.state, view.dispatch, view);
		}

		return anyCommand;
	};
}
