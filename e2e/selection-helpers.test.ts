import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	selectTextRange,
	selectWithKeyboard,
	selectionOffsets,
} from './fixtures/pagination-selection';

async function placeCaretAtEnd(editor: Locator) {
	await editor.focus();
	await editor.evaluate((root) => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let last = walker.nextNode()!;
		let next = walker.nextNode();
		while (next) {
			last = next;
			next = walker.nextNode();
		}
		window.getSelection()!.collapse(last, last.textContent!.length);
	});
	const length = (await editor.textContent())!.length;
	await expect
		.poll(() => selectionOffsets(editor))
		.toEqual({ anchor: length, focus: length, collapsed: true });
}

// These pages contain no application or ProseMirror listeners. Keep instrumentation
// local to the harness, including the option to withhold selectionchange delivery.
async function trackSelectionListeners(
	page: Page,
	options = { preventFirstArrow: false, suppressEvents: false },
) {
	return page.evaluateHandle((options) => {
		const add = document.addEventListener;
		const remove = document.removeEventListener;
		const listeners = new Set<EventListenerOrEventListenerObject>();
		let added = 0;
		let removed = 0;
		let arrows = 0;
		let installedBeforeKeys = false;
		const keydown = (event: Event) => {
			if (event instanceof KeyboardEvent && event.shiftKey && event.key === 'ArrowLeft') {
				arrows++;
				if (options.preventFirstArrow && arrows === 1) {
					event.preventDefault();
				}
			}
		};
		add.call(document, 'keydown', keydown);
		const suppressEvents = options.suppressEvents;
		document.addEventListener = function (
			type: string,
			listener: EventListenerOrEventListenerObject,
			options?: boolean | AddEventListenerOptions,
		) {
			if (type === 'selectionchange' && listener) {
				added++;
				listeners.add(listener);
				installedBeforeKeys = arrows === 0;
				if (suppressEvents) {
					return;
				}
			}
			add.call(document, type, listener, options);
		};
		document.removeEventListener = function (
			type: string,
			listener: EventListenerOrEventListenerObject,
			options?: boolean | EventListenerOptions,
		) {
			if (type === 'selectionchange' && listener) {
				const wasTracked = listeners.delete(listener);
				if (wasTracked) {
					removed++;
				}
			}
			remove.call(document, type, listener, options);
		};
		return {
			read: () => ({ added, removed, active: listeners.size, arrows, installedBeforeKeys }),
			dispose() {
				document.addEventListener = add;
				document.removeEventListener = remove;
				remove.call(document, 'keydown', keydown);
				for (const listener of listeners) {
					remove.call(document, 'selectionchange', listener);
				}
				listeners.clear();
			},
		};
	}, options);
}

test('keyboard selection follows logical text across rendered paragraph boundaries', async ({
	page,
}) => {
	await page.setContent('<div contenteditable="true"><p>first </p><p>second</p></div>');
	const editor = page.locator('[contenteditable]');
	await placeCaretAtEnd(editor);
	await selectWithKeyboard(page, 'first second');
	await expect
		.poll(() => selectionOffsets(editor))
		.toEqual({ anchor: 12, focus: 0, collapsed: false });
	await expect(editor).toBeFocused();
	const text = await editor.evaluate(() => ({
		rendered: window.getSelection()!.toString(),
		logical: window.getSelection()!.getRangeAt(0).toString(),
	}));
	expect(text.logical).toBe('first second');
	expect(text.rendered).not.toBe(text.logical);
});

test('keyboard selection crosses inline spans with exactly 18 real arrow presses', async ({
	page,
}) => {
	await page.setContent(
		'<div contenteditable="true"><span>first </span><strong>second</strong><span> third</span></div>',
	);
	const editor = page.locator('[contenteditable]');
	await placeCaretAtEnd(editor);
	const tracker = await trackSelectionListeners(page);
	try {
		await selectWithKeyboard(page, 'first second third');
		expect(await selectionOffsets(editor)).toEqual({ anchor: 18, focus: 0, collapsed: false });
		await expect(editor).toBeFocused();
		expect(await tracker.evaluate((state) => state.read())).toEqual({
			added: 1,
			removed: 1,
			active: 0,
			arrows: 18,
			installedBeforeKeys: true,
		});
	} finally {
		await tracker.evaluate((state) => state.dispose());
		await tracker.dispose();
	}
});

