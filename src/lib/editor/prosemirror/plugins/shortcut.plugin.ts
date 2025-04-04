import Shortcuts from '@/editor/state/shortcuts.svelte';
import { type Command, Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export function keymap(commands: { [key: string]: Command }): Plugin {
	return new Plugin({ props: { handleKeyDown: keydownHandler(commands) } });
}

export function keydownHandler(commands: {
	[key: string]: Command;
}): (view: EditorView, event: KeyboardEvent) => boolean {
	return (_view, event) => {
		const command = Shortcuts.get(event);
		return !!command && command in commands;
	};
}
