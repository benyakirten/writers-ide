import type { Snippet } from 'svelte';

export type BaseToast = {
	duration?: number;
	dismissable: boolean;
	message: string | Snippet;
};

export class Toast {
	duration: number | null;
	dismissable: boolean;
	message: string | Snippet;
	id: string;
	timeLeft: number | null;
	#interval: NodeJS.Timeout | null = null;

	constructor(
		base: BaseToast,
		id: string,
		private dismiss: () => void
	) {
		this.timeLeft = this.duration = base.duration ?? null;
		this.dismissable = base.dismissable;
		this.message = base.message;
		this.id = id;
		if (this.duration !== null) {
			this.#interval = this.start(this.duration);
		}
	}

	start(duration: number): NodeJS.Timeout {
		const interval = setInterval(() => {
			if (this.timeLeft === null || this.timeLeft <= 0) {
				clearInterval(interval);
				this.dismiss();
				return;
			} else {
				this.timeLeft -= 1;
			}
		}, duration);

		return interval;
	}

	stop(): boolean {
		if (this.#interval === null) {
			return false;
		}

		clearInterval(this.#interval!);
		return true;
	}

	reset() {
		this.stop();
		this.timeLeft = this.duration;
		if (this.duration !== null) {
			this.#interval = this.start(this.duration);
		}
	}
}

export class ToasterState {
	DEFAULT_DURATION = 5000;
	toasts = $state<Toast[]>([]);
	addToast(toast: Omit<BaseToast, 'duration'>, duration = this.DEFAULT_DURATION, id?: string) {
		const _id = id ?? crypto.randomUUID();
		const toastInstance = new Toast({ ...toast, duration }, _id, () => this.dismissToast(_id));
		this.toasts.push(toastInstance);
		return id;
	}

	#index(id: string | number): number | null {
		let index: number;
		if (typeof id === 'string') {
			index = this.toasts.findIndex((t) => t.id === id);
			if (index === -1) {
				return null;
			}
		} else if (id >= 0 && id < this.toasts.length) {
			index = id;
		} else {
			return null;
		}

		return index;
	}

	dismissToast(id: string | number) {
		const index = this.#index(id);
		if (index === null) {
			return;
		}
		this.toasts.splice(index, 1);
	}

	pauseToast(id: string | number) {
		const index = this.#index(id);
		if (index === null) {
			return false;
		}

		const toast = this.toasts[index];
		return toast.stop();
	}

	pop() {
		const toast = this.toasts.pop();
		toast?.stop();
		return toast;
	}
}

const ToastManager = new ToasterState();
export default ToastManager;
