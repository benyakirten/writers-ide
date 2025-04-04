import { SvelteMap } from 'svelte/reactivity';

import { Observable } from '$lib/utils/observable';

export class ShortcutService extends Observable<string> {
	shortcutsToCommands = new SvelteMap<string, string>();
	commandsToShortcuts = new SvelteMap<string, string>();
	keysDown: Set<string> = new Set();
	SEPARATOR = '<>';

	#standardize(cmd: Set<string>): string {
		const output: string[] = [];

		if (cmd.has('meta')) {
			output.push('meta');
		}

		if (cmd.has('alt')) {
			output.push('alt');
		}

		if (cmd.has('ctrl')) {
			output.push('ctrl');
		}

		if (cmd.has('shift')) {
			output.push('shift');
		}

		for (const key of cmd) {
			if (key === 'ctrl' || key === 'meta' || key === 'alt' || key === 'shift') {
				continue;
			}
			output.push(key.toLocaleLowerCase());
		}

		return output.join(this.SEPARATOR);
	}

	parse(cmd: Set<string> | string[] | string): string {
		if (typeof cmd === 'string') {
			const arr = cmd.split(this.SEPARATOR);
			const set = new Set(arr);
			return this.#standardize(set);
		} else if (Array.isArray(cmd)) {
			const set = new Set(cmd);
			return this.#standardize(set);
		} else {
			return this.#standardize(cmd);
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
	process(e: KeyboardEvent): string | null {
		const key = e.key.toLocaleLowerCase();
		if (e.type === 'keyup') {
			this.keysDown.delete(key);
			return null;
		}

		this.keysDown.add(key);
		return this.#standardize(this.keysDown);
	}

	listen(e: KeyboardEvent): void {
		const key = this.process(e);
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

	add(shortcuts: Record<string, string>) {
		for (const [key, value] of Object.entries(shortcuts)) {
			this.register(key, value);
		}
		return this;
	}

	get(e: KeyboardEvent): string | null {
		const shortcut = this.process(e);
		if (!shortcut) {
			return null;
		}
		return this.shortcutsToCommands.get(shortcut) ?? null;
	}

	shortcut(name: string): string | null {
		return this.commandsToShortcuts.get(name) ?? null;
	}
}

const Shortcuts = new ShortcutService();
export default Shortcuts;
