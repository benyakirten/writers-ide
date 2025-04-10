import { sourceLanguageTag } from '$lib/paraglide/runtime.js';

export class LocaleState {
	locale = $state(sourceLanguageTag);
	constructor() {
		// TODO: Have locale be established by settings
	}
}

const LocaleManager = new LocaleState();
export default LocaleManager;
