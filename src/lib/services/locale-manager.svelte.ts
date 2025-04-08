import { baseLocale } from '$lib/paraglide/runtime.js';

export class LocaleState {
	locale = $state(baseLocale);
	constructor() {
		// TODO: Have locale be established by settings
	}
}

const LocaleManager = new LocaleState();
export default LocaleManager;
