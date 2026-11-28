export class Lifetime {
	#cleanups = new Set();
	#closed = false;
	own(cleanup) {
		let active = true;
		const release = () => {
			if (!active) {
				return;
			}
			active = false;
			this.#cleanups.delete(release);
			cleanup();
		};
		if (this.#closed) {
			release();
		} else {
			this.#cleanups.add(release);
		}
		return release;
	}
	close() {
		this.#closed = true;
		for (const release of [...this.#cleanups].reverse()) {
			try {
				release();
			} catch {
				// Remaining owned resources still need cleanup.
			}
		}
	}
}

export class Styles {
	#entries = new Map();
	acquire(url, owner) {
		let entry = this.#entries.get(url);
		if (!entry) {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = url;
			link.dataset.resourcePrototype = 'fixture';
			const ready = new Promise((resolve, reject) => {
				link.onload = () => resolve();
				link.onerror = () => reject(new Error('Fixture stylesheet failed to load'));
			});
			entry = { link, ready, owners: 0 };
			this.#entries.set(url, entry);
			document.head.append(link);
		}
		entry.owners += 1;
		owner.own(() => {
			entry.owners -= 1;
			if (entry.owners === 0) {
				entry.link.remove();
				this.#entries.delete(url);
			}
		});
		return entry.ready;
	}
	get size() {
		return this.#entries.size;
	}
}
