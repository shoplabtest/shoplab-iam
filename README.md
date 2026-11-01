# shoplab-iam

Users, sessions, roles and tokens. Express + Postgres.

| Endpoint | Notes |
| --- | --- |
| `POST /auth/register` | publishes `user.registered` |
| `POST /auth/login`, `/auth/refresh` | JWT claims `sub`, `role`, `tenant`; refresh tokens rotate |
| `POST /auth/logout` | revoke one refresh token, or all with `all: true` |
| `POST /auth/password-reset/request`, `/confirm` | one-time token, revokes sessions |
| `GET /users/:id` | self, or staff/admin |
| `PATCH /users/:id` | self or admin; changes `fullName` only |
| `PUT /users/:id/role` | admin only; publishes `user.role_changed` |

Env: `DATABASE_URL`, `JWT_SIGNING_KEY`, `RABBITMQ_URL` (optional), `PORT`, `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_SECONDS`.

`npm test` runs against an in-memory store; set `TEST_DATABASE_URL` to also run the migration test on an empty Postgres.
`npm run seed` creates the same 50 users every time (password `password123`).
`schema.sql` is a snapshot of the migrated schema. Other services read `users.email` and `users.full_name`.
