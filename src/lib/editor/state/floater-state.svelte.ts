import { clamp } from '$lib/utils/numbers';
import { IdGenerator } from '$lib/services/ids';
import { BarItems, type BarMetadata } from './bar-items.svelte';

export type FloatingPosition = {
	top: number;
	left: number;
	width: number;
	height: number;
};

export type FloatingBar = BarMetadata & {
	position: FloatingPosition;
	data: BarItems;
	z: number;
	id: string;
	title: string;
	minimized: boolean;
};

export class FloaterBarState {
	readonly TOLERANCE = 8;
	readonly OFFSET = 2;
	readonly MIN_WIDTH_PX = 200;
	readonly MAX_WIDTH_PX = 400;
	readonly MIN_HEIGHT_PX = 100;
	readonly MAX_HEIGHT_PERCENT = 90;
	readonly DEFAULT_HEIGHT_PERCENT = 80;
	readonly DEFAULT_WIDTH_PERCENT = 20;
	readonly DEFAULT_TOP_PX = 20;
	readonly DEFAULT_LEFT_PX = 20;
	readonly NUDGE_PERCENT = 0.5;
	readonly EDGE_BUFFER_PX = 3;
	readonly BASE_Z = 10;

	root: HTMLElement | null = null;
	bars = $state<FloatingBar[]>([]);
	visibleBars = $derived(this.bars.filter((bar) => !bar.minimized));
	minimizedBars = $derived(this.bars.filter((bar) => bar.minimized));
	titleNumbers = $derived.by<Map<string, number>>(() => {
		const titles = new Map<string, number>();
		const existingTitles = new Map<string, number>();

		for (const { title, id } of this.bars) {
			const _title = title.toLowerCase().trim();
			const existingTitleOccurrences = existingTitles.get(_title) ?? 0;
			titles.set(id, existingTitleOccurrences);

			existingTitles.set(_title, existingTitleOccurrences + 1);
		}

		return titles;
	});

	highestBar = $derived.by(() => {
		let highestBar: FloatingBar | null = null;
		for (const bar of this.bars) {
			if (!highestBar) {
				highestBar = bar;
			} else if (bar.z > highestBar.z) {
				highestBar = bar;
			}
		}
		return highestBar;
	});

	dragging: {
		id: string;
		x: number;
		y: number;
	} | null = $state(null);

	bar(id: string | number): FloatingBar | undefined {
		if (typeof id === 'number') {
			return this.bars.at(id);
		}

		return this.bars.find((bar) => bar.id === id);
	}

	findNextOpenPosition(from?: { top: number; left: number }): { top: number; left: number } {
		if (!this.root) {
			return { top: this.DEFAULT_TOP_PX, left: this.DEFAULT_LEFT_PX };
		}

		const { clientWidth, clientHeight } = this.root;

		const leftDistance = (this.OFFSET / 100) * clientWidth;
		const topDistance = (this.OFFSET / 100) * clientHeight;
		if (!from) {
			return { top: topDistance, left: leftDistance };
		}

		// We don't want to create a floating barr off screen
		// At most, the bar's bottom should touch the bottom of the screen
		const maxLeftPercentage = (100 - (this.DEFAULT_WIDTH_PERCENT + this.OFFSET)) / 100;
		const left =
			from.left >= maxLeftPercentage * clientWidth
				? from.left - leftDistance
				: from.left + leftDistance;

		const maxTopPercentage = (100 - (this.DEFAULT_HEIGHT_PERCENT + this.OFFSET)) / 100;
		const top =
			from.top >= maxTopPercentage * clientHeight ? from.top - topDistance : from.top + topDistance;

		return { left, top };
	}

