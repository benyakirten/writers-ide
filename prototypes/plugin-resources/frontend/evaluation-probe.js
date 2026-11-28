export function checkJavaScriptEvaluation() {
	const result = {};
	for (const [name, evaluate] of [
		['eval', () => globalThis.eval('1 + 1')],
		['newFunction', () => new Function('return 1 + 1')()],
	]) {
		try {
			evaluate();
			result[name] = { blocked: false };
		} catch (error) {
			result[name] = {
				blocked: error?.name === 'EvalError',
				error: String(error?.name).slice(0, 80),
			};
		}
	}
	return result;
}
