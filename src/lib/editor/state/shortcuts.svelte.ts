import { SvelteMap } from 'svelte/reactivity';

import { Observable } from '$lib/utils/observable';

export class ShortcutService extends Observable<string> {
	shortcutsToCommands = new SvelteMap<string, string>();
	commandsToShortcuts = new SvelteMap<string, string>();

	#standardize(cmd: string[]): string {
		const output: string[] = [];
		const cmdKeyIndex = cmd.findIndex((key) => key.toLowerCase() === 'ctrl');
		if (cmdKeyIndex !== -1) {
			cmd.splice(cmdKeyIndex, 1);
			output.push('ctrl');
		}

		const metaKeyIndex = cmd.findIndex((key) => key.toLowerCase() === 'meta');
		if (metaKeyIndex !== -1) {
			output.push('meta');
			cmd.splice(metaKeyIndex, 1);
		}

		const shiftKeyIndex = cmd.findIndex((key) => key.toLowerCase() === 'shift');
		if (shiftKeyIndex !== -1) {
			output.push('shift');
			cmd.splice(shiftKeyIndex, 1);
		}

		const altKeyIndex = cmd.findIndex((key) => key.toLowerCase() === 'alt');
		if (altKeyIndex !== -1) {
			output.push('alt');
			cmd.splice(altKeyIndex, 1);
		}

		const finalKey = cmd.at(0);
		if (finalKey) {
			output.push(finalKey.toLocaleLowerCase());
		}

		return output.join('+');
	}

	parse(cmd: Set<string> | string[] | string): string {
		if (typeof cmd === 'string') {
			const arr = cmd.split('+');
			return this.#standardize(arr);
		} else if (Array.isArray(cmd)) {
			return this.#standardize(cmd);
		} else {
			const arr = [...cmd];
			return this.#standardize(arr);
		}
	}

	#hasCtrlMetaOrAltKeys(cmd: string): boolean {
		return cmd.includes('ctrl') || cmd.includes('meta') || cmd.includes('alt');
	}

	addCommand(name: string) {
		if (!this.commandsToShortcuts.has(name)) {
			this.commandsToShortcuts.set(name, '');
		}
		return this;
	}

	#getValue(map: Map<string, string>, needle: string): string | null {
		for (const [key, value] of map) {
			if (value === needle) {
				return key;
			}
		}
		return null;
	}

	unset(name: string) {
		if (!this.commandsToShortcuts.has(name)) {
			return false;
		}

		const cmd = this.#getValue(this.shortcutsToCommands, name);
		if (!cmd) {
			return false;
		}

		this.commandsToShortcuts.set(name, '');
		this.shortcutsToCommands.delete(cmd);
		return true;
	}

	removeShortcut(shortcut: Set<string> | string[] | string): boolean {
		const key = this.parse(shortcut);
		if (!this.shortcutsToCommands.has(key)) {
			return false;
		}

		const name = this.shortcutsToCommands.get(key) ?? this.#getValue(this.commandsToShortcuts, key);
		if (!name || !this.commandsToShortcuts.has(name)) {
			return false;
		}

		this.shortcutsToCommands.delete(key);
		this.commandsToShortcuts.set(name, '');

		return true;
	}

	register(name: string, shortcut: Set<string> | string[] | string): boolean {
		const key = this.parse(shortcut);
		if (!this.#hasCtrlMetaOrAltKeys(key)) {
			return false;
		}

		this.shortcutsToCommands.set(key, name);
		this.commandsToShortcuts.set(name, key);
		return true;
	}

	listen(e: KeyboardEvent) {
		const shortcut = [e.key];
		if (e.altKey) {
			shortcut.push('alt');
		}

		if (e.shiftKey) {
			shortcut.push('shift');
		}

		if (e.metaKey) {
			shortcut.push('meta');
		}

		if (e.ctrlKey) {
			shortcut.push('ctrl');
		}

		const key = this.#standardize(shortcut);
		if (!key) {
			return;
		}

		const cmd = this.shortcutsToCommands.get(key);
		if (cmd) {
			this.update(cmd);
		}
	}

	on(shortcuts: Record<string, () => void>): () => void {
		return this.subscribe((val) => shortcuts[val]?.());
	}
}

const Shortcuts = new ShortcutService();
export default Shortcuts;
