PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_version VALUES (1);
CREATE TABLE IF NOT EXISTS bots (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','stopped')),
 visibility TEXT NOT NULL CHECK(visibility IN ('private','public')), revision INTEGER NOT NULL CHECK(revision>0), doc TEXT NOT NULL CHECK(json_valid(doc))
);
CREATE INDEX IF NOT EXISTS bots_owner ON bots(owner_id);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), actor_id TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0, doc TEXT NOT NULL CHECK(json_valid(doc))
);
CREATE INDEX IF NOT EXISTS sessions_actor_bot ON sessions(actor_id,bot_id);
CREATE TABLE IF NOT EXISTS events (
 session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, event_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL, revision INTEGER NOT NULL,
 response TEXT NOT NULL CHECK(json_valid(response)), input TEXT NOT NULL CHECK(json_valid(input)),
 PRIMARY KEY(session_id,event_id), UNIQUE(session_id,revision)
);
CREATE TABLE IF NOT EXISTS records (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 bot_id TEXT NOT NULL REFERENCES bots(id), session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL, event_id TEXT NOT NULL, item_index INTEGER NOT NULL, doc TEXT NOT NULL CHECK(json_valid(doc)),
 UNIQUE(session_id,event_id,item_index)
);
CREATE INDEX IF NOT EXISTS records_bot ON records(bot_id,seq);
CREATE TABLE IF NOT EXISTS keys (
 id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(scope IN ('manage','chat')), bot_id TEXT REFERENCES bots(id),
 label TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS keys_owner ON keys(owner_id);
CREATE TABLE IF NOT EXISTS quota_buckets (
 key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL
);
