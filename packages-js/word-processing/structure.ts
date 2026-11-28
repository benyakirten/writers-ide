import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';

export type BlockReference = {
	readonly node: ProseMirrorNode;
	readonly position: number;
};

export type SelectedBlockGroup =
	| { readonly kind: 'single'; readonly block: BlockReference }
	| {
			readonly kind: 'continuation';
			readonly head: BlockReference;
			readonly continuation: BlockReference;
	  };

// This entry point describes the current page/block model, not an arbitrary schema.
const PAGE_DEPTH = 1;
const BLOCK_DEPTH = 2;

/** Groups blocks in selection order, including a caret's block and either continuation half. */
export function groupSelectedBlocks(state: EditorState): readonly SelectedBlockGroup[] {
	const groups: SelectedBlockGroup[] = [];
	const { from, to } = state.selection;
	let position = from;
	while (position < to || position === from) {
		const group = identifyBlockGroup(state, position);
		if (!group) {
			break;
		}
		groups.push(group);
		const last = group.kind === 'continuation' ? group.continuation : group.block;
		position = last.position + last.node.nodeSize;
		const end = state.doc.resolve(position);
		if (end.depth === PAGE_DEPTH && end.index(PAGE_DEPTH) === end.parent.childCount) {
			position = end.after(PAGE_DEPTH);
		}
	}
	return groups;
}

function blockDetails(state: EditorState, position: number) {
	const resolved = state.doc.resolve(position);
	const pageIndex = resolved.index(0);
	if (resolved.depth < PAGE_DEPTH) {
		// AllSelection starts before a page. Document end has no following page.
		const pageNode = state.doc.maybeChild(pageIndex);
		const blockNode = pageNode?.firstChild;
		if (!pageNode || !blockNode) {
			return null;
		}
		const blockStart = position + 1;
		return {
			pageNode,
			pageIndex,
			blockStart,
			blockNode,
			blockIndex: 0,
			blockEnd: blockStart + blockNode.nodeSize,
		};
	}

	const pageNode = resolved.node(PAGE_DEPTH);
	const blockIndex = resolved.index(PAGE_DEPTH);
	const blockNode = pageNode.maybeChild(blockIndex);
	if (!blockNode) {
		return null;
	}
	const blockStart = resolved.depth >= BLOCK_DEPTH ? resolved.before(BLOCK_DEPTH) : position;
	return {
		pageNode,
		pageIndex,
		blockStart,
		blockNode,
		blockIndex,
		blockEnd: blockStart + blockNode.nodeSize,
	};
}

/** Returns state-specific references; validate or map positions before reuse after edits. */
export function identifyBlockGroup(
	state: EditorState,
	position: number,
): SelectedBlockGroup | null {
	const details = blockDetails(state, position);
	if (!details) {
		return null;
	}
	const { pageNode, pageIndex, blockStart, blockNode, blockIndex, blockEnd } = details;
	const block: BlockReference = { node: blockNode, position: blockStart };
	if (blockNode.attrs.peer) {
		const previousPage = state.doc.maybeChild(pageIndex - 1);
		const head = previousPage?.lastChild;
		if (head) {
			return {
				kind: 'continuation',
				head: { node: head, position: blockStart - head.nodeSize - 2 },
				continuation: block,
			};
		}
	}
	if (blockIndex === pageNode.childCount - 1) {
		const nextPage = state.doc.maybeChild(pageIndex + 1);
		const continuation = nextPage?.firstChild;
		if (continuation?.attrs.peer) {
			return {
				kind: 'continuation',
				head: block,
				continuation: { node: continuation, position: blockEnd + 2 },
			};
		}
	}
	return { kind: 'single', block };
}
