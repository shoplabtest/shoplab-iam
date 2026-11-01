export interface Config {
  port: number;
  databaseUrl: string;
  rabbitUrl: string | undefined;
  jwtSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3001),
    databaseUrl: env.DATABASE_URL ?? 'postgres://iam:iam@localhost:5432/iam',
    rabbitUrl: env.RABBITMQ_URL,
    jwtSecret: env.JWT_SIGNING_KEY ?? 'dev-only-secret',
    accessTtlSeconds: Number(env.ACCESS_TOKEN_TTL_SECONDS ?? 900),
    refreshTtlSeconds: Number(env.REFRESH_TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 30),
  };
}
