ALTER TABLE documents ADD COLUMN parent_document_id TEXT REFERENCES documents(id);
ALTER TABLE document_versions ADD COLUMN kind TEXT NOT NULL DEFAULT 'finalised';
CREATE TABLE assets (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, mime_type TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE, size INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE template_versions (
 template_id TEXT NOT NULL REFERENCES templates(id), version INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(template_id,version)
);
CREATE TABLE login_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at TEXT NOT NULL);
CREATE INDEX idx_document_parent ON documents(parent_document_id);
-- Existing issued snapshots remain readable. Drafts acquire snapshots on their next save.
CREATE TRIGGER protect_issued_snapshot BEFORE UPDATE OF snapshot_json,rendered_html,kind ON document_versions
WHEN OLD.kind = 'finalised' BEGIN SELECT RAISE(ABORT,'Issued snapshots are immutable'); END;
