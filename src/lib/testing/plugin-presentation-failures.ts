export interface PresentationEvents {
	subscribe(): () => void;
}

export const failures = new WeakMap<AbortSignal, 'init' | 'effect'>();
