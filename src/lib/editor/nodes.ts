import type { DOMOutputSpec, NodeSpec } from 'prosemirror-model';

// Top level doc node.
const doc: NodeSpec = {
	content: 'block+'
};

// Basic P block
const pDOM: DOMOutputSpec = ['p', 0];
const paragraph: NodeSpec = {
	content: 'inline*',
	group: 'block',
	parseDOM: [{ tag: 'p' }],
	toDOM() {
		return pDOM;
	}
};

const blockquoteDOM: DOMOutputSpec = ['blockquote', 0];
const blockquote: NodeSpec = {
	content: 'block+',
	group: 'block',
	defining: true,
	parseDOM: [{ tag: 'blockquote' }],
	toDOM() {
		return blockquoteDOM;
	}
};

const hrDOM: DOMOutputSpec = ['hr'];
const horizontalRule: NodeSpec = {
	group: 'block',
	parseDOM: [{ tag: 'hr' }],
	toDOM() {
		return hrDOM;
	}
};

const heading: NodeSpec = {
	attrs: { level: { default: 1, validate: 'number' } },
	content: 'inline*',
	group: 'block',
	defining: true,
	parseDOM: [
		{ tag: 'h1', attrs: { level: 1 } },
		{ tag: 'h2', attrs: { level: 2 } },
		{ tag: 'h3', attrs: { level: 3 } },
		{ tag: 'h4', attrs: { level: 4 } },
		{ tag: 'h5', attrs: { level: 5 } },
		{ tag: 'h6', attrs: { level: 6 } }
	],
	toDOM(node) {
		return ['h' + node.attrs.level, 0];
	}
};

const preDOM: DOMOutputSpec = ['pre', ['code', 0]];
const codeBlock: NodeSpec = {
	content: 'text*',
	marks: '',
	group: 'block',
	code: true,
	defining: true,
	parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
	toDOM() {
		return preDOM;
	}
};

const text: NodeSpec = {
	group: 'inline'
};

const image: NodeSpec = {
	inline: true,
	attrs: {
		src: { validate: 'string' },
		alt: { default: null, validate: 'string|null' },
		title: { default: null, validate: 'string|null' }
	},
	group: 'inline',
	draggable: true,
	parseDOM: [
		{
			tag: 'img[src]',
			getAttrs(dom: HTMLElement) {
				return {
					src: dom.getAttribute('src'),
					title: dom.getAttribute('title'),
					alt: dom.getAttribute('alt')
				};
			}
		}
	],
	toDOM(node) {
		const { src, alt, title } = node.attrs;
		return ['img', { src, alt, title }];
	}
};

const brDOM: DOMOutputSpec = ['br'];
const hardBreak: NodeSpec = {
	inline: true,
	group: 'inline',
	selectable: false,
	parseDOM: [{ tag: 'br' }],
	toDOM() {
		return brDOM;
	}
};

export const nodes = {
	doc,
	paragraph,
	blockquote,
	horizontalRule,
	heading,
	codeBlock,
	text,
	image,
	hardBreak
} as const;
