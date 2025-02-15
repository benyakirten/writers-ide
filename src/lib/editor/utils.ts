export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

export function capitalizeAllWords(str: string): string {
	return str
		.split(' ')
		.map((word) => capitalize(word))
		.join(' ');
}
