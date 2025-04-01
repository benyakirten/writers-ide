import { SvelteMap } from 'svelte/reactivity';

import { Observable } from '$lib/utils/observable';

export class ShortcutService extends Observable<string> {
	commands = new SvelteMap<string, string>();

	#homogenize(cmd: string[]): string {
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

		output.push(cmd[0].toLocaleLowerCase());
		return output.join('+');
	}

	parse(cmd: Set<string> | string[] | string): string {
		if (typeof cmd === 'string') {
			const arr = cmd.split('+');
			return this.#homogenize(arr);
		} else if (Array.isArray(cmd)) {
			return this.#homogenize(cmd);
		} else {
			const arr = [...cmd];
			return this.#homogenize(arr);
		}
	}

	register(name: string, cmd: Set<string> | string[] | string) {
		const key = this.parse(cmd);
		this.commands.set(key, name);
		return this;
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

		const key = this.#homogenize(cmd);
		const emitted = this.commands.get(key);
		if (emitted) {
			this.update(emitted);
		}
	}

	on(cmds: Record<string, () => void>): () => void {
		const unsub = this.subscribe((val) => cmds[val]?.());
		return unsub;
	}
}

const Shortcuts = new ShortcutService();
export default Shortcuts;
