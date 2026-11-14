export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function swap<T>(items: T[], first: number, second: number): T[] {
	if (first < 0 || second < 0 || first >= items.length || second >= items.length) {
		throw new Error('Index out of bounds');
	}
	[items[first], items[second]] = [items[second], items[first]];
	return items;
}
