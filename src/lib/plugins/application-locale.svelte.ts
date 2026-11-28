import { untrack } from 'svelte';
import type { LocaleSnapshot, PluginLocale } from '@writers-ide/plugins';
import LocaleManager, { type LocaleState } from '$lib/services/locale-manager.svelte';

/** Host-owned UI locale source. The supported en/fr locales both use LTR text. */
export function createApplicationLocale(
	source: LocaleState = LocaleManager,
): PluginLocale & { dispose(): void } {
	const listeners = new Set<(snapshot: LocaleSnapshot) => void>();
	let disposed = false;
	const snapshot = (): LocaleSnapshot =>
		Object.freeze({ languageTag: source.locale, direction: 'ltr' });
	let previous = source.locale;
	const release = $effect.root(() => {
		$effect(() => {
			const language = source.locale;
			if (language === previous) {
				return;
			}
			previous = language;
			untrack(() => {
				for (const listener of [...listeners]) {
					if (listeners.has(listener)) {
						listener(snapshot());
					}
				}
			});
		});
	});
	return {
		snapshot,
		subscribe(listener) {
			if (disposed) {
				throw new Error('Application locale is disposed');
			}
			listeners.add(listener);
			try {
				listener(snapshot());
			} catch (error) {
				listeners.delete(listener);
				throw error;
			}
			return () => {
				listeners.delete(listener);
			};
		},
		dispose() {
			disposed = true;
			release();
			listeners.clear();
		},
	};
}
