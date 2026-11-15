import type { Dispose, PluginContext } from '@writers-ide/plugins';
import type { FormattingService } from './contracts';

/** Activation lifetime for an explicitly injected, trusted feature dependency; not a sandbox. */
export function scopeFormattingService(
	service: FormattingService,
	context: Pick<PluginContext<unknown>, 'own' | 'signal'>,
): FormattingService {
	return Object.freeze({
		subscribe(listener: Parameters<FormattingService['subscribe']>[0]) {
			if (context.signal.aborted) {
				throw new Error('Formatting service revoked');
			}
			let subscribed = true;
			let subscribing = true;
			let failure: { error: unknown } | undefined;
			let unsubscribe: Dispose;
			try {
				unsubscribe = service.subscribe((snapshot) => {
					if (context.signal.aborted || !subscribed) {
						return;
					}
					try {
						listener(
							snapshot === null
								? null
								: {
										...snapshot,
										marks: { ...snapshot.marks },
										blocks: { ...snapshot.blocks },
										enabled: { ...snapshot.enabled },
									},
						);
					} catch (error) {
						if (!subscribing) {
							throw error;
						}
						// Wait for the source handle before releasing a failed initial delivery.
						subscribed = false;
						failure = { error };
					}
				});
				if (typeof unsubscribe !== 'function') {
					throw new Error('Formatting subscription must return a disposer');
				}
			} catch (error) {
				// Sources that throw still own atomic cleanup; retained callbacks are revoked here.
				subscribed = false;
				throw error;
			} finally {
				subscribing = false;
			}
			const release = context.own(() => {
				subscribed = false;
				unsubscribe();
			});
			if (failure) {
				release();
				throw failure.error;
			}
			return release;
		},
		execute(request: Parameters<FormattingService['execute']>[0]) {
			return !context.signal.aborted && service.execute({ ...request });
		},
	});
}
