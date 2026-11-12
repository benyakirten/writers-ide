import { describe, expect, it } from 'vitest';
import { storyUrl } from '../../../e2e/fixtures/story-url';

describe('Storybook URL arguments', () => {
	it('encodes the direct iframe ID and primitive arguments using Storybook grammar', () => {
		const url = new URL(
			storyUrl('performance-pagination-search--paragraph', {
				width: 480,
				linesToKeep: -1,
				enabled: true,
				label: 'hello world',
				missing: null,
				empty: '',
			}),
			'http://localhost',
		);
		expect(url.pathname).toBe('/iframe.html');
		expect(url.searchParams.get('id')).toBe('performance-pagination-search--paragraph');
		expect(url.searchParams.get('viewMode')).toBe('story');
		expect(url.searchParams.get('args')).toBe(
			'width:480;linesToKeep:-1;enabled:!true;label:hello world;missing:!null;empty:',
		);
	});

	it('omits empty args', () => {
		expect(storyUrl('example--default')).not.toContain('args=');
	});

	it.each(['a;b', 'a:b', '<script>', '🙂', '!null', 'a&b', '001', '-12'])(
		'rejects unsupported strings: %s',
		(label) => {
			expect(() => storyUrl('example--default', { label })).toThrow('cannot be represented safely');
		},
	);

	it.each([NaN, Infinity, -Infinity])('rejects nonfinite numbers: %s', (width) => {
		expect(() => storyUrl('example--default', { width })).toThrow('finite');
	});

	it('serializes false without losing its boolean type', () => {
		expect(
			new URL(
				storyUrl('example--default', { enabled: false }),
				'http://localhost',
			).searchParams.get('args'),
		).toBe('enabled:!false');
	});

	it('rejects numbers that Storybook would parse as strings', () => {
		expect(() => storyUrl('example--default', { width: 1e-7 })).toThrow(
			'cannot be represented safely',
		);
	});

	it('rejects complex values even from untyped callers', () => {
		// @ts-expect-error Exercise runtime validation for JavaScript callers.
		expect(() => storyUrl('example--default', { value: { nested: true } })).toThrow(
			'cannot be represented safely',
		);
	});

	it('rejects malformed arg names', () => {
		expect(() => storyUrl('example--default', { 'a:b': 1 })).toThrow('arg name');
	});
});
