export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function mod(n1: number, n2: number): number {
	return ((n1 % n2) + n2) % n2;
}