for (const [anchor, focus] of [
	[2, 10],
	[10, 2],
]) {
	test(`DOM range selection observes cross-block endpoints ${anchor} to ${focus} and focus`, async ({
		page,
	}) => {
		await page.setContent(
			'<div contenteditable="true"><p><span>first </span></p><p><em>second</em></p></div>',
		);
		const editor = page.locator('[contenteditable]');
		await placeCaretAtEnd(editor);
		const tracker = await trackSelectionListeners(page);
		try {
			await selectTextRange(editor, anchor, focus);
			expect(await selectionOffsets(editor)).toEqual({ anchor, focus, collapsed: false });
			await expect(editor).toBeFocused();
			expect(await editor.evaluate(() => window.getSelection()!.getRangeAt(0).toString())).toBe(
				'rst seco',
			);
			expect(await tracker.evaluate((state) => state.read())).toMatchObject({
				added: 1,
				removed: 1,
				active: 0,
				arrows: 0,
			});
		} finally {
			await tracker.evaluate((state) => state.dispose());
			await tracker.dispose();
		}
	});
}

test('a wrong keyboard range rejects with a diagnostic, cleans up, and can be selected again', async ({
	page,
}) => {
	await page.setContent('<div contenteditable="true">first second third</div>');
	const editor = page.locator('[contenteditable]');
	await placeCaretAtEnd(editor);
	const tracker = await trackSelectionListeners(page, {
		preventFirstArrow: true,
		suppressEvents: false,
	});
	try {
		await expect(selectWithKeyboard(page, 'first second third')).rejects.toThrow(
			'Keyboard selection and its delivered event must cover the exact logical text range',
		);
		expect(await selectionOffsets(editor)).toEqual({ anchor: 18, focus: 1, collapsed: false });
		expect(await tracker.evaluate((state) => state.read())).toMatchObject({
			added: 1,
			removed: 1,
			active: 0,
			arrows: 18,
		});
	} finally {
		await tracker.evaluate((state) => state.dispose());
		await tracker.dispose();
	}
	await placeCaretAtEnd(editor);
	const recovery = await trackSelectionListeners(page);
	try {
		await selectWithKeyboard(page, 'first second third');
		expect(await selectionOffsets(editor)).toEqual({ anchor: 18, focus: 0, collapsed: false });
		expect(await recovery.evaluate((state) => state.read())).toMatchObject({
			added: 1,
			removed: 1,
			active: 0,
			arrows: 18,
		});
	} finally {
		await recovery.evaluate((state) => state.dispose());
		await recovery.dispose();
	}
});

test('matching DOM endpoints without event observation reject and remove the listener', async ({
	page,
}) => {
	await page.setContent('<div contenteditable="true"><p>first </p><p>second</p></div>');
	const editor = page.locator('[contenteditable]');
	await placeCaretAtEnd(editor);
	const tracker = await trackSelectionListeners(page, {
		preventFirstArrow: false,
		suppressEvents: true,
	});
	try {
		await expect(selectTextRange(editor, 2, 10)).rejects.toThrow(
			'DOM range selection and its delivered event must match the requested endpoints',
		);
		expect(await selectionOffsets(editor)).toEqual({ anchor: 2, focus: 10, collapsed: false });
		await expect(editor).toBeFocused();
		expect(await tracker.evaluate((state) => state.read())).toMatchObject({
			added: 1,
			removed: 1,
			active: 0,
			arrows: 0,
		});
	} finally {
		await tracker.evaluate((state) => state.dispose());
		await tracker.dispose();
	}
});
