import type { Attrs, Node as PMNode } from 'prosemirror-model';
import type {
	Decoration,
	DecorationSource,
	EditorView,
	NodeView,
	ViewMutationRecord
} from 'prosemirror-view';
import { SvelteComponent, unmount } from 'svelte';

export interface SvelteNodeViewProps<A extends Attrs> {
	node: PMNode;
	attrs: A;
	contentDOM: (node: HTMLElement) => void;
	selected: boolean | undefined;
	view: EditorView;
	getPos: () => number | undefined;
	decorations: readonly Decoration[];
	innerDecorations: DecorationSource;
}

// TODO: https://github.com/benyakirten/svelte-multimodal-editor/issues/18
export class SvelteNodeView<A extends Attrs> implements NodeView {
	component?: typeof SvelteComponent<SvelteNodeViewProps<A>>;
	dom: Node = document.createElement('div');
	contentDOM?: HTMLElement | null | undefined;
	update?:
		| ((
				node: PMNode,
				decorations: readonly Decoration[],
				innerDecorations: DecorationSource
		  ) => boolean)
		| undefined;
	multiType?: boolean | undefined;
	selectNode?: (() => void) | undefined;
	deselectNode?: (() => void) | undefined;
	setSelection?: ((anchor: number, head: number, root: Document | ShadowRoot) => void) | undefined;
	stopEvent?: ((event: Event) => boolean) | undefined;
	ignoreMutation(mutation: ViewMutationRecord): boolean {
		console.log(mutation);
		return true;
	}
	destroy() {
		unmount(this.dom);
	}
}
