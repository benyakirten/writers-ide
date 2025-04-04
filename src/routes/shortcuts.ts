const builtInShortcuts: Record<string, string> = {
	subscript: 'Ctrl+Shift++'
   'Ctrl+Shift+-'
					'Ctrl-Shift-_': (state, dispatch, view) =>
						ActionUtilities.toggleTextMark('subscript', state, dispatch, view, 'superscript'),
					'Mod-Shift-X': (state, dispatch, view) =>
						ActionUtilities.toggleTextMark('strikethrough', state, dispatch, view),
					'Mod-Shift-{': (state, dispatch) =>
						ActionUtilities.setTextAlignment('left', state, dispatch),
					'Mod-Shift-}': (state, dispatch) =>
						ActionUtilities.setTextAlignment('right', state, dispatch),
					'Mod-Shift-:': (state, dispatch) =>
						ActionUtilities.setTextAlignment('center', state, dispatch),
					'Mod-Shift-"': (state, dispatch) =>
						ActionUtilities.setTextAlignment('justify', state, dispatch),
					'Mod-z': undo,
					'Mod-y': redo,
					'Mod-b': (state, dispatch, view) =>
						ActionUtilities.toggleTextMark('bold', state, dispatch, view),
					'Mod-i': (state, dispatch, view) =>
						ActionUtilities.toggleTextMark('italic', state, dispatch, view),
					'Mod-[': (state, dispatch) => ActionUtilities.dent('dedent', state, dispatch),
					'Mod-]': (state, dispatch) => ActionUtilities.dent('indent', state, dispatch),
					'Mod-u': (state, dispatch, view) =>
						ActionUtilities.toggleTextMark('underline', state, dispatch, view),
					'Mod-j': (state, dispatch, view) =>
						ActionUtilities.toggleTextMark('overline', state, dispatch, view)
};
export { builtInShortcuts };
