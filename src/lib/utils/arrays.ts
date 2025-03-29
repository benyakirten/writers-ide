/**
 * Swaps two indexes of an array in place.
 */
export function swap<T>(array: T[], indexA: number, indexB: number): T[] {
	[array[indexA], array[indexB]] = [array[indexB], array[indexA]];
	return array;
}
