-- New FriendMail D1 schema. Do not run this against an existing unrelated database.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  avatar TEXT,
  avatar_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sender_deleted INTEGER NOT NULL DEFAULT 0,
  recipient_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS inbox_idx ON messages(recipient_id,id DESC);
CREATE INDEX IF NOT EXISTS sent_idx ON messages(sender_id,id DESC);
CREATE TABLE IF NOT EXISTS friends (
  user1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(user1_id,user2_id),
  CHECK(user1_id < user2_id)
);
CREATE TABLE IF NOT EXISTS friend_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  responded_at TEXT,
  CHECK(sender_id <> receiver_id)
);
CREATE INDEX IF NOT EXISTS requests_inbox_idx ON friend_requests(receiver_id,status);
CREATE INDEX IF NOT EXISTS requests_outbox_idx ON friend_requests(sender_id,status);

-- Prevent duplicate pending invitations sent in the same direction concurrently.
CREATE UNIQUE INDEX IF NOT EXISTS unique_pending_friend_request ON friend_requests(sender_id,receiver_id) WHERE status='pending';
