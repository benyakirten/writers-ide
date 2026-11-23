import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['packages-js/plugins/*.test.ts'],
		environment: 'node',
	},
});
