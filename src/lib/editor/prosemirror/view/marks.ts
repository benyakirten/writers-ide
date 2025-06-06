import type { DOMOutputSpec, MarkSpec } from 'prosemirror-model';

const emDOM: DOMOutputSpec = ['em', 0];
const boldDOM: DOMOutputSpec = ['strong', 0];
const codeDOM: DOMOutputSpec = ['code', 0];
const supDOM: DOMOutputSpec = ['sup', 0];
const subDOM: DOMOutputSpec = ['sub', 0];
const underlineDOM: DOMOutputSpec = ['span', { style: 'text-decoration: underline' }, 0];
const overlineDom: DOMOutputSpec = ['span', { style: 'text-decoration: overline' }, 0];
const strikethroughDom: DOMOutputSpec = ['span', { style: 'text-decoration: line-through' }, 0];

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

const italic: MarkSpec = {
	parseDOM: [
		{ tag: 'i' },
		{ tag: 'em' },
		{ style: 'font-style=italic' },
		{ style: 'font-style=normal', clearMark: (m) => m.type.name === 'italic' }
	],
	toDOM() {
		return emDOM;
	}
};

const bold: MarkSpec = {
	parseDOM: [
		{ tag: 'b' },
		{ tag: 'strong' },
		{ style: 'font-weight=bold' },
		{ style: 'font-weight=normal', clearMark: (m) => m.type.name === 'bold' }
	],
	toDOM() {
		return boldDOM;
	}
};

const code: MarkSpec = {
	parseDOM: [{ tag: 'code' }],
	toDOM() {
		return codeDOM;
	}
};

// TODO: Add support for vertical-align +/- amount
// Word use vertical-alignment: % to let you offset by a specific amount
const superscript: MarkSpec = {
	parseDOM: [
		{ tag: 'sup' },
		{ style: 'vertical-align=super' },
		{ style: 'vertical-align=baseline', clearMark: (m) => m.type.name === 'superscript' }
	],
	toDOM() {
		return supDOM;
	}
};

const subscript: MarkSpec = {
	parseDOM: [
		{ tag: 'sub' },
		{ style: 'vertical-align=sub' },
		{ style: 'vertical-align=baseline', clearMark: (m) => m.type.name === 'subscript' }
	],
	toDOM() {
		return subDOM;
	}
};

const underline: MarkSpec = {
	parseDOM: [
		{ style: 'text-decoration-line=underline' },
		{ style: 'text-decoration=none', clearMark: (m) => m.type.name === 'underline' }
	],
	toDOM() {
		return underlineDOM;
	}
};

const overline: MarkSpec = {
	parseDOM: [
		{ style: 'text-decoration-line=overline' },
		{ style: 'text-decoration=none', clearMark: (m) => m.type.name === 'overline' }
	],
	toDOM() {
		return overlineDom;
	}
};

const strikethrough: MarkSpec = {
	parseDOM: [
		{ style: 'text-decoration-line=strike-through' },
		{ style: 'text-decoration=none', clearMark: (m) => m.type.name === 'strikethrough' }
	],
	toDOM() {
		return strikethroughDom;
	}
};

export const marks = {
	link,
	italic,
	bold,
	code,
	superscript,
	subscript,
	underline,
	overline,
	strikethrough
} as const;
