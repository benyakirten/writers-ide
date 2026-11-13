import { expect, type Locator, type Page } from '@playwright/test';

// A DOM selection can be correct before the browser has delivered selectionchange
// to the editor. Wait for that event, not a timeout or a private EditorView API.
export async function selectWithKeyboard(page: Page, text: string) {
	await Promise.all([
		page.evaluate(
			(expected) =>
				new Promise<void>((resolve) => {
					const changed = () => {
						if (window.getSelection()?.toString() === expected) {
							document.removeEventListener('selectionchange', changed);
							queueMicrotask(resolve);
						}
					};
					document.addEventListener('selectionchange', changed);
				}),
			text,
		),
		(async () => {
			for (let index = 0; index < text.length; index++) {
				await page.keyboard.press('Shift+ArrowLeft');
			}
		})(),
	]);
	await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text);
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
	await editor.evaluate(
		async (root, offsets) => {
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
			await new Promise<void>((resolve) => {
				document.addEventListener('selectionchange', () => queueMicrotask(resolve), { once: true });
				window.getSelection()!.setBaseAndExtent(...start, ...end);
			});
		},
		{ anchor, focus },
	);
	await expect.poll(() => selectionOffsets(editor)).toEqual({ anchor, focus, collapsed: false });
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
