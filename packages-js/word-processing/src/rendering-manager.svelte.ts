import { Plugin } from 'prosemirror-state';
import { createBehaviorManager } from './behaviors.svelte';
import { synchronousRendererResult } from './renderers';
import type { RendererType } from './renderers';
import type {
	EditorBehaviorFailure,
	EditorMarkViewRegistration,
	EditorNodeViewRegistration,
	EditorRendererContext,
} from './contracts';

/** Dedicated renderer entry points share the editor's single reconciliation engine. */
export function createRenderingManager(manager: ReturnType<typeof createBehaviorManager>) {
	function register(
		registration: EditorNodeViewRegistration | EditorMarkViewRegistration,
		renderer: RendererType,
		ownerId: string,
		signal?: AbortSignal,
		onError?: (failure: EditorBehaviorFailure) => void,
	) {
		if (typeof registration.create !== 'function') {
			throw new TypeError('Renderer registrations require a synchronous create factory');
		}
		if (typeof renderer.type !== 'string' || !renderer.type.trim()) {
			throw new TypeError('Renderer registrations must name an existing schema type');
		}
		return manager.register(
			{
				id: registration.id,
				name: registration.name,
				views: registration.views,
				create(context) {
					const schemaType =
						renderer.kind === 'node'
							? context.state.schema.nodes[renderer.type]
							: context.state.schema.marks[renderer.type];
					if (!schemaType) {
						throw new TypeError(`Unknown schema ${renderer.kind} type: ${renderer.type}`);
					}
					const constructor = synchronousRendererResult(
						registration.create(context as EditorRendererContext),
					);
					if (typeof constructor !== 'function') {
						throw new TypeError('Renderer factories must return a ProseMirror view constructor');
					}
					return new Plugin({
						props:
							renderer.kind === 'node'
								? {
										nodeViews: {
											[renderer.type]: constructor as ReturnType<
												EditorNodeViewRegistration['create']
											>,
										},
									}
								: {
										markViews: {
											[renderer.type]: constructor as ReturnType<
												EditorMarkViewRegistration['create']
											>,
										},
									},
					});
				},
			},
			ownerId,
			signal,
			onError,
			renderer,
		);
	}
	return {
		registerNodeView(
			registration: EditorNodeViewRegistration,
			ownerId: string,
			signal?: AbortSignal,
			onError?: (failure: EditorBehaviorFailure) => void,
		) {
			return register(
				registration,
				{ kind: 'node', type: registration.nodeType },
				ownerId,
				signal,
				onError,
			);
		},
		registerMarkView(
			registration: EditorMarkViewRegistration,
			ownerId: string,
			signal?: AbortSignal,
			onError?: (failure: EditorBehaviorFailure) => void,
		) {
			return register(
				registration,
				{ kind: 'mark', type: registration.markType },
				ownerId,
				signal,
				onError,
			);
		},
	};
}
