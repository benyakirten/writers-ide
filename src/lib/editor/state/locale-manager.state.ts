import { onSetLanguageTag, sourceLanguageTag } from '$lib/paraglide/runtime.js';

export class LocaleKeeperState {
	locale = $state<string>(sourceLanguageTag);
	constructor() {
		onSetLanguageTag((tag) => {
			this.locale = tag;
		});
	}
}

const LocaleManager = new LocaleKeeperState();
export default LocaleManager;
