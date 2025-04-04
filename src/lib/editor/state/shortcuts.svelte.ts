import { SvelteMap } from 'svelte/reactivity';

import { Observable } from '$lib/utils/observable';

export class ShortcutService extends Observable<string> {
	shortcutsToCommands = new SvelteMap<string, string>();
	commandsToShortcuts = new SvelteMap<string, string>();
	SEPARATOR = '-';

	#standardize(cmd: string[]): string {
		const output: string[] = [];
		const metaKeyIndex = cmd.findIndex((key) => key.toLowerCase() === 'meta');
		if (metaKeyIndex !== -1) {
			output.push('meta');
		}

		const altKeyIndex = cmd.findIndex((key) => key.toLowerCase() === 'alt');
		if (altKeyIndex !== -1) {
			output.push('alt');
		}

		const cmdKeyIndex = cmd.findIndex((key) => key.toLowerCase() === 'ctrl');
		if (cmdKeyIndex !== -1) {
			output.push('ctrl');
		}

		const shiftKeyIndex = cmd.findIndex((key) => key.toLowerCase() === 'shift');
		if (shiftKeyIndex !== -1) {
			output.push('shift');
		}

		const finalKey = cmd.find(
			(key) => key !== 'ctrl' && key !== 'meta' && key !== 'alt' && key !== 'shift'
		);

		if (finalKey) {
			output.push(finalKey.toLocaleLowerCase());
		}

		const set = new Set<string>(output);
		return [...set].join(this.SEPARATOR);
	}

	split(str: string): string[] {
		let currentShortcutPart = '';
		const output: string[] = [];
		for (const char of str) {
			if (char === this.SEPARATOR && currentShortcutPart) {
				output.push(currentShortcutPart.toLocaleLowerCase());
				currentShortcutPart = '';
			} else {
				currentShortcutPart += char;
			}
		}

		output.push(currentShortcutPart.toLocaleLowerCase());
		return output;
	}

	parse(cmd: Set<string> | string[] | string): string {
		if (typeof cmd === 'string') {
			const arr = this.split(cmd);
			return this.#standardize(arr);
		} else if (Array.isArray(cmd)) {
			return this.#standardize(cmd);
		} else {
			return this.#standardize([...cmd]);
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

	/** Return a shortcut from a key event. */
	process(e: KeyboardEvent): string {
		const shortcut = [e.key];
		if (e.shiftKey) {
			shortcut.push('shift');
		}

		if (e.ctrlKey) {
			shortcut.push('ctrl');
		}

		if (e.altKey) {
			shortcut.push('alt');
		}

		if (e.metaKey) {
			shortcut.push('meta');
		}

		return this.#standardize(shortcut);
	}

	listen(e: KeyboardEvent): void {
		const key = this.process(e);
		const cmd = this.shortcutsToCommands.get(key);
		if (cmd) {
			this.update(cmd);
		}
	}

	on(shortcuts: Record<string, () => void>): () => void {
		return this.subscribe((val) => shortcuts[val]?.());
	}

	add(shortcuts: Record<string, string>) {
		for (const [key, value] of Object.entries(shortcuts)) {
			this.register(key, value);
		}
		return this;
	}

	get(e: KeyboardEvent): string | null {
		const shortcut = this.process(e);
		return this.shortcutsToCommands.get(shortcut) || null;
	}

	shortcut(name: string): string | null {
		return this.commandsToShortcuts.get(name) || null;
	}
}

const Shortcuts = new ShortcutService();
export default Shortcuts;
