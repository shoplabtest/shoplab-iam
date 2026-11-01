CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  full_name     text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'staff', 'admin')),
  tenant        text NOT NULL DEFAULT 'default',
  created_at    timestamptz NOT NULL DEFAULT now()
);
