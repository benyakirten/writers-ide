import { SvelteMap } from 'svelte/reactivity';

import { Observable } from '$lib/utils/observable';

export class ShortcutService extends Observable<string> {
	shortcutsToCommands = new SvelteMap<string, string>();

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

	register(name: string, cmd: Set<string> | string[] | string): boolean {
		const key = this.parse(cmd);
		if (!this.#hasCtrlMetaOrAltKeys(key)) {
			return false;
		}

		this.shortcutsToCommands.set(key, name);
		return true;
	}

	listen(e: KeyboardEvent) {
		const cmd = [e.key];
		if (e.altKey) {
			cmd.push('alt');
		}

		if (e.shiftKey) {
			cmd.push('shift');
		}

		if (e.metaKey) {
			cmd.push('meta');
		}

		if (e.ctrlKey) {
			cmd.push('ctrl');
		}

		const key = this.#standardize(cmd);
		if (!key) {
			return;
		}

		const emitted = this.shortcutsToCommands.get(key);
		if (emitted) {
			this.update(emitted);
		}
	}

	on(cmds: Record<string, () => void>): () => void {
		return this.subscribe((val) => cmds[val]?.());
	}
}

const Shortcuts = new ShortcutService();
export default Shortcuts;
