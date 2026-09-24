PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'issuer')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  document_type TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  number_prefix TEXT NOT NULL,
  header_html TEXT NOT NULL,
  footer_html TEXT NOT NULL,
  continuation_header_html TEXT NOT NULL DEFAULT '',
  continuation_footer_html TEXT NOT NULL DEFAULT '',
  default_opening_html TEXT NOT NULL DEFAULT '',
  default_closing_html TEXT NOT NULL DEFAULT '',
  css TEXT NOT NULL DEFAULT '',
  margins_json TEXT NOT NULL DEFAULT '{"top":38,"right":22,"bottom":30,"left":22}',
  signatory_ids_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  document_number TEXT UNIQUE,
  template_id TEXT NOT NULL REFERENCES templates(id),
  document_type TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  designation TEXT,
  letter_date TEXT NOT NULL,
  subject TEXT,
  content_html TEXT NOT NULL,
  signatory_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalised', 'archived')),
  current_version INTEGER NOT NULL DEFAULT 1,
  pdf_object_key TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalised_at TEXT,
  archived_at TEXT
);

CREATE TABLE document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  template_id TEXT NOT NULL REFERENCES templates(id),
  template_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  rendered_html TEXT,
  pdf_object_key TEXT,
  issued_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, version_number)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE signatories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  designation TEXT NOT NULL,
  signature_object_key TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE document_sequences (
  document_type TEXT NOT NULL,
  year INTEGER NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (document_type, year)
);

CREATE INDEX idx_documents_created_by_date ON documents(created_by, created_at DESC);
CREATE INDEX idx_documents_type_date ON documents(document_type, letter_date DESC);
CREATE INDEX idx_documents_recipient ON documents(recipient_name COLLATE NOCASE);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_versions_document ON document_versions(document_id, version_number DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

PRAGMA optimize;
