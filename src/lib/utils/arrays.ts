/**
 * Swaps two indexes of an array in place.
 */
export function swap<T>(array: T[], indexA: number, indexB: number): T[] {
	if (indexA < 0 || indexB < 0 || indexA >= array.length || indexB >= array.length) {
		throw new Error('Index out of bounds');
	}
	[array[indexA], array[indexB]] = [array[indexB], array[indexA]];
	return array;
}

/**
 * Copies an array and swaps two indexes.
 */
export function toSwapped<T>(array: T[], indexA: number, indexB: number): T[] {
	if (indexA < 0 || indexB < 0 || indexA >= array.length || indexB >= array.length) {
		throw new Error('Index out of bounds');
	}
	const newArray = [...array];
	[newArray[indexA], newArray[indexB]] = [newArray[indexB], newArray[indexA]];
	return newArray;
}

// TODO: Apply this where methods are used.
export function index<T extends { id: string }>(array: T[], index: string | number): T | undefined {
	if (typeof index === 'number') {
		return array[index];
	} else {
		return array.find((item) => item.id === index);
	}
}
