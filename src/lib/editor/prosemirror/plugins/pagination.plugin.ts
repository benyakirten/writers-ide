import { Plugin } from 'prosemirror-state';

export function createPaginationPlugin(): Plugin {
	return new Plugin({});
}

// Split the document into windows, taking into account widow/orphans
// When the user prints, we can use forced page breaks to make it accurate to the view.
