import { Plugin } from 'prosemirror-state';

import proseMirrorEventBus from '$lib/editor/state/event-bus.svelte';

export const createUpdatePlugin = (id: string) =>
	new Plugin({
		view(view) {
			proseMirrorEventBus.update({ id, view });

			return {
				update(view) {
					proseMirrorEventBus.update({ id, view });
				},
			};
		},
	});
