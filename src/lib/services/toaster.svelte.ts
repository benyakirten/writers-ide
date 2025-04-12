import type { Snippet } from 'svelte';

export type BaseToast = {
	duration: number | null;
	message: string | Snippet;
};

export class Toast implements BaseToast {
	duration: number | null = $state(null);
	message: string | Snippet = $state('');
	id: string = $state('');
	timeLeft: number | null = $state(null);
	interval: NodeJS.Timeout | null = $state(null);
	static readonly INTERVAL_DELAY = 10;

	constructor(
		base: BaseToast,
		id: string,
		private dismiss: () => void
	) {
		this.timeLeft = this.duration = base.duration ?? null;
		this.message = base.message;
		this.id = id;
		if (this.duration) {
			this.start();
		}
	}

	start() {
		const interval = setInterval(() => {
			if (this.timeLeft === null || this.timeLeft <= 0) {
				clearInterval(interval);
				this.dismiss();
				return;
			} else {
				this.timeLeft -= Toast.INTERVAL_DELAY;
			}
		}, Toast.INTERVAL_DELAY);

		this.interval = interval;
	}

	stop(): boolean {
		if (this.interval === null) {
			return false;
		}

		clearInterval(this.interval);
		this.interval = null;
		return true;
	}

	reset() {
		this.stop();
		if (!this.duration) {
			return false;
		}

		this.timeLeft = this.duration;
		if (this.duration !== null) {
			this.start();
		}
		return true;
	}
}

export class ToasterState {
	static readonly DEFAULT_DURATION = 5000;
	toasts = $state<Toast[]>([]);
	addToast(
		message: BaseToast['message'],
		duration: number | null = ToasterState.DEFAULT_DURATION,
		id?: string
	) {
		const _id = id ?? crypto.randomUUID();
		const toastInstance = new Toast({ message, duration }, _id, () => this.removeToast(_id));
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
