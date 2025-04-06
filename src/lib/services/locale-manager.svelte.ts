import { onSetLanguageTag, sourceLanguageTag } from '$lib/paraglide/runtime.js';

export class LocaleKeeperState {
	locale = $state(sourceLanguageTag);
	constructor() {
		onSetLanguageTag((tag) => {
			this.locale = tag;
		});
	}
}

const LocaleManager = new LocaleKeeperState();
export default LocaleManager;
