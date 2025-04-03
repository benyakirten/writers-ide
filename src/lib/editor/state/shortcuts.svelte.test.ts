import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ShortcutService } from './shortcuts.svelte';

describe('ShortcutService', () => {
	let service: ShortcutService;
	const updateSpy = vi.fn();
	let unsub: null | (() => void);

	beforeEach(() => {
		service = new ShortcutService();
		unsub = service.subscribe(updateSpy);
	});

	afterEach(() => {
		unsub?.();
		updateSpy.mockClear();
	});

	describe('parse', () => {
		it('should return a string with a standardized order from a string', () => {
			expect(service.parse('ctrl+shift+A')).toBe('ctrl+shift+a');
			expect(service.parse('alt+ctrl+shift+meta')).toBe('meta+alt+ctrl+shift');
		});

		it('should return a string with a standardized order from an array', () => {
			expect(service.parse(['ctrl', 'shift', 'A'])).toBe('ctrl+shift+a');
			expect(service.parse(['alt', 'ctrl', 'shift', 'meta'])).toBe('meta+alt+ctrl+shift');
		});

		it('should return a string with a standardized order from a set', () => {
			expect(service.parse(new Set(['ctrl', 'shift', 'A']))).toBe('ctrl+shift+a');
			expect(service.parse(new Set(['alt', 'ctrl', 'shift', 'meta']))).toBe('meta+alt+ctrl+shift');
		});

		it('should lowercase any uppercase letters', () => {
			expect(service.parse('ctrl+shift+A')).toBe('ctrl+shift+a');
			expect(service.parse(['ctrl', 'shift', 'a'])).toBe('ctrl+shift+a');
			expect(service.parse(new Set(['ctrl', 'shift', 'a']))).toBe('ctrl+shift+a');
		});
	});

	describe('register', () => {
		it('should register a command with a valid shortcut', () => {
			const result = service.register('copy', 'ctrl+C');
			expect(result).toBe(true);
			expect(service.shortcutsToCommands.get('ctrl+c')).toBe('copy');
			expect(service.commandsToShortcuts.get('copy')).toBe('ctrl+c');
		});

		it('should not register a command with an invalid shortcut', () => {
			const result = service.register('copy', 'C');
			expect(result).toBe(false);
			expect(service.shortcutsToCommands.has('C')).toBe(false);
			expect(service.commandsToShortcuts.has('copy')).toBe(false);
		});
	});

	describe('addCommand', () => {
		it("should add the command with an empty shortcut if it doesn't already exist", () => {
			service.addCommand('copy');
			expect(service.commandsToShortcuts.get('copy')).toBe('');
		});

		it('should not override a preexisting command if it already exists', () => {
			service.register('copy', 'ctrl+c');
			service.addCommand('copy');
			expect(service.commandsToShortcuts.get('copy')).toBe('ctrl+c');
		});
	});

	describe('listen', () => {
		it('should emit an update if a command has been registered for the shortcut', () => {
			service.register('copy', 'ctrl+c');
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
			service.register('cmd1', 'ctrl+shift+A');
			service.register('cmd2', 'ctrl+shift+B');

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
		it('should not unset the command if a shortcut does not exist for the command', () => {
			service.commandsToShortcuts.set('copy', 'ctrl+c');

			const result = service.unset('copy');
			expect(result).toBe(false);
			expect(service.commandsToShortcuts.get('copy')).toBe('ctrl+c');
			expect(service.shortcutsToCommands.get('paste')).toBe(undefined);
		});

		it('should unset the command if it exists', () => {
			service.register('copy', 'ctrl+c');

			const result = service.unset('copy');

			expect(result).toBe(true);
			expect(service.commandsToShortcuts.get('copy')).toBe('');
			expect(service.shortcutsToCommands.get('ctrl+c')).toBe(undefined);
		});

		it("should not unset the command if it doesn't exist", () => {
			const result = service.unset('copy');

			expect(result).toBe(false);
			expect(service.commandsToShortcuts.get('copy')).toBe(undefined);
			expect(service.shortcutsToCommands.get('ctrl+c')).toBe(undefined);
		});
	});

	describe('removeShortcut', () => {
		it('should remove the shortcut from the command', () => {
			service.register('copy', 'ctrl+c');

			const result = service.removeShortcut('ctrl+c');

			expect(result).toBe(true);
			expect(service.commandsToShortcuts.get('copy')).toBe('');
			expect(service.shortcutsToCommands.get('ctrl+c')).toBe(undefined);
		});

		it('should not remove the command if there is not a corresponding entry in commandsToShortcuts', () => {
			service.shortcutsToCommands.set('ctrl+c', 'copy');
			const result = service.removeShortcut('ctrl+c');

			expect(result).toBe(false);
			expect(service.commandsToShortcuts.get('copy')).toBe(undefined);
			expect(service.shortcutsToCommands.get('ctrl+c')).toBe('copy');
		});

		it("should not remove the command if it doesn't exist", () => {
			const result = service.removeShortcut('ctrl+c');

			expect(result).toBe(false);
			expect(service.commandsToShortcuts.get('copy')).toBe(undefined);
			expect(service.shortcutsToCommands.get('ctrl+c')).toBe(undefined);
		});
	});
});
