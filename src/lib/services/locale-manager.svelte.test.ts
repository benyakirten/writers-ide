import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseLocale, getLocale, locales, strategy } from '$lib/paraglide/runtime';
import LocaleManager, { LocaleState } from './locale-manager.svelte';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('client locale detection', () => {
	it('uses browser preferences with an explicit base-locale fallback', () => {
		expect(strategy).toEqual(['preferredLanguage', 'baseLocale']);
		expect(baseLocale).toBe('en');
		expect(locales).toEqual(['en', 'fr']);
	});

	it.each([
		{ languages: ['fr'], expected: 'fr' },
		{ languages: ['fr-CA', 'en-US'], expected: 'fr' },
		{ languages: ['de-DE', 'fr-FR', 'en'], expected: 'fr' },
		{ languages: ['en-US', 'fr'], expected: 'en' },
		{ languages: ['de-DE'], expected: 'en' },
		{ languages: [], expected: 'en' },
	])('resolves $languages to $expected', ({ languages, expected }) => {
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);

		expect(getLocale()).toBe(expected);
	});

	it('does not use cookies, storage, or URL prefixes as locale preferences', () => {
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en']);
		const originalUrl = window.location.href;
		document.cookie = 'PARAGLIDE_LOCALE=fr';
		localStorage.setItem('PARAGLIDE_LOCALE', 'fr');
		window.history.replaceState(null, '', '/fr');

		try {
			expect(getLocale()).toBe('en');
		} finally {
			document.cookie = 'PARAGLIDE_LOCALE=; Max-Age=0';
			localStorage.removeItem('PARAGLIDE_LOCALE');
			window.history.replaceState(null, '', originalUrl);
		}
	});
});

describe('LocaleState', () => {
	it('preserves base-locale initialization independently of browser detection', () => {
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr']);

		expect(getLocale()).toBe('fr');
		expect(new LocaleState().locale).toBe(baseLocale);
		expect(LocaleManager.locale).toBe(baseLocale);
	});

	it('keeps locale state writable and independent between instances', () => {
		const state = new LocaleState();
		state.locale = 'fr';

		expect(state.locale).toBe('fr');
		expect(new LocaleState().locale).toBe(baseLocale);
	});
});
