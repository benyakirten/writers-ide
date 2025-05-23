import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ShortcutService } from './shortcuts.svelte';

describe('ShortcutService', () => {
	let service: ShortcutService;
	const updateSpy = vi.fn();
	let unsub: () => void;

	beforeEach(() => {
		service = new ShortcutService();
		unsub = service.subscribe(updateSpy);
	});

	afterEach(() => {
		unsub();
		updateSpy.mockClear();
	});

	describe('shortcutsToCommands', () => {
		it('should be empty on initialization', () => {
			expect(service.shortcutsToCommands).toEqual({});
		});

		it("should not have any shortcuts for commands that haven't been registered", () => {
			service.register('copy', 'ctrl-c');
			expect(service.shortcutsToCommands['ctrl-c']).toEqual(['copy']);
			expect(service.shortcutsToCommands['ctrl-v']).toEqual(undefined);
		});

		it('should return an array of shortcuts for every command registered', () => {
			service.register('copy', 'ctrl-c');
			service.register('paste', 'ctrl-v');
			expect(service.shortcutsToCommands['ctrl-c']).toEqual(['copy']);
			expect(service.shortcutsToCommands['ctrl-v']).toEqual(['paste']);
		});

		it('should allow multiple commands to be registered for the same shortcut', () => {
			service.register('copy', 'ctrl-c');
			service.register('paste', 'ctrl-c');
			expect(service.shortcutsToCommands['ctrl-c']).toEqual(['copy', 'paste']);
		});
	});

	describe('display', () => {
		it('should render mac equivalents and not have a separator if the user agent is mac', () => {
			const got = service.display(
				'meta-ctrl-alt-shift-arrowup-arrowdown-arrowleft-arrowright-enter-backspace-delete',
				true
			);
			expect(got).toEqual('⌘⌃⌥⇧↑↓←→↩DeleteFnDelete');
		});

		it('should render windows equivalents and have a separator if the user agent is not mac', () => {
			const got = service.display(
				'meta-ctrl-alt-shift-arrowup-arrowdown-arrowleft-arrowright-enter-backspace-delete',
				false
			);
			expect(got).toEqual(
				'Win+Ctrl+Alt+Shift+UpArrow+DownArrow+LeftArrow+RightArrow+Enter+Backspace+Delete'
			);
		});
	});

	describe('parse', () => {
		it('should return a string with a standardized order from a string', () => {
			expect(service.parse('ctrl-shift-A')).toBe('ctrl-shift-a');
			expect(service.parse('alt-ctrl-shift-meta')).toBe('meta-alt-ctrl-shift');
		});

		it('should return a string with a standardized order from an array', () => {
			expect(service.parse(['ctrl', 'shift', 'A'])).toBe('ctrl-shift-a');
			expect(service.parse(['alt', 'ctrl', 'shift', 'meta'])).toBe('meta-alt-ctrl-shift');
		});

		it('should return a string with a standardized order from a set', () => {
			expect(service.parse(new Set(['ctrl', 'shift', 'A']))).toBe('ctrl-shift-a');
			expect(service.parse(new Set(['alt', 'ctrl', 'shift', 'meta']))).toBe('meta-alt-ctrl-shift');
		});

		it('should lowercase any uppercase letters', () => {
			expect(service.parse('ctrl-shift-A')).toBe('ctrl-shift-a');
			expect(service.parse(['ctrl', 'shift', 'a'])).toBe('ctrl-shift-a');
			expect(service.parse(new Set(['ctrl', 'shift', 'a']))).toBe('ctrl-shift-a');
		});
	});

	describe('register', () => {
		it('should register a command with a valid shortcut', () => {
			const got = service.register('copy', 'ctrl-C');
			expect(got).toBe(true);
			expect(service.shortcutsToCommands['ctrl-c']).toEqual(['copy']);
			expect(service.commandsToShortcuts['copy']).toBe('ctrl-c');
		});

		it('should not register a command with an invalid shortcut', () => {
			const got = service.register('copy', 'C');
			expect(got).toBe(false);
			expect(service.shortcutsToCommands['c']).toBe(undefined);
			expect(service.commandsToShortcuts['copy']).toBe(undefined);
		});
	});

	describe('addCommand', () => {
		it("should add the command with an empty shortcut if it doesn't already exist", () => {
			service.addCommand('copy');
			expect(service.commandsToShortcuts['copy']).toBe('');
		});

		it('should not override a preexisting command if it already exists', () => {
			service.register('copy', 'ctrl-c');
			service.addCommand('copy');
			expect(service.commandsToShortcuts['copy']).toBe('ctrl-c');
		});
	});

	describe('listen', () => {
		it('should emit an update if a command has been registered for the shortcut', () => {
			service.register('copy', 'ctrl-c');
			const event = new KeyboardEvent('keydown', {
				key: 'C',
				ctrlKey: true
			});

			service.listen(event);
			expect(updateSpy).toHaveBeenCalledWith('copy');
		});

		it('should not emit an update if the command has not been registered', () => {
			const event = new KeyboardEvent('keydown', {
				key: 'C',
				ctrlKey: true
			});

			service.listen(event);
			expect(updateSpy).not.toHaveBeenCalled();
		});
	});

	describe('emit', () => {
		let emitSub: (() => void) | null = null;
		const cmd1Spy = vi.fn();
		const cmd2Spy = vi.fn();
		afterEach(() => {
			cmd1Spy.mockClear();
			cmd2Spy.mockClear();
			emitSub?.();
			emitSub = null;
		});

		it('should call the callback for each registered command when it occurs', () => {
			service.register('cmd1', 'ctrl-shift-A');
			service.register('cmd2', 'ctrl-shift-B');

			emitSub = service.on({
				cmd1: cmd1Spy,
				cmd2: cmd2Spy
			});

			const event = new KeyboardEvent('keydown', {
				key: 'A',
				ctrlKey: true,
				shiftKey: true
			});
			service.listen(event);

			expect(cmd1Spy).toHaveBeenCalledOnce();
			expect(cmd2Spy).not.toHaveBeenCalled();

			const event2 = new KeyboardEvent('keydown', {
				key: 'B',
				ctrlKey: true,
				shiftKey: true
			});
			service.listen(event2);

			expect(cmd1Spy).toHaveBeenCalledOnce();
			expect(cmd2Spy).toHaveBeenCalledOnce();

			const event3 = new KeyboardEvent('keydown', {
				key: 'C',
				ctrlKey: true,
				shiftKey: true
			});
			service.listen(event3);

			expect(cmd1Spy).toHaveBeenCalledOnce();
			expect(cmd2Spy).toHaveBeenCalledOnce();
		});
	});

	describe('unset', () => {
		it('should unset the command if it exists', () => {
			service.register('copy', 'ctrl-c');

			const got = service.unset('copy');

			expect(got).toBe(true);
			expect(service.commandsToShortcuts['copy']).toBe('');
			expect(service.shortcutsToCommands['ctrl-c']).toBe(undefined);
		});

		it("should not unset the command if it doesn't exist", () => {
			const got = service.unset('copy');

			expect(got).toBe(false);
			expect(service.commandsToShortcuts['copy']).toBe(undefined);
			expect(service.shortcutsToCommands['ctrl-c']).toBe(undefined);
		});
	});

	describe('split', () => {
		it('should split a string into an array of strings', () => {
			const got = service.split('ctrl-shift-A');
			expect(got).toEqual(['ctrl', 'shift', 'a']);
		});

		it('should properly process consecutive dashes', () => {
			const got = service.split('---');
			expect(got).toEqual(['-', '-']);
		});
	});

	describe('get', () => {
		it('should return the command name for a given shortcut', () => {
			service.register('copy', 'ctrl-c');
			const e = new KeyboardEvent('keydown', {
				key: 'C',
				ctrlKey: true
			});
			const got = service.get(e);
			expect(got).toEqual(['copy']);
		});

		it("should return null if the shortcut doesn't exist", () => {
			const e = new KeyboardEvent('keydown', {
				key: 'C',
				ctrlKey: true
			});
			const got = service.get(e);
			expect(got).toBe(null);
		});
	});

	describe('process', () => {
		it('should return the shortcut generated for a keyboard event given event', () => {
			const e = new KeyboardEvent('keydown', {
				key: 'C',
				ctrlKey: true,
				altKey: true,
				shiftKey: true,
				metaKey: true
			});
			const got = service.process(e);
			expect(got).toBe('meta-alt-ctrl-shift-c');
		});
	});

	describe('shortcut', () => {
		it('should return the shortcut for a given command', () => {
			service.register('copy', 'ctrl-c');
			const got = service.shortcut('copy');
			expect(got).toEqual('ctrl-c');
		});

		it("should return null if the command doesn't exist", () => {
			const got = service.shortcut('copy');
			expect(got).toBeNull();
		});
	});

	describe('add', () => {
		it('should add multiple shortcuts to the service', () => {
			const shortcuts = {
				copy: 'ctrl-c',
				paste: 'ctrl-v'
			};

			service.add(shortcuts);

			expect(service.shortcutsToCommands['ctrl-c']).toEqual(['copy']);
			expect(service.shortcutsToCommands['ctrl-v']).toEqual(['paste']);
			expect(service.commandsToShortcuts['copy']).toEqual('ctrl-c');
			expect(service.commandsToShortcuts['paste']).toEqual('ctrl-v');
		});
	});
});
