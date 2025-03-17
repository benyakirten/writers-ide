import type * as m from '$lib/paraglide/messages.js';

import type { HorizontalBar, HorizontalBarPosition } from './state/horizontal-bar-state.svelte.js';
import type { VerticalBar, VerticalBarPosition } from './state/vertical-bar-state.svelte.js';

/**
 * Configuration settings for the editor. It includes vertical and horizontal options
 */
export type EditorSettings = {
	/**
	 * Settings default settings for vertical bars.
	 */
	vertical: Record<VerticalBarPosition, VerticalBar> & {
		/**
		 * Minimum width for a vertical bar. If below this width, the vertical bar collapses.
		 * Set to 0 if you do not want the vertical bar to collapse unless it has been toggled invisible..
		 */
		minWidth: number;
	};
	horizontal: Record<HorizontalBarPosition, HorizontalBar> & {
		/**
		 * Minimum height for a horizontal bar. If below this height, the horizontal bar collapses.
		 * Set to 0 if you do not want the horizontal bar to collapse unless it has been toggled invisible..
		 */
		minHeight: number;
	};
};

export type Internationalizator = typeof m;
