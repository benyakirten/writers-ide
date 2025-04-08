import type { Snippet } from 'svelte';

export type BaseToast = {
	duration: number | null;
	dismissable: boolean;
	message: string | Snippet;
};
export type Toast = BaseToast & { id: string };

export class ToasterState {
	toasts = $state<Toast[]>([]);
	addToast(toast: BaseToast, id?: string) {
		const _id = id ?? crypto.randomUUID();
		this.toasts.push({
			...toast,
			id: _id
		});
		return [id, () => this.dismissToast(_id)];
	}

	dismissToast(id: string | number) {
		const index = typeof id === 'string' ? this.toasts.findIndex((t) => t.id === id) : id;
		if (index === -1) {
			return;
		}
		this.toasts.splice(index, 1);
	}

	pop() {
		this.toasts.pop();
	}
}
