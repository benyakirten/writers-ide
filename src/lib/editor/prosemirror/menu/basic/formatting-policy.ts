export const INDENT_MAX = 8;
export const INDENT_MIN = 0;

export type TextAlignment = 'start' | 'end' | 'left' | 'center' | 'right' | 'justify';

export function clampIndent(value: number): number {
	return Math.min(Math.max(value, INDENT_MIN), INDENT_MAX);
}
