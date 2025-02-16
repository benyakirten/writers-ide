const BASE_FLOATER_Z = 10;

export type FloatingPosition = {
	top: number;
	left: number;
	width: number;
	height: number;
};

export type FloatingBar = {
	position: FloatingPosition;
	data?: null;
	z: number;
	id: string;
};

class FloaterState {
	readonly TOLERANCE = 2;
	readonly OFFSET = 2;
	readonly DEFAULT_HEIGHT = 80;
	readonly FULL_HEIGHT = 100;

	bars = $state<FloatingBar[]>([]);

	bar(id: string | number): FloatingBar | undefined {
		if (typeof id === 'number') {
			return this.bars.at(id);
		}

		return this.bars.find((bar) => bar.id === id);
	}

	highestBar(): FloatingBar | null {
		let highestBar: FloatingBar | null = null;
		for (const bar of this.bars) {
			if (!highestBar) {
				highestBar = bar;
			} else if (highestBar.z < bar.z) {
				highestBar = bar;
			}
		}
		return highestBar;
	}

	findNextOpenPosition(from?: FloatingPosition): { top: number; left: number } {
		if (!from) {
			return { top: this.OFFSET, left: this.OFFSET };
		}

		const left =
			from.left > this.FULL_HEIGHT - (this.DEFAULT_HEIGHT + this.OFFSET)
				? from.left - this.OFFSET
				: from.left + this.OFFSET;
		const top =
			from.top > this.FULL_HEIGHT - (this.DEFAULT_HEIGHT + this.OFFSET)
				? from.top - this.OFFSET
				: from.top + this.OFFSET;
		return { top, left };
	}

	determineStartingCoordinates(
		{ top, left }: { left?: number; top?: number },
		highestBar?: FloatingPosition
	): { top: number; left: number } {
		// If they have a top and left, use it.
		// If they only have a top, find the next open left position and use that
		// If they only have a left, use that and an automatically generated top
		// If they have neither, find the next open position
		if (top && left) {
			return { top, left };
		}

		if (left) {
			const nearbyBar = this.bars.find(
				(bar) =>
					bar.position.left - this.TOLERANCE < left && bar.position.left + this.TOLERANCE > left
			);
			const nearbyTop = nearbyBar?.position.top ?? 0;
			return { top: nearbyTop + this.OFFSET, left };
		}

		const { top: nextTop, left: nextLeft } = this.findNextOpenPosition(highestBar);
		return { top: top ?? nextTop, left: left ?? nextLeft };
	}

	determineStartingZ(defaultZ?: number, highestZ?: number): number {
		if (defaultZ) {
			return Math.min(BASE_FLOATER_Z, defaultZ);
		}
		if (highestZ) {
			return highestZ;
		}
		return BASE_FLOATER_Z;
	}

	sortBarsByZIndex(): void {
		this.bars.sort((a, b) => a.z - b.z);
		let nextZ = BASE_FLOATER_Z;
		for (const bar of this.bars) {
			if (bar.z !== nextZ) {
				bar.z = nextZ;
			}
			nextZ += 1;
		}
	}

	add(
		startingInformation: {
			top?: number;
			left?: number;
			width?: number;
			height?: number;
			z?: number;
			data?: null;
			id?: string;
		} = {}
	): FloatingBar {
		const highestBar = this.highestBar();
		const position = this.determineStartingCoordinates(
			{ top: startingInformation.top, left: startingInformation.left },
			highestBar?.position
		);

		const z = this.determineStartingZ(startingInformation.z, highestBar?.z);
		const id = startingInformation.id ?? crypto.randomUUID();

		const bar = {
			position: { ...position, width: this.DEFAULT_HEIGHT, height: this.DEFAULT_HEIGHT },
			z,
			data: startingInformation.data,
			id
		};

		this.bars.push(bar);
		return bar;
	}

	moveToTop(id: string | number): FloatingBar | null {
		if (this.bars.length < 2) {
			return null;
		}

		const bar = this.bar(id);
		if (!bar) {
			return null;
		}

		const highestBar = this.highestBar();
		if (highestBar && highestBar.z > bar.z) {
			bar.z = highestBar.z + 1;
		}

		return bar;
	}

	remove(id: string | number): boolean {
		const bar = this.bar(id);
		if (!bar) {
			return false;
		}

		this.bars = this.bars.filter((b) => b.id !== bar.id);
		this.sortBarsByZIndex();
		return true;
	}
}

const floaterState = new FloaterState();
export default floaterState;
