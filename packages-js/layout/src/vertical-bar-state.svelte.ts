import type { BarItemSection } from './bar-item-registry.svelte';
import type { BarItems, BarMetadata } from './bar-items.svelte';
import type { LayoutServices } from './services';

export type VerticalBar<S extends BarItemSection = BarItemSection> = BarMetadata & {
	width: number;
	visible: boolean;
	id: string;
	data: BarItems<S>;
};

export enum HorizontalTextDirection {
	LTR = 'LTR',
	RTL = 'RTL',
}

export enum VerticalBarPosition {
	InlineStart = 'INLINE_START',
	InlineEnd = 'INLINE_END',
}

export class VerticalBarState<S extends BarItemSection = BarItemSection> {
	inlineStart: VerticalBar<S>[] = $state([]);
	inlineEnd: VerticalBar<S>[] = $state([]);
	resizedSection: {
		id: string;
		x: number;
		resized: boolean;
		position: VerticalBarPosition;
	} | null = $state(null);

	constructor(
		private readonly services: LayoutServices<S>,
		public readonly minSize = 200,
		inlineStart: VerticalBar<S>[] = [],
		inlineEnd: VerticalBar<S>[] = [],
	) {
		this.inlineStart = this.inlineStart.concat(inlineStart);
		this.inlineEnd = this.inlineEnd.concat(inlineEnd);
	}

	add(
		{
			width = this.minSize,
			id = this.services.generateId(),
			visible = true,
			data,
			...metadata
		}: Partial<Omit<VerticalBar<S>, 'data'>> & { data?: string[] },
		position: VerticalBarPosition,
		index: number = -1,
	): VerticalBar<S> {
		const bars = this.bars(position);
		const existingBar = bars.find((bar) => bar.id === id);
		if (existingBar) {
			return existingBar;
		}

		const barData = this.services.createItems(true, data);
		const bar = { ...metadata, width, id, visible, data: barData };

		if (index < 0 || index >= bars.length) {
			bars.push(bar);
		} else {
			bars.splice(index, 0, bar);
		}

		return bar;
	}

	remove(id: string | number, position: VerticalBarPosition): boolean {
		const bars = position === VerticalBarPosition.InlineStart ? this.inlineStart : this.inlineEnd;
		const index = typeof id === 'string' ? bars.findIndex((bar) => bar.id === id) : id;
		if (index === -1) {
			return false;
		}

		bars.splice(index, 1);
		return true;
	}

	bars(position: VerticalBarPosition): VerticalBar<S>[] {
		return position === VerticalBarPosition.InlineStart ? this.inlineStart : this.inlineEnd;
	}

	bar(id: string | number, position: VerticalBarPosition): VerticalBar<S> | undefined {
		const bars = this.bars(position);
		const bar = typeof id === 'number' ? bars.at(id) : bars.find((bar) => bar.id === id);
		return bar;
	}

	width(bar: VerticalBar<S>): number {
		return bar.width >= this.minSize && bar.visible ? bar.width : 0;
	}

	widthOf(id: string | number, position: VerticalBarPosition): number | undefined {
		const bar = this.bar(id, position);
		return bar ? this.width(bar) : undefined;
	}

	toggleBar(bar: VerticalBar<S>) {
		if (bar.visible) {
			bar.visible = false;
			return;
		}

		bar.visible = true;
		if (bar.width < this.minSize) {
			bar.width = this.minSize;
		}
	}

	toggle(id: string | number, position: VerticalBarPosition): boolean {
		const bar = this.bar(id, position);

		// Cannot toggle bar if the bar is being resized.
		// This is to fix that the mouseup listener is not removed when the bar is toggled.
		if (!bar || (this.resizedSection?.resized && this.resizedSection.id === id)) {
			return false;
		}
		this.toggleBar(bar);
		return true;
	}

	startResize(id: string, position: VerticalBarPosition, x: number) {
		this.resizedSection = { id, position, x, resized: false };
	}

	/**
	 * Returns whether the resizing finished successfully.
	 */
	async resize(event: MouseEvent): Promise<boolean> {
		const { target } = event;
		if (!this.resizedSection || !(target instanceof HTMLElement)) {
			return false;
		}

		const { id, position, x } = this.resizedSection;
		const bar = this.bar(id, position);
		if (!bar) {
			return false;
		}

		if (!this.resizedSection.resized) {
			this.resizedSection.resized = true;
		}

		const shouldInvert = this.shouldInvert(position);

		const delta = (event.clientX - x) * (shouldInvert ? -1 : 1);
		const newSize = bar.width + delta;

		if (newSize <= this.minSize) {
			bar.width = 0;
			return new Promise((resolve) => {
				requestAnimationFrame(() => {
					if (this.resizedSection) {
						const { right, left } = target.getBoundingClientRect();
						this.resizedSection.x = shouldInvert ? right : left;
						resolve(true);
					}
				});
			});
		} else {
			if (!bar.visible) {
				bar.visible = true;
			}
			bar.width = newSize;
			this.resizedSection.x = event.clientX;
			return true;
		}
	}

	getHorizontalTextDirection(): HorizontalTextDirection {
		const { body } = document;
		const dir = getComputedStyle(body).direction;
		return dir === 'rtl' ? HorizontalTextDirection.RTL : HorizontalTextDirection.LTR;
	}

	shouldInvert(bar: VerticalBarPosition): boolean {
		const dir = this.getHorizontalTextDirection();
		if (dir === HorizontalTextDirection.LTR) {
			return bar === VerticalBarPosition.InlineEnd;
		} else {
			return bar === VerticalBarPosition.InlineStart;
		}
	}

	async endResize(): Promise<void> {
		// We defer this because we want the click trigger to run first (`this.toggle`).
		await new Promise((resolve) => {
			requestAnimationFrame(() => {
				this.resizedSection = null;
				resolve(true);
			});
		});
	}
}
