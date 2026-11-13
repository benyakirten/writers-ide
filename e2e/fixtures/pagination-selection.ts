import { expect, type Locator, type Page } from '@playwright/test';

// Install and acknowledge observation before input. A browser Selection string
// includes rendered paragraph/page separators; Range text contains authored text.
async function observeSelection(editor: Locator) {
	return editor.evaluateHandle((root) => {
		const read = () => {
			const selection = window.getSelection();
			const offset = (node: Node | null, position: number) => {
				if (!node || !root.contains(node)) {
					return -1;
				}
				const range = document.createRange();
				range.selectNodeContents(root);
				range.setEnd(node, position);
				return range.toString().length;
			};
			return {
				text: selection?.rangeCount ? selection.getRangeAt(0).toString() : null,
				rendered: selection?.toString() ?? null,
				anchor: offset(selection?.anchorNode ?? null, selection?.anchorOffset ?? 0),
				focus: offset(selection?.focusNode ?? null, selection?.focusOffset ?? 0),
				collapsed: selection?.isCollapsed ?? true,
				focused: document.activeElement === root,
			};
		};
		let observed: ReturnType<typeof read> | null = null;
		let disposed = false;
		const changed = () => {
			// Let all synchronous selectionchange handlers finish before acknowledging.
			queueMicrotask(() => {
				if (!disposed) {
					observed = read();
				}
			});
		};
		document.addEventListener('selectionchange', changed);
		return {
			read,
			get observed() {
				return observed;
			},
			dispose() {
				disposed = true;
				document.removeEventListener('selectionchange', changed);
				observed = null;
			},
		};
	});
}

export async function selectWithKeyboard(page: Page, text: string) {
	const editor = page.locator('[contenteditable="true"]:focus');
	await expect(editor).toHaveCount(1);
	const observer = await observeSelection(editor);
	try {
		const initial = await observer.evaluate((state) => state.read());
		expect(initial).toMatchObject({ collapsed: true, focused: true });
		for (let index = 0; index < text.length; index++) {
			await page.keyboard.press('Shift+ArrowLeft');
		}
		const expected = {
			text,
			anchor: initial.anchor,
			focus: initial.anchor - text.length,
			collapsed: false,
			focused: true,
		};
		await expect
			.poll(
				() =>
					observer.evaluate((state) => ({
						current: state.read(),
						observed: state.observed,
					})),
				{
					message:
						'Keyboard selection and its delivered event must cover the exact logical text range',
				},
			)
			.toMatchObject({ current: expected, observed: expected });
	} finally {
		try {
			await observer.evaluate((state) => state.dispose());
		} finally {
			await observer.dispose();
		}
	}
}

// Logical text offsets deliberately ignore model-only page/paragraph wrappers.
export async function selectionOffsets(editor: Locator) {
	return editor.evaluate((root) => {
		const selection = window.getSelection()!;
		const offset = (node: Node | null, position: number) => {
			if (!node || !root.contains(node)) {
				return -1;
			}
			const range = document.createRange();
			range.selectNodeContents(root);
			range.setEnd(node, position);
			return range.toString().length;
		};
		return {
			anchor: offset(selection.anchorNode, selection.anchorOffset),
			focus: offset(selection.focusNode, selection.focusOffset),
			collapsed: selection.isCollapsed,
		};
	});
}

export async function selectTextRange(editor: Locator, anchor: number, focus: number) {
	const observer = await observeSelection(editor);
	try {
		await editor.evaluate(
			(root, offsets) => {
				const point = (offset: number): [Node, number] => {
					const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
					let node = walker.nextNode();
					while (node) {
						if (offset <= node.textContent!.length) {
							return [node, offset];
						}
						offset -= node.textContent!.length;
						node = walker.nextNode();
					}
					throw new Error('Selection offset is outside the document');
				};
				const start = point(offsets.anchor);
				const end = point(offsets.focus);
				window.getSelection()!.setBaseAndExtent(...start, ...end);
			},
			{ anchor, focus },
		);
		const expected = { anchor, focus, collapsed: anchor === focus, focused: true };
		await expect
			.poll(
				() =>
					observer.evaluate((state) => ({
						current: state.read(),
						observed: state.observed,
					})),
				{
					message: 'DOM range selection and its delivered event must match the requested endpoints',
				},
			)
			.toMatchObject({ current: expected, observed: expected });
	} finally {
		try {
			await observer.evaluate((state) => state.dispose());
		} finally {
			await observer.dispose();
		}
	}
}

export async function replaceDocument(page: Page, editor: Locator, text: string) {
	// A layout catch-up dialog makes the editor inert. DOM focus() can silently
	// fail in that state; retry only focus acquisition, never the destructive input.
	await expect
		.poll(
			async () => {
				await editor.focus();
				return editor.evaluate((root) => document.activeElement === root);
			},
			{ message: 'The editor must acquire keyboard focus before document replacement' },
		)
		.toBe(true);
	await page.keyboard.press('ControlOrMeta+a');
	await expect
		.poll(
			() =>
				editor.evaluate((root) => {
					const selection = window.getSelection();
					if (
						!selection ||
						selection.rangeCount === 0 ||
						!root.contains(selection.anchorNode) ||
						!root.contains(selection.focusNode)
					) {
						return false;
					}
					return selection.getRangeAt(0).cloneContents().textContent === root.textContent;
				}),
			{ message: 'Select-all must cover the editor contents before replacement input' },
		)
		.toBe(true);
	await expect(editor).toBeFocused();
	await page.keyboard.insertText(text);
	await expect.poll(() => editor.textContent()).toBe(text);
}
