import { HttpError } from './utils.js';

const CHUNK_SIZE = 1024 * 1024;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

// A FILES binding keeps existing R2 deployments usable. The no-card pilot
// stores new files in D1 when that binding is absent.
export function fileStore(env) {
  if (env.FILES) return env.FILES;
  const db = env.DB;
  return {
    async put(key, body, options = {}) {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
      if (bytes.length > MAX_FILE_SIZE) throw new HttpError('File exceeds the 20 MB pilot storage limit.', 413);
      const contentType = options.httpMetadata?.contentType || 'application/octet-stream';
      const statements = [db.prepare('INSERT INTO file_objects (object_key,content_type,size) VALUES (?,?,?)').bind(key, contentType, bytes.length)];
      for (let offset = 0, part = 0; offset < bytes.length; offset += CHUNK_SIZE, part++) {
        statements.push(db.prepare('INSERT INTO file_chunks (object_key,part_index,data) VALUES (?,?,?)')
          .bind(key, part, bytes.slice(offset, offset + CHUNK_SIZE)));
      }
      await db.batch(statements);
    },
    async head(key) {
      return await db.prepare('SELECT object_key FROM file_objects WHERE object_key=?').bind(key).first();
    },
    async get(key) {
      const metadata = await db.prepare('SELECT size FROM file_objects WHERE object_key=?').bind(key).first();
      if (!metadata) return null;
      const rows = (await db.prepare('SELECT data FROM file_chunks WHERE object_key=? ORDER BY part_index').bind(key).all()).results;
      const bytes = new Uint8Array(metadata.size);
      let offset = 0;
      for (const row of rows) {
        const chunk = row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data);
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      if (offset !== metadata.size) throw new HttpError('Stored file is incomplete.', 503);
      return { body: bytes };
    },
    async delete(key) {
      await db.prepare('DELETE FROM file_objects WHERE object_key=?').bind(key).run();
    }
  };
}
