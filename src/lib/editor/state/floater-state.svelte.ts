import { clamp } from '../utils.js';

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
	minimized: boolean;
};

class FloaterState {
	readonly TOLERANCE = 2;
	readonly OFFSET = 2;
	readonly MIN_WIDTH_PX = 200;
	readonly MAX_WIDTH_PX = 400;
	readonly MIN_HEIGHT_PX = 100;
	readonly MAX_HEIGHT_PERCENT = 90;
	readonly DEFAULT_HEIGHT_PERCENT = 80;
	readonly DEFAULT_WIDTH_PERCENT = 20;
	readonly FULL_WIDTH = 100;
	readonly FULL_HEIGHT = 100;

	root: HTMLElement | null = null;
	bars = $state<FloatingBar[]>([
		{
			position: {
				top: 2,
				left: 2,
				width: 200,
				height: 800
			},
			z: 10,
			id: 'floater-1',
			minimized: false
		}
	]);
	highestBar = $derived.by(() => {
		let highestBar: FloatingBar | null = null;
		for (const bar of this.bars) {
			if (!highestBar) {
				highestBar = bar;
			} else if (highestBar.z < bar.z) {
				highestBar = bar;
			}
		}
		return highestBar;
	});
	dragging: string | null = null;

	bar(id: string | number): FloatingBar | undefined {
		if (typeof id === 'number') {
			return this.bars.at(id);
		}

		return this.bars.find((bar) => bar.id === id);
	}

	findNextOpenPosition(from?: FloatingPosition): { top: number; left: number } {
		if (!from) {
			return { top: this.OFFSET, left: this.OFFSET };
		}

		const left =
			from.left >= this.FULL_HEIGHT - (this.DEFAULT_WIDTH_PERCENT + this.OFFSET)
				? from.left - this.OFFSET
				: from.left + this.OFFSET;
		const top =
			from.top >= this.FULL_HEIGHT - (this.DEFAULT_HEIGHT_PERCENT + this.OFFSET)
				? from.top - this.OFFSET
				: from.top + this.OFFSET;

		return { top, left };
	}

	determineStartingCoordinates({ top, left }: { left?: number; top?: number }): {
		top: number;
		left: number;
	} {
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

		const { top: nextTop, left: nextLeft } = this.findNextOpenPosition(this.highestBar?.position);
		return { top: top ?? nextTop, left: nextLeft };
	}

	determineStartingZ(defaultZ?: number): number {
		if (defaultZ) {
			return Math.min(BASE_FLOATER_Z, defaultZ);
		}
		if (this.highestBar) {
			return this.highestBar.z;
		}
		return BASE_FLOATER_Z;
	}

	determineStartingMeasurements(
		startingWidth?: number,
		startingHeight?: number
	): { width: number; height: number } {
		if (startingWidth && startingHeight) {
			return { width: startingWidth, height: startingHeight };
		}

		if (!this.root) {
			return { width: this.MIN_WIDTH_PX, height: this.MIN_HEIGHT_PX };
		}

		let { width, height } = this.root.getBoundingClientRect();

		width *= this.DEFAULT_WIDTH_PERCENT / this.FULL_WIDTH;
		width = Math.max(this.MIN_WIDTH_PX, width);

		height *= this.DEFAULT_HEIGHT_PERCENT / this.FULL_HEIGHT;
		height = Math.max(this.MIN_HEIGHT_PX, height);

		return { width: startingWidth ?? width, height: startingHeight ?? height };
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
			minimized?: boolean;
		} = {}
	): FloatingBar {
		const position = this.determineStartingCoordinates({
			top: startingInformation.top,
			left: startingInformation.left
		});

		const z = this.determineStartingZ(startingInformation.z) + 1;
		const id = startingInformation.id ?? crypto.randomUUID();
		const { width, height } = this.determineStartingMeasurements(
			startingInformation.width,
			startingInformation.height
		);

		const bar: FloatingBar = {
			position: {
				...position,
				width,
				height
			},
			z,
			data: startingInformation.data,
			id,
			minimized: !!startingInformation.minimized
		};

		this.bars.push(bar);
		return bar;
	}

	focus(id: string | number): FloatingBar | null {
		if (
			this.bars.length < 2 ||
			(typeof id === 'string' && this.highestBar?.id === id) ||
			(typeof id === 'number' && this.highestBar?.id === this.bars.at(id)?.id)
		) {
			return null;
		}

		const bar = this.bar(id);
		if (!bar) {
			return null;
		}

		const highestBar = this.highestBar;
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

	updateMeasurements(id: string | number, width: number, height: number): FloatingBar | null {
		const bar = this.bar(id);
		if (!bar) {
			return null;
		}

		bar.position.width = clamp(width, this.MIN_WIDTH_PX, this.MAX_WIDTH_PX);
		bar.position.height = clamp(
			height,
			this.MIN_HEIGHT_PX,
			this.root ? this.MAX_HEIGHT_PERCENT * this.root.clientHeight : height
		);

		return bar;
	}

	startDragging(id: string | number): boolean {
		const bar = this.bar(id);
		if (!bar) {
			return false;
		}

		this.dragging = bar.id;
		return true;
	}

	move(e: MouseEvent & { currentTarget: HTMLElement }) {
		if (!this.dragging || !this.root) {
			return;
		}

		const bar = this.bar(this.dragging);
		if (!bar) {
			return;
		}

		const { width, height } = bar.position;
		const { clientX, clientY } = e;
		const { left, top } = this.root.getBoundingClientRect();
		const x = clientX - left - width / 2;
		const y = clientY - top - height / 2;

		bar.position.left = clamp(x, 0, this.root.clientWidth - width);
		bar.position.top = clamp(y, 0, this.root.clientHeight - height);
	}
}

const floaterState = new FloaterState();
export default floaterState;
