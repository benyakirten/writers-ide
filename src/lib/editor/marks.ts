import type { DOMOutputSpec, MarkSpec } from 'prosemirror-model';

const emDOM: DOMOutputSpec = ['em', 0];
const strongDOM: DOMOutputSpec = ['strong', 0];
const codeDOM: DOMOutputSpec = ['code', 0];

const link: MarkSpec = {
	attrs: {
		href: { validate: 'string' },
		title: { default: null, validate: 'string|null' }
	},
	inclusive: false,
	parseDOM: [
		{
			tag: 'a[href]',
			getAttrs(dom: HTMLElement) {
				return { href: dom.getAttribute('href'), title: dom.getAttribute('title') };
			}
		}
	],
	toDOM(node) {
		const { href, title } = node.attrs;
		return ['a', { href, title }, 0];
	}
};

const em: MarkSpec = {
	parseDOM: [
		{ tag: 'i' },
		{ tag: 'em' },
		{ style: 'font-style=italic' },
		{ style: 'font-style=normal', clearMark: (m) => m.type.name === 'em' }
	],
	toDOM() {
		return emDOM;
	}
};

const strong: MarkSpec = {
	parseDOM: [
		{ tag: 'b' },
		{ tag: 'strong' },
		{ style: 'font-weight=bold' },
		{ style: 'font-weight=normal', clearMark: (m) => m.type.name === 'strong' }
	],
	toDOM() {
		return strongDOM;
	}
};

const code: MarkSpec = {
	parseDOM: [{ tag: 'code' }],
	toDOM() {
		return codeDOM;
	}
};

export const marks = {
	link,
	em,
	strong,
	code
} as const;
