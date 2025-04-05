import { Observable } from '$lib/utils/observable';
import { isMac } from '$lib/utils/misc';
import { capitalize } from '$lib/utils/strings';

export class ShortcutService extends Observable<string> {
	commandsToShortcuts = $state<Record<string, string>>({});
	shortcutsToCommands = $derived.by(() => {
		const shortcuts: Record<string, string> = {};
		for (const [command, shortcut] of Object.entries(this.commandsToShortcuts)) {
			if (shortcut) {
				shortcuts[shortcut] = command;
			}
		}
		return shortcuts;
	});
	commandsToDisplayedShortcuts = $derived.by(() => {
		const displayShortcuts: Record<string, string> = {};
		for (const [command, shortcut] of Object.entries(this.commandsToShortcuts)) {
			displayShortcuts[command] = this.display(shortcut, isMac());
		}
		return displayShortcuts;
	});
	SEPARATOR = '-';

	WINDOWS_SPECIAL_KEYS = {
		arrowdown: 'DownArrow',
		arrowup: 'UpArrow',
		arrowleft: 'LeftArrow',
		arrowright: 'RightArrow',
		ctrl: 'Ctrl',
		shift: 'Shift',
		meta: 'Win',
		alt: 'Alt',
		enter: 'enter',
		backspace: 'backspace',
		delete: 'delete',
		escape: 'esc'
	};

	MAC_SPECIAL_KEYS = {
		arrowdown: '↓',
		arrowup: '↑',
		arrowleft: '←',
		arrowright: '→',
		ctrl: '⌃',
		meta: '⌘',
		alt: '⌥',
		shift: '⇧',
		enter: '↩',
		backspace: 'delete',
		delete: 'fn delete',
		escape: 'escape'
	};

	display(shortcut: string, isMac: boolean): string {
		const specialKeys = isMac ? this.MAC_SPECIAL_KEYS : this.WINDOWS_SPECIAL_KEYS;
		const separator = isMac ? '' : '+';
		return this.split(shortcut)
			.reduce<string[]>((acc, next) => {
				const k = next in specialKeys ? specialKeys[next as keyof typeof specialKeys] : next;
				const capitalized = k.split(' ').map(capitalize);
				return acc.concat(capitalized);
			}, [])
			.join(separator);
	}

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
		if (!(name in this.commandsToShortcuts)) {
			this.commandsToShortcuts[name] = '';
		}
		return this;
	}

	unset(name: string) {
		if (!(name in this.commandsToShortcuts)) {
			return false;
		}

		this.commandsToShortcuts[name] = '';
		return true;
	}

	removeShortcut(shortcut: Set<string> | string[] | string): boolean {
		const key = this.parse(shortcut);
		const name = this.shortcutsToCommands[key];

		if (!name || !(name in this.commandsToShortcuts)) {
			return false;
		}

		this.commandsToShortcuts[name] = '';
		return true;
	}

	register(name: string, shortcut: Set<string> | string[] | string): boolean {
		const key = this.parse(shortcut);
		if (!this.#hasCtrlMetaOrAltKeys(key)) {
			return false;
		}

		this.commandsToShortcuts[name] = key;
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
		const cmd = this.shortcutsToCommands[key];
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
		return this.shortcutsToCommands[shortcut] || null;
	}

	shortcut(name: string): string | null {
		return this.commandsToShortcuts[name] || null;
	}
}

const Shortcuts = new ShortcutService();
export default Shortcuts;
