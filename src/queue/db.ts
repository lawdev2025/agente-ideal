import { SqliteQueue } from "./sqlite-queue";

export function createQueueDb(): SqliteQueue {
  return new SqliteQueue();
}

export { SqliteQueue };
