export function createCounter() {
	// eslint-disable-next-line no-undef -- The Svelte module compiler supplies this rune.
	let count = $state(0);
	return {
		get count() {
			return count;
		},
		increment() {
			count++;
		},
	};
}
