import type { Snippet } from 'svelte';

export type BaseToast = {
	duration: number | null;
	dismissable: boolean;
	message: string | Snippet;
};
export type Toast = BaseToast & { id: string };

export class ToasterState {
	toasts = $state<Toast[]>([]);
	addToast(toast: Toast, id?: string) {
		id ??= toast.id;
		this.toasts.push({
			...toast,
			id
		});
		return [id, () => this.dismissToast(id)];
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
