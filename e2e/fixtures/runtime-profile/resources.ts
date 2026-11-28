type Accepted = {
	snapshot: string;
	record: Record<string, string>;
	styles: string[];
	entry: string;
	profile: string;
	sharedStyles: string[];
	modules: Record<string, { exports: string[] }>;
};
export async function digest(bytes: ArrayBuffer) {
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('');
}
export class Resources {
	readonly base: URL;
	readonly styles = new Map<
		string,
		{ owners: number; link: HTMLLinkElement; ready: Promise<void> }
	>();
	constructor(readonly accepted: Accepted) {
		this.base = new URL(`/snapshots/${accepted.snapshot}/`, location.href);
	}
	async verify(url: string, signal?: AbortSignal) {
		const resolved = new URL(url, location.href);
		const name = resolved.href.slice(this.base.href.length);
		if (
			!resolved.href.startsWith(this.base.href) ||
			resolved.search ||
			resolved.hash ||
			!Object.hasOwn(this.accepted.record, name)
		) {
			throw new Error('Not an accepted snapshot URL');
		}
		const response = await fetch(resolved, { signal, cache: 'no-store', redirect: 'error' });
		if (!response.ok) {
			throw new Error(`Resource HTTP ${response.status}`);
		}
		const bytes = await response.arrayBuffer();
		if ((await digest(bytes)) !== this.accepted.record[name]) {
			throw new Error(`Integrity mismatch: ${name}`);
		}
		signal?.throwIfAborted();
		return bytes;
	}
	async acquire(signal?: AbortSignal) {
		const releases: (() => void)[] = [];
		try {
			for (const name of this.accepted.styles) {
				const url = new URL(name, this.base).href;
				let entry = this.styles.get(url);
				if (!entry) {
					await this.verify(url, signal);
					// A concurrent owner may have finished verification first.
					entry = this.styles.get(url);
					if (!entry) {
						const link = document.createElement('link');
						link.rel = 'stylesheet';
						link.href = url;
						link.dataset.packageStyle = name;
						const ready = new Promise<void>((resolve, reject) => {
							link.onload = () => resolve();
							link.onerror = () => reject(new Error('Stylesheet failed'));
						});
						entry = { owners: 0, link, ready };
						this.styles.set(url, entry);
						document.head.append(link);
					}
				}
				entry.owners++;
				const owned = entry;
				releases.push(() => {
					owned.owners--;
					if (owned.owners === 0) {
						owned.link.remove();
						this.styles.delete(url);
					}
				});
				await new Promise<void>((resolve, reject) => {
					const abort = () => reject(signal?.reason);
					signal?.addEventListener('abort', abort, { once: true });
					if (signal?.aborted) {
						abort();
					}
					owned.ready
						.then(resolve, reject)
						.finally(() => signal?.removeEventListener('abort', abort));
				});
				signal?.throwIfAborted();
			}
		} catch (error) {
			for (const release of releases.reverse()) {
				release();
			}
			throw error;
		}
		let live = true;
		return () => {
			if (live) {
				live = false;
				for (const release of releases.reverse()) {
					release();
				}
			}
		};
	}
	// Preliminary browser checks do not bind subsequent native import/link fetches
	// to these bytes. Those requests rely on the server's immutable accepted buffers
	// and trusted transport. Blob workers instead consume verify()'s returned bytes.
	async prepare(profile: string, signal?: AbortSignal) {
		if (profile !== this.accepted.profile) {
			throw new Error('Unsupported runtime profile');
		}
		for (const name of Object.keys(this.accepted.record)) {
			await this.verify(new URL(name, this.base).href, signal);
		}
		return this.acquire(signal);
	}
}
