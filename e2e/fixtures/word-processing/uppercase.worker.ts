import { defineTaskWorker, type TaskWorkerScope } from '@writers-ide/tasks/worker';

declare const self: TaskWorkerScope;

defineTaskWorker<string, string>(self, (text) => text.toUpperCase());
