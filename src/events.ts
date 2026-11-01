import amqp from 'amqplib';

export const EXCHANGE = 'shop.events';

export interface UserRegistered { userId: string; email: string; fullName: string }
export interface UserRoleChanged { userId: string; oldRole: string; newRole: string }

export interface Publisher {
  publish(routingKey: 'user.registered', body: UserRegistered): Promise<void>;
  publish(routingKey: 'user.role_changed', body: UserRoleChanged): Promise<void>;
  close(): Promise<void>;
}

export class NullPublisher implements Publisher {
  published: { key: string; body: unknown }[] = [];
  async publish(key: string, body: unknown) { this.published.push({ key, body }); }
  async close() {}
}

export async function connectPublisher(url: string): Promise<Publisher> {
  const conn = await amqp.connect(url);
  const ch = await conn.createChannel();
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  return {
    async publish(key: string, body: unknown) {
      ch.publish(EXCHANGE, key, Buffer.from(JSON.stringify(body)), { contentType: 'application/json', persistent: true });
    },
    async close() {
      await ch.close();
      await conn.close();
    },
  } as Publisher;
}
