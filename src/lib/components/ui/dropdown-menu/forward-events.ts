import { createBubbler } from 'svelte/legacy';

// Keep existing on:event consumers working while exposing Bits 2 callback props.
// Forward the original DOM event so preventDefault and event identity are preserved.
export function createEventForwarder() {
	const bubble = createBubbler();
	return <E extends Event>(name: string, callback?: ((event: E) => unknown) | null) => {
		return (event: E) => {
			callback?.(event);
			bubble(name)(event);
		};
	};
}
