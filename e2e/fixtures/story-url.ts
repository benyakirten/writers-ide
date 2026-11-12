export type StoryArg = string | number | boolean | null;

/** Storybook's URL-args grammar is not JSON; reject values it would silently sanitize. */
export function storyUrl(id: string, args: Record<string, StoryArg> = {}): string {
	const entries = Object.entries(args).map(([key, value]) => {
		if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
			throw new Error(`Unsupported story arg name: ${key}`);
		}
		if (typeof value === 'number' && !Number.isFinite(value)) {
			throw new Error(`Story arg ${key} must be finite.`);
		}
		if (
			(value !== null && !['string', 'number', 'boolean'].includes(typeof value)) ||
			(typeof value === 'number' && /e/i.test(String(value))) ||
			(typeof value === 'string' &&
				(!/^[a-zA-Z0-9 _-]*$/.test(value) || /^-?[0-9]+(\.[0-9]+)?$/.test(value)))
		) {
			throw new Error(
				`Story arg ${key} cannot be represented safely in Storybook URL args. Use a named fixture instead.`,
			);
		}
		return `${key}:${value === null ? '!null' : typeof value === 'boolean' ? `!${value}` : String(value)}`;
	});
	const query = new URLSearchParams({ id, viewMode: 'story' });
	if (entries.length > 0) {
		query.set('args', entries.join(';'));
	}
	return `/iframe.html?${query}`;
}
