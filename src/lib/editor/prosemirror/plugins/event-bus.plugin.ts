import { Plugin } from 'prosemirror-state';

import proseMirrorEventBus, {
	ProseMirrorEventBusEventType,
} from '$lib/editor/state/event-bus.svelte';

export const createEventBusPlugin = (id: string) =>
	new Plugin({
		view(view) {
			proseMirrorEventBus.update({ id, event: { view, type: ProseMirrorEventBusEventType.Init } });

			return {
				update(view) {
					proseMirrorEventBus.update({
						id,
						event: { view, type: ProseMirrorEventBusEventType.Update },
					});
				},
			};
		},
	});
