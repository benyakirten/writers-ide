import type { Snippet } from 'svelte';

export type BaseToast = {
	duration: number | null;
	dismissable: boolean;
	message: string | Snippet;
};

export class Toast implements BaseToast {
	duration: number | null;
	dismissable: boolean;
	message: string | Snippet;
	id: string;
	timeLeft: number | null;
	#interval: NodeJS.Timeout | null = null;
	static readonly INTERVAL_DELAY = 100;

	constructor(
		base: BaseToast,
		id: string,
		private dismiss: () => void
	) {
		this.timeLeft = this.duration = base.duration ?? null;
		this.dismissable = base.dismissable;
		this.message = base.message;
		this.id = id;
		if (this.duration) {
			this.#interval = this.start();
		}
	}

	start(): NodeJS.Timeout {
		const interval = setInterval(() => {
			if (this.timeLeft === null || this.timeLeft <= 0) {
				clearInterval(interval);
				this.dismiss();
				return;
			} else {
				this.timeLeft -= 100;
			}
		}, Toast.INTERVAL_DELAY);

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
		if (!this.duration) {
			return false;
		}

		this.timeLeft = this.duration;
		if (this.duration !== null) {
			this.#interval = this.start();
		}
		return true;
	}
}

export class ToasterState {
	static readonly DEFAULT_DURATION = 5000;
	toasts = $state<Toast[]>([]);
	addToast(
		toast: Omit<BaseToast, 'duration'>,
		duration: number | null = ToasterState.DEFAULT_DURATION,
		id?: string
	) {
		const _id = id ?? crypto.randomUUID();
		const toastInstance = new Toast({ ...toast, duration }, _id, () => this.removeToast(_id));
		this.toasts.push(toastInstance);

		return _id;
	}

	#index(id: string | number): number | null {
		if (typeof id === 'number' && id >= 0 && id < this.toasts.length) {
			return id;
		}

		const index = this.toasts.findIndex((t) => t.id === id);
		if (index === -1) {
			return null;
		}

		return index;
	}

	removeToast(id: string | number) {
		const index = this.#index(id);
		if (index === null) {
			return false;
		}

		const toast = this.toasts.at(index);
		if (!toast) {
			return false;
		}

		toast.stop();
		this.toasts.splice(index, 1);

		return true;
	}

	pauseToast(id: string | number) {
		const index = this.#index(id);
		if (index === null) {
			return false;
		}

		const toast = this.toasts.at(index);
		if (!toast) {
			return false;
		}

		return toast.stop();
	}
}

const ToastManager = new ToasterState();
export default ToastManager;
