import type { CommandInvoker } from './commands';
import type { ProjectApiConnection, ProjectConnections, ProjectReference } from './frontend';
import type { Dispose } from './index';
import type { Activation, Entry } from './command-component-model';
import type { ComponentApiManager } from './component-api-manager';
import type { ComponentProjectRegistry } from './component-project-registry';
import type { ConnectionScope } from './component-project-routing';

type Lease = {
	owner: Activation;
	project: ProjectReference;
	controller: AbortController;
	scope: ConnectionScope;
	live: boolean;
};

/** Independent connection lifetimes. Activations and task ownership never change here. */
export class ComponentProjectConnections {
	readonly #leases = new Set<Lease>();
	readonly #pending = new Set<Lease>();
	constructor(
		private readonly registry: ComponentProjectRegistry,
		private readonly apis: ComponentApiManager,
		private readonly invoker: (
			entry: Entry,
			owner: Activation,
			scope: ConnectionScope,
		) => CommandInvoker,
		private readonly callback: <T>(callback: () => T) => T,
		private readonly revokeCommands: () => void,
	) {}

	context(entry: Entry, owner: Activation, own: (dispose: Dispose) => Dispose): ProjectConnections {
		const assertLive = () => {
			if (entry.activation !== owner || owner.phase === 'stopped') {
				throw new Error('Project connection consumer is revoked');
			}
		};
		return Object.freeze({
			subscribeSelected: (listener: (project: ProjectReference | null) => void) => {
				assertLive();
				if (typeof listener !== 'function') {
					throw new TypeError('Project selection listener must be a function');
				}
				return own(
					this.registry.subscribeSelected((project) => {
						if (owner.phase !== 'stopped') {
							return this.callback(() => listener(project));
						}
					}),
				);
			},
			connect: (project: ProjectReference): ProjectApiConnection => {
				assertLive();
				this.registry.assert(project);
				const controller = new AbortController();
				const lease: Lease = {
					owner,
					project,
					controller,
					live: true,
					scope: this.apis.scope(
						owner,
						project.openingId,
						controller.signal,
						() => lease.live && owner.phase !== 'stopped',
					),
				};
				this.#leases.add(lease);
				try {
					const apis = this.apis.context(entry, owner, lease.scope);
					const commands = this.invoker(entry, owner, lease.scope);
					return Object.freeze({
						project,
						signal: controller.signal,
						commands,
						get: apis.get,
						subscribe: apis.subscribe,
						dispose: () => {
							this.#mark(lease);
							this.drain();
							this.apis.drain();
						},
					});
				} catch (error) {
					this.#mark(lease);
					this.drain();
					throw error;
				}
			},
		});
	}

	#mark(lease: Lease): void {
		if (!lease.live) {
			return;
		}
		lease.live = false;
		this.#leases.delete(lease);
		this.#pending.add(lease);
		this.apis.revokeScope(lease.scope);
	}
	revokeOwner(owner: Activation): void {
		for (const lease of this.#leases) {
			if (lease.owner === owner) {
				this.#mark(lease);
			}
		}
	}
	revokeOpening(openingId: string): void {
		for (const lease of this.#leases) {
			if (lease.project.openingId === openingId) {
				this.#mark(lease);
			}
		}
	}
	drain(): void {
		// Fix every logically revoked command outcome before the first author abort callback.
		this.revokeCommands();
		const pending = [...this.#pending];
		this.#pending.clear();
		for (const lease of pending) {
			this.callback(() => lease.controller.abort());
		}
	}
}
