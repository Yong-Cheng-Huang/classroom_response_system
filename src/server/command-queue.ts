import type { SqliteDatabase } from './database.js';
import { validateHighWater } from './database.js';

export type Receipt = Readonly<{ receiveOrder: number; receivedAt: number }>;
export type Allocator = () => Receipt;

export function createSqliteAllocator(database: SqliteDatabase, now: () => number = Date.now): Allocator {
  validateHighWater(database);
  const allocate = database.transaction((receivedAt: number) => {
    validateHighWater(database);
    const row = database.prepare('SELECT receive_high_water AS value FROM system_state WHERE id = 1').get() as { value: number };
    if (!Number.isSafeInteger(row.value + 1)) throw new Error('receive_order_exhausted');
    const receiveOrder = row.value + 1;
    database.prepare('INSERT INTO receive_orders VALUES (?)').run(receiveOrder);
    database.prepare('UPDATE system_state SET receive_high_water = ? WHERE id = 1').run(receiveOrder);
    return Object.freeze({ receiveOrder, receivedAt });
  });
  return () => allocate.immediate(now());
}

// HTTP 命令入口與未來實際提交／結束服務共用；不在此信任客戶端角色或時間。
export class OrderedCommandQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private unavailable = false;
  constructor(private readonly allocate: Allocator) {}
  async drain() {await this.tail;}

  enqueue<T>(work: (receipt: Receipt) => T | Promise<T>): Promise<T> {
    if (this.unavailable) return Promise.reject(new Error('command_queue_unavailable'));
    let receipt: Receipt;
    try { receipt = this.allocate(); }
    catch (error) { this.unavailable = true; return Promise.reject(error); }
    const result = this.tail.then(() => work(receipt));
    this.tail = result.catch(() => undefined);
    return result;
  }
}
