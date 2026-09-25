CREATE TABLE file_objects (
  object_key TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0 AND size <= 20971520),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE file_chunks (
  object_key TEXT NOT NULL REFERENCES file_objects(object_key) ON DELETE CASCADE,
  part_index INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (object_key, part_index)
);
