// TODO: These will be saved into a system-wide config file
// that will be editable when the user has initially set up the system.
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
	dedent: 'meta-[',
	'move-bar-inline-start': 'meta-shift-e',
	'move-bar-inline-end': 'meta-shift-r',
	'move-bar-block-start': 'meta-shift-t',
	'move-bar-block-end': 'meta-shift-y',
	'move-bar-floating': 'meta-shift-u',
	'move-bar-up': 'meta-shift-arrowup',
	'move-bar-down': 'meta-shift-arrowdown',
	'move-bar-left': 'meta-shift-arrowleft',
	'move-bar-right': 'meta-shift-arrowright'
} as const;
export { builtInShortcuts };
