import { baseLocale, type Locale } from '$lib/paraglide/runtime';

export class LocaleState {
	locale = $state<Locale>(baseLocale);
	constructor() {
		// TODO: Have locale be established by settings
	}
}

const LocaleManager = new LocaleState();
export default LocaleManager;
