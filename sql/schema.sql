-- Tempxral · esquema de base de datos (PostgreSQL 13+)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_username TEXT NOT NULL,          -- foto fija del nombre en el momento de subir
  media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image','video')),
  file_path TEXT NOT NULL,                -- ruta relativa dentro de /uploads
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  hidden_reason TEXT                      -- NULL | 'reported'
);
CREATE INDEX IF NOT EXISTS idx_content_visible ON content_items (expires_at) WHERE hidden_reason IS NULL;

CREATE TABLE IF NOT EXISTS votes (
  item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value SMALLINT NOT NULL CHECK (value IN (1,-1)),
  PRIMARY KEY (item_id, user_id)
);

CREATE TABLE IF NOT EXISTS extensions (
  item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  extended_on DATE NOT NULL,
  PRIMARY KEY (item_id, user_id, extended_on)
);

CREATE TABLE IF NOT EXISTS reports (
  item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_id)
);

-- Añadido tras el lanzamiento inicial: título de la publicación y comentarios.
-- Con ADD COLUMN/CREATE TABLE "IF NOT EXISTS" esto es seguro de aplicar sobre
-- una base de datos que ya tenía el esquema anterior (se ejecuta automáticamente
-- en cada arranque vía "npm run start:prod").
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS title TEXT;

CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_username TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_item ON comments (item_id, created_at);
