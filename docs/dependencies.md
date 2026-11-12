# Dependency maintenance

## Current baseline

Use stable releases, not Tauri 3 prereleases. The dependency refresh retains Tauri 2 and Svelte 5, static/client-only SvelteKit deployment, and the existing ProseMirror content model.

- Rust: Tauri 2.12.5, tauri-build 2.7.4, opener 2.7.3; Rust 1.90 minimum.
- Frontend: SvelteKit 3, Vite 8, Paraglide JS 3, Tailwind CSS 4, Bits UI 2, Storybook 10, Vitest 5, and current ProseMirror packages. Manifests and lockfiles hold exact resolved versions.
- TypeScript remains on 6: current SvelteKit and svelte-check peer ranges do not support TypeScript 7. Node types remain on 24 to match CI's Node.js major.
- pnpm 12.4.1 is pinned in `package.json`. Node.js must satisfy `^22.22.2 || ^24.15.0 || >=26.0.0`, following jsdom's engine requirement.
- Tailwind 4 requires Safari 16.4+, Chrome 111+, or Firefox 128+. Check the corresponding system WebView when supporting older operating systems; a successful Chromium test is not validation of every Tauri platform.
- **Approved macOS baseline:** macOS 13.3 Ventura or newer, configured through `bundle.macOS.minimumSystemVersion` in `src-tauri/tauri.conf.json` to support Tailwind 4's Safari/WebKit 16.4 baseline. Older macOS releases are no longer supported. This does not pin the WebKit version or guarantee identical pagination across platforms. Runtime behavior on the oldest supported macOS version still requires validation.

SvelteKit configuration now lives in `vite.config.ts`; `tsconfig.json` extends `$app/tsconfig`. Compatibility aliases preserve existing `$lib` and `@/*` imports, although SvelteKit deprecates this alias configuration. Vitest resolves the Svelte client runtime for DOM tests.

The deprecated Paraglide SvelteKit adapter is replaced by the Paraglide JS Vite plugin. It emits physical message modules for standalone fixtures, selects the browser's preferred supported language, and falls back to English without locale URL routing. This makes the old configuration's intended preferred-language behavior explicit; the old adapter did not support that strategy option. The injected `LocaleManager` still initializes independently to English, as before; a unified locale authority remains an open design task.

Tailwind retains the existing configuration/theme through `@config` and explicit v3 compatibility styles. Bits UI wrappers use Svelte 5 props/snippets while forwarding legacy component events so existing consumers keep working. The deprecated `lucide-svelte` package is replaced by `@lucide/svelte`. Removed unused dependencies include adapter-auto and tailwind-variants.

## Updating and auditing

Run from the repository root:

```sh
pnpm outdated
pnpm update --latest
pnpm update --depth 100
pnpm audit
pnpm peers check
pnpm install --frozen-lockfile
pnpm check
pnpm check:performance
pnpm lint
pnpm test:unit:ci
pnpm test:e2e
pnpm test:performance
pnpm build
pnpm build-storybook
```

Review major-release migration guides and peer ranges before accepting a blanket update. `pnpm update --depth 100` refreshes transitive dependencies within their declared ranges; do not force incompatible major versions just to silence an audit.

For Rust, with cargo-audit installed:

```sh
cargo install cargo-audit --locked
cargo update --manifest-path src-tauri/Cargo.toml
cargo audit --file src-tauri/Cargo.lock
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

Commit both lockfiles with dependency changes. Audits cover published advisories, not proof that the application or its plugin model is secure. Never bypass Tauri capability controls or suppress advisories merely to obtain a clean report.

## Outstanding upstream reports

The November 2026 refresh reduced pnpm's reported findings from 169 (including seven critical) to one low-severity finding:

- `deepmerge` 4.3.1, pulled in by `@sveltejs/vite-plugin-svelte`, has a prototype-poisoning advisory with no published patched version. No override or ignore rule is applied. Track the upstream plugin/dependency fix.

RustSec reports no vulnerability findings, but five warnings remain in Tauri's transitive graph:

- `proc-macro-error` 1.0.4: unmaintained, RUSTSEC-2024-0370.
- `zbus_names` 4.3.5: unmaintained, RUSTSEC-2026-0371.
- `zvariant` 5.15.1: unmaintained, RUSTSEC-2026-0370.
- `zvariant_derive` 5.15.1: unmaintained, RUSTSEC-2026-0372.
- `glib` 0.18.5: unsound iterator implementations, RUSTSEC-2024-0429; fixed in 0.20+, but the GTK dependency chain still requires 0.18. This is relevant to the Linux dependency graph even when checking on macOS. A forced incompatible override is not a safe fix.

Two peer-metadata warnings also remain: `array-stream-plus` declares TypeScript 5.6, and Bits UI's transitive `runed` declares SvelteKit 2. They are not security advisories; the tested paths work with the current toolchain, but this does not establish compatibility for every upstream API. Do not silently widen these ranges or ignore them globally.
