const builtInShortcuts = {
	subscript: 'ctrl-shift-+',
	superscript: 'ctrl-shift-_',
	strikethrough: 'meta-shift-x',
	'align-left': 'meta-shift-[',
	'align-right': 'meta-shift-]',
	'align-center': 'meta-shift-;',
	'align-justify': "meta-shift-'",
	undo: 'meta-z',
	redo: 'meta-y',
	bold: 'meta-b',
	italic: 'meta-i',
	underline: 'meta-u',
	overline: 'meta-j',
	indent: 'meta-]',
	dedent: 'meta-['
} as const;
export { builtInShortcuts };
