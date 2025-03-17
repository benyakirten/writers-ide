import { onSetLanguageTag, sourceLanguageTag } from '$lib/paraglide/runtime.js';
import { RequiredObservable } from '$lib/utils/observable.js';

export class LocaleKeeperState extends RequiredObservable<string> {
	constructor() {
		super(sourceLanguageTag);
		onSetLanguageTag((tag) => {
			this.data = tag;
		});
	}
}

const LocaleManager = new LocaleKeeperState();
export default LocaleManager;
