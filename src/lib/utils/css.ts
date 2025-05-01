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