	determineStartingCoordinates({ top, left }: { left?: number; top?: number }): {
		top: number;
		left: number;
	} {
		// If they have a top and left, use it.
		// If they only have a top, find the next open left position and use that
		// If they only have a left, use that and an automatically generated top
		// If they have neither, find the next open position
		if (top !== undefined && left !== undefined) {
			return { top, left };
		}

		if (left !== undefined) {
			const nearbyBar = this.bars.find(
				(bar) =>
					bar.position.left - this.TOLERANCE < left && bar.position.left + this.TOLERANCE > left,
			);
			const nearbyTop = nearbyBar?.position.top ?? 0;
			return { top: nearbyTop + this.DEFAULT_TOP_PX, left };
		}

		const { top: nextTop, left: nextLeft } = this.findNextOpenPosition(this.highestBar?.position);
		return { top: top ?? nextTop, left: nextLeft };
	}

	determineStartingZ(defaultZ?: number): number {
		if (defaultZ) {
			return Math.max(this.BASE_Z, defaultZ);
		}
		if (this.highestBar) {
			return this.highestBar.z + 1;
		}
		return this.BASE_Z;
	}

	determineStartingMeasurements(
		startingWidth?: number,
		startingHeight?: number,
	): { width: number; height: number } {
		if (startingWidth && startingHeight) {
			return { width: startingWidth, height: startingHeight };
		}

		if (!this.root) {
			return { width: this.MIN_WIDTH_PX, height: this.MIN_HEIGHT_PX };
		}

		const { clientWidth, clientHeight } = this.root;

		let width = (clientWidth * this.DEFAULT_WIDTH_PERCENT) / 100;
		width = clamp(width, this.MIN_WIDTH_PX, this.MAX_WIDTH_PX);

		let height = (clientHeight * this.DEFAULT_HEIGHT_PERCENT) / 100;
		height = Math.max(height, this.MIN_HEIGHT_PX);

		return { width: startingWidth ?? width, height: startingHeight ?? height };
	}

