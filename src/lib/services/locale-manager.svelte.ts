import { onSetLanguageTag, sourceLanguageTag } from '$lib/paraglide/runtime.js';

export class LocaleState {
	locale = $state(sourceLanguageTag);
	constructor() {
		onSetLanguageTag((tag) => {
			this.locale = tag;
		});
	}
}

const LocaleManager = new LocaleState();
export default LocaleManager;
