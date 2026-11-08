export type AbsoluteCSSUnit = 'px' | 'in' | 'cm' | 'mm' | 'pt' | 'pc';

export function convertToPx(value: number, unit: AbsoluteCSSUnit): number {
	function conversionFactor(unit: AbsoluteCSSUnit): number {
		const pixelRatio = window.devicePixelRatio || 1;
		switch (unit) {
			case 'px':
				return 1;
			case 'in':
				return 96 * pixelRatio;
			case 'cm':
				return (96 / 2.54) * pixelRatio;
			case 'mm':
				return (96 / 25.4) * pixelRatio;
			case 'pt':
				return (96 / 72) * pixelRatio; // 1 point = 96 / 72 pixels
			case 'pc':
				return (96 / 72) * 12 * pixelRatio; // 1 pica = (96 / 72) * 12 pixels
		}
	}

	const factor = conversionFactor(unit);
	return value * factor;
}

export function isAbsoluteCSSUnit(value: string): value is AbsoluteCSSUnit {
	return (
		value === 'px' ||
		value === 'in' ||
		value === 'cm' ||
		value === 'mm' ||
		value === 'pt' ||
		value === 'pc'
	);
}

export function parseCSSMeasurement(lineHeight: string): number | null {
	const match = lineHeight.match(/(\d*\.?\d+)([a-zA-Z%]*)/);
	if (!match) {
		return null;
	}

	const value = parseFloat(match[1]);
	const unit = match[2] || 'px';

	if (!isAbsoluteCSSUnit(unit)) {
		return null;
	}

	return convertToPx(value, unit);
}

export function calculateTotalLinesOfText(el: HTMLElement, lineHeight: number): number {
	const height = el.getBoundingClientRect().height;
	return Math.round(height / lineHeight);
}

export function calculateOverflowingLinesOfText(
	el: HTMLElement,
	pageBottom: number,
	lineHeight: number,
): number {
	const elBottom = el.getBoundingClientRect().bottom;
	if (elBottom <= pageBottom) {
		return 0; // No overflowing lines
	}

	const overflowingPx = elBottom - pageBottom;
	return Math.floor(overflowingPx / lineHeight);
}

export function getLineHeight(el: HTMLElement): number {
	const { lineHeight, fontSize } = window.getComputedStyle(el);
	const parsedLineHeight = parseCSSMeasurement(lineHeight);
	if (parsedLineHeight !== null) {
		return parsedLineHeight;
	}

	const parsedFontSize = parseCSSMeasurement(fontSize);
	if (parsedFontSize !== null) {
		return parsedFontSize * 1.2; // Default line height is typically 1.2 times the font size
	}

	// TODO: Is this alright?
	return 16; // Fallback to a default value if parsing fails
}
