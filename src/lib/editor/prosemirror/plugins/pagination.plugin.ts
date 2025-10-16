import { Plugin, PluginKey } from 'prosemirror-state';

const paginationPluginKey = new PluginKey('wide-pagination-plugin');

export function createPaginationPlugin(): Plugin {
	return new Plugin({ key: paginationPluginKey });
}

// Split the document into windows, taking into account widow/orphans
// When the user prints, we can use forced page breaks to make it accurate to the view.