	// TODO: Determine if this function is needed.
	removeZGaps(): void {
		const bars = this.bars.toSorted((a, b) => a.z - b.z);
		let nextZ = this.BASE_Z;
		for (const bar of bars) {
			if (bar.z !== nextZ) {
				const originalBar = this.bar(bar.id);
				if (originalBar) {
					originalBar.z = nextZ;
				}
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
			data?: string[];
			isVertical?: boolean;
			id?: string;
			minimized?: boolean;
			title?: string;
		} = {},
	): FloatingBar {
		const position = this.determineStartingCoordinates({
			top: startingInformation.top,
			left: startingInformation.left,
		});

		const z = this.determineStartingZ(startingInformation.z);
		const { width, height } = this.determineStartingMeasurements(
			startingInformation.width,
			startingInformation.height,
		);

		const barData = new BarItems(startingInformation.isVertical ?? true, startingInformation.data);
		const bar: FloatingBar = {
			position: {
				...position,
				width,
				height,
			},
			z,
			data: barData,
			id: startingInformation.id ?? IdGenerator.generate(),
			minimized: !!startingInformation.minimized,
			title: startingInformation.title ?? 'New Bar',
		};

		this.bars.push(bar);
		return bar;
	}

	setOrientation(id: string | number, vertical: boolean): boolean {
		return this.bar(id)?.data.setOrientation(vertical) ?? false;
	}

	setPosition(id: string | number, left: number, top: number): boolean {
		const bar = this.bar(id);
		if (!bar || !Number.isFinite(left) || !Number.isFinite(top)) {
			return false;
		}
		const maxLeft = this.root
			? Math.max(0, this.root.clientWidth - bar.position.width - this.EDGE_BUFFER_PX)
			: Number.MAX_SAFE_INTEGER;
		const maxTop = this.root
			? Math.max(0, this.root.clientHeight - bar.position.height - this.EDGE_BUFFER_PX)
			: Number.MAX_SAFE_INTEGER;
		const nextLeft = clamp(left, 0, maxLeft);
		const nextTop = clamp(top, 0, maxTop);
		if (bar.position.left !== nextLeft) {
			bar.position.left = nextLeft;
		}
		if (bar.position.top !== nextTop) {
			bar.position.top = nextTop;
		}
		return true;
	}

	fitToRoot(): void {
		for (const bar of this.bars) {
			this.setPosition(bar.id, bar.position.left, bar.position.top);
		}
	}

	focus(id: string | number): FloatingBar | null {
		if (this.bars.length < 2) {
			return null;
		}

		const bar = this.bar(id);
		if (!bar || bar.id === this.highestBar?.id) {
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
		return true;
	}

	updateMeasurements(id: string | number, width: number, height: number): FloatingBar | null {
		const bar = this.bar(id);
		if (!bar) {
			return null;
		}

		const nextWidth = clamp(width, this.MIN_WIDTH_PX, this.MAX_WIDTH_PX);
		const maxHeight = this.root
			? Math.max(this.MIN_HEIGHT_PX, (this.MAX_HEIGHT_PERCENT * this.root.clientHeight) / 100)
			: Infinity;
		const nextHeight = clamp(height, this.MIN_HEIGHT_PX, maxHeight);
		const changed = bar.position.width !== nextWidth || bar.position.height !== nextHeight;
		if (bar.position.width !== nextWidth) {
			bar.position.width = nextWidth;
		}
		if (bar.position.height !== nextHeight) {
			bar.position.height = nextHeight;
		}
		// A root resize can invalidate coordinates even when the measured size is unchanged.
		this.setPosition(bar.id, bar.position.left, bar.position.top);

		return changed ? bar : null;
	}

	startDragging(id: string | number, e: MouseEvent): boolean {
		const bar = this.bar(id);
		if (!bar) {
			return false;
		}

		this.dragging = {
			id: bar.id,
			x: e.clientX,
			y: e.clientY,
		};
		return true;
	}

	stopDragging(): void {
		this.dragging = null;
	}

	move(e: MouseEvent): boolean {
		if (!this.dragging || !this.root) {
			return false;
		}

		const bar = this.bar(this.dragging.id);
		if (!bar) {
			return false;
		}

		const { clientX, clientY } = e;

		const deltaX = clientX - this.dragging.x;
		const deltaY = clientY - this.dragging.y;

		const { left, top } = bar.position;
		const x = left + deltaX;
		const y = top + deltaY;

		this.setPosition(bar.id, x, y);

		this.dragging.x = clientX;
		this.dragging.y = clientY;

		return true;
	}

	nudge(id: string | number, direction: 'up' | 'left' | 'down' | 'right'): boolean {
		const bar = this.bar(id);
		if (!bar || !this.root) {
			return false;
		}

		const { width, height, top, left } = bar.position;
		const clientWidth = this.root.clientWidth;
		const clientHeight = this.root.clientHeight;

		const delta =
			(this.NUDGE_PERCENT / 100) *
			(direction === 'up' || direction === 'down' ? clientHeight : clientWidth);
		switch (direction) {
			case 'up':
				bar.position.top = Math.max(top - delta, 0);
				break;
			case 'left':
				bar.position.left = Math.max(left - delta, 0);
				break;
			case 'down':
				bar.position.top = clamp(
					top + delta,
					0,
					Math.max(0, clientHeight - height - this.EDGE_BUFFER_PX),
				);
				break;
			case 'right':
				bar.position.left = clamp(
					left + delta,
					0,
					Math.max(0, clientWidth - width - this.EDGE_BUFFER_PX),
				);
				break;
		}

		return true;
	}

	update<Key extends 'title' | 'minimized', Value extends FloatingBar[Key]>(
		id: string | number,
		key: Key,
		value: Value,
	) {
		const bar = this.bar(id);
		if (!bar) {
			return null;
		}

		bar[key] = value;
		return bar;
	}
}

const floaterBarState = new FloaterBarState();
export default floaterBarState;
