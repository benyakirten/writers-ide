import type { LocaleSnapshot, PluginLocale } from './frontend';
import type { Dispose } from './index';

type Options = {
	readonly source: PluginLocale;
	readonly isLive: () => boolean;
	readonly signal: AbortSignal;
	readonly own: (dispose: Dispose) => Dispose;
	readonly callback: <T>(callback: () => T) => T;
	readonly onError: () => void;
};

function capture(value: LocaleSnapshot): LocaleSnapshot {
	if (
		!value ||
		typeof value.languageTag !== 'string' ||
		value.languageTag.trim().length === 0 ||
		(value.direction !== 'ltr' && value.direction !== 'rtl')
	) {
		throw new TypeError('Locale sources must supply a language tag and ltr/rtl direction.');
	}
	return Object.freeze({ languageTag: value.languageTag, direction: value.direction });
}

/** Internal adapter over a host-supplied UI locale, not a translation registry. */
export function createActivationLocale(options: Options): PluginLocale {
	const live = () => options.isLive() && !options.signal.aborted;
	const assertLive = () => {
		if (!live()) {
			throw new Error('Component locale service is revoked.');
		}
	};
	const snapshot = () => {
		assertLive();
		const value = options.callback(() => capture(options.source.snapshot()));
		assertLive();
		return value;
	};
	return Object.freeze({
		snapshot,
		subscribe(listener: (locale: LocaleSnapshot) => void): Dispose {
			assertLive();
			if (typeof listener !== 'function') {
				throw new TypeError('Locale subscription listener must be a function.');
			}
			let active = true;
			let last: LocaleSnapshot | undefined;
			let stopSource: Dispose | undefined;
			let delivering = false;
			let pending = false;
			const stop = () => {
				if (!active) {
					return;
				}
				active = false;
				options.signal.removeEventListener('abort', abort);
				const release = stopSource;
				stopSource = undefined;
				release?.();
			};
			const reportFailure = () => {
				try {
					const result = options.callback(options.onError);
					void Promise.resolve(result).catch(() => undefined);
				} catch {
					// Reporting cannot affect the locale source or sibling subscribers.
				}
			};
			const report = () => {
				if (active && live()) {
					reportFailure();
				}
			};
			const abort = () => {
				try {
					stop();
				} catch {
					reportFailure();
				}
			};
			const deliver = () => {
				if (!active || !live()) {
					return;
				}
				pending = true;
				if (delivering) {
					return;
				}
				delivering = true;
				try {
					while (pending && active && live()) {
						pending = false;
						let value: LocaleSnapshot;
						try {
							value = snapshot();
						} catch (error) {
							if (!active || !live()) {
								return;
							}
							throw error;
						}
						if (!active || !live()) {
							return;
						}
						// A notice during the read can make its returned snapshot stale.
						if (pending) {
							continue;
						}
						if (last?.languageTag === value.languageTag && last.direction === value.direction) {
							continue;
						}
						last = value;
						try {
							const result = options.callback(() => listener(value));
							void Promise.resolve(result).catch(report);
						} catch {
							report();
						}
					}
				} finally {
					delivering = false;
				}
			};
			options.signal.addEventListener('abort', abort, { once: true });
			try {
				// PluginLocale sources deliver immediately. Read their current snapshot on
				// each notice so nested source updates cannot deliver an older value later.
				stopSource = options.callback(() => options.source.subscribe(deliver));
				if (!active || !live()) {
					const release = stopSource;
					stopSource = undefined;
					stop();
					release();
				}
				return options.own(stop);
			} catch (error) {
				stop();
				throw error;
			}
		},
	});
}
