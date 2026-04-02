const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const mime = require('mime-types');
const Database = require('better-sqlite3');

let db = null;
let currentDbPath = null;
let mediaRootPath = null;

function hasTable(table) {
  if (!db) return false;
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
  return Boolean(row);
}

function hasColumn(table, column) {
  if (!db || !hasTable(table)) return false;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some((item) => item.name === column);
}

function coalesceContactName(jidExpr) {
  return `COALESCE(NULLIF(contact.display_name, ''), NULLIF(contact.given_name, ''), NULLIF(contact.wa_name, ''), ${jidExpr})`;
}

function senderNameExpression() {
  return `COALESCE(NULLIF(sender_contact.display_name, ''), NULLIF(sender_contact.given_name, ''), NULLIF(sender_contact.wa_name, ''), sender_jid.user, sender_jid.raw_string, 'Desconhecido')`;
}

function buildConversationsQuery() {
  const hasJidRaw = hasColumn('jid', 'raw_string');
  const jidValue = hasJidRaw ? 'COALESCE(jid.raw_string, jid.user)' : 'jid.user';

  return {
    query: `
      SELECT
        chat._id,
        chat.subject,
        chat.sort_timestamp,
        ${jidValue} AS jid,
        ${coalesceContactName(jidValue)} AS display_name
      FROM chat
      LEFT JOIN jid ON chat.jid_row_id = jid._id
      LEFT JOIN wa_contacts contact ON contact.jid = ${hasJidRaw ? 'COALESCE(jid.raw_string, jid.user || "@s.whatsapp.net")' : '(jid.user || "@s.whatsapp.net")'}
      WHERE (
        ? = '' OR
        LOWER(${coalesceContactName(jidValue)}) LIKE ? OR
        LOWER(${jidValue}) LIKE ? OR
        LOWER(COALESCE(chat.subject, '')) LIKE ?
      )
      ORDER BY chat.sort_timestamp DESC
      LIMIT ? OFFSET ?
    `,
    countQuery: `
      SELECT COUNT(*) as total
      FROM chat
      LEFT JOIN jid ON chat.jid_row_id = jid._id
      LEFT JOIN wa_contacts contact ON contact.jid = ${hasJidRaw ? 'COALESCE(jid.raw_string, jid.user || "@s.whatsapp.net")' : '(jid.user || "@s.whatsapp.net")'}
      WHERE (
        ? = '' OR
        LOWER(${coalesceContactName(jidValue)}) LIKE ? OR
        LOWER(${jidValue}) LIKE ? OR
        LOWER(COALESCE(chat.subject, '')) LIKE ?
      )
    `,
  };
}

function buildMessagesQuery() {
  const hasSortId = hasColumn('message', 'sort_id');
  const hasSenderJid = hasColumn('message', 'sender_jid_row_id');
  const hasMediaTable = hasTable('message_media');

  const orderColumn = hasSortId ? 'message.sort_id' : 'message._id';
  const quotedSubquery = hasTable('message_quoted')
    ? '(SELECT text_data FROM message_quoted WHERE message_quoted.message_row_id = message._id LIMIT 1) AS quoted_text'
    : 'NULL AS quoted_text';

  const mediaJoin = hasMediaTable ? 'LEFT JOIN message_media mm ON mm.message_row_id = message._id' : '';
  const mediaSelect = hasMediaTable
    ? [
        hasColumn('message_media', 'file_path') ? 'mm.file_path AS media_file_path' : 'NULL AS media_file_path',
        hasColumn('message_media', 'mime_type') ? 'mm.mime_type AS media_mime_type' : 'NULL AS media_mime_type',
        hasColumn('message_media', 'media_name') ? 'mm.media_name AS media_name' : 'NULL AS media_name',
        hasColumn('message_media', 'file_name') ? 'mm.file_name AS media_file_name' : 'NULL AS media_file_name',
      ].join(',\n        ')
    : 'NULL AS media_file_path, NULL AS media_mime_type, NULL AS media_name, NULL AS media_file_name';

  const senderJoins = hasSenderJid
    ? `
      LEFT JOIN jid sender_jid ON message.sender_jid_row_id = sender_jid._id
      LEFT JOIN wa_contacts sender_contact ON sender_contact.jid = COALESCE(sender_jid.raw_string, sender_jid.user || '@s.whatsapp.net')
    `
    : '';

  const senderName = hasSenderJid ? `${senderNameExpression()} AS sender_name` : 'NULL AS sender_name';

  return {
    query: `
      SELECT
        message._id,
        message.from_me,
        message.text_data,
        message.timestamp,
        ${quotedSubquery},
        ${senderName},
        ${mediaSelect}
      FROM message
      ${mediaJoin}
      ${senderJoins}
      WHERE message.chat_row_id = ?
      AND (? = '' OR LOWER(COALESCE(message.text_data, '')) LIKE ?)
      ORDER BY ${orderColumn} DESC
      LIMIT ? OFFSET ?
    `,
    countQuery: `
      SELECT COUNT(*) as total
      FROM message
      WHERE message.chat_row_id = ?
      AND (? = '' OR LOWER(COALESCE(message.text_data, '')) LIKE ?)
    `,
  };
}

function resolveMediaFile(row) {
  const candidates = [row.media_file_path, row.media_name, row.media_file_name].filter(Boolean);
  const roots = [];

  if (mediaRootPath) roots.push(mediaRootPath);
  if (currentDbPath) roots.push(path.dirname(currentDbPath));

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
      return candidate;
    }

    for (const root of roots) {
      const resolved = path.resolve(root, candidate);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
  }

  return null;
}

function normalizeSearch(search) {
  const value = (search || '').trim().toLowerCase();
  return {
    exact: value,
    like: `%${value}%`,
  };
}

function openDatabase(dbPath, newMediaRootPath) {
  if (db) {
    db.close();
    db = null;
  }

  db = new Database(dbPath, { readonly: true, fileMustExist: true });
  currentDbPath = dbPath;
  mediaRootPath = newMediaRootPath || path.dirname(dbPath);
}

async function startBackendServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, dbLoaded: Boolean(db), dbPath: currentDbPath });
  });

  app.post('/api/open-db', (req, res) => {
    try {
      const { dbPath, mediaRootPath: selectedMediaRoot } = req.body || {};
      if (!dbPath) {
        return res.status(400).json({ error: 'dbPath e obrigatorio.' });
      }

      openDatabase(dbPath, selectedMediaRoot);

      return res.json({
        ok: true,
        dbPath: currentDbPath,
        mediaRootPath,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Falha ao abrir database.' });
    }
  });

  app.get('/api/conversations', (req, res) => {
    try {
      if (!db) {
        return res.status(400).json({ error: 'Nenhum banco carregado.' });
      }

      const limit = Number(req.query.limit || 60);
      const offset = Number(req.query.offset || 0);
      const search = normalizeSearch(req.query.search || '');

      const { query, countQuery } = buildConversationsQuery();
      const rows = db.prepare(query).all(search.exact, search.like, search.like, search.like, limit, offset);
      const totalRow = db.prepare(countQuery).get(search.exact, search.like, search.like, search.like);

      return res.json({
        data: rows.map((row) => ({
          _id: row._id,
          jid: row.jid || 'desconhecido',
          subject: row.subject,
          display_name: row.display_name || row.subject || row.jid || 'Desconhecido',
          timestamp: row.sort_timestamp || 0,
        })),
        total: totalRow?.total || 0,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Falha ao consultar conversas.' });
    }
  });

  app.get('/api/messages', (req, res) => {
    try {
      if (!db) {
        return res.status(400).json({ error: 'Nenhum banco carregado.' });
      }

      const chatId = Number(req.query.chatId);
      if (!chatId) {
        return res.status(400).json({ error: 'chatId e obrigatorio.' });
      }

      const limit = Number(req.query.limit || 50);
      const offset = Number(req.query.offset || 0);
      const search = normalizeSearch(req.query.search || '');

      const { query, countQuery } = buildMessagesQuery();
      const rows = db.prepare(query).all(chatId, search.exact, search.like, limit, offset);
      const totalRow = db.prepare(countQuery).get(chatId, search.exact, search.like);

      const mapped = rows
        .map((row) => {
          const mediaPath = resolveMediaFile(row);
          return {
            _id: row._id,
            from_me: row.from_me === 1,
            text_data: row.text_data,
            timestamp: row.timestamp,
            quoted_text: row.quoted_text,
            sender_name: row.sender_name,
            has_media: Boolean(mediaPath),
            media_path: mediaPath,
            media_mime_type: row.media_mime_type || null,
            media_url: mediaPath ? `/api/media?path=${encodeURIComponent(mediaPath)}` : null,
          };
        })
        .reverse();

      return res.json({
        data: mapped,
        total: totalRow?.total || 0,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Falha ao consultar mensagens.' });
    }
  });

  app.get('/api/media', (req, res) => {
    try {
      const requested = String(req.query.path || '');
      if (!requested) {
        return res.status(400).json({ error: 'path e obrigatorio.' });
      }

      const absolute = path.resolve(requested);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        return res.status(404).json({ error: 'Arquivo de midia nao encontrado.' });
      }

      const mimeType = mime.lookup(absolute) || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      return fs.createReadStream(absolute).pipe(res);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Falha ao carregar midia.' });
    }
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  const address = server.address();
  const port = typeof address === 'string' ? 0 : address.port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        if (!db) {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
          return;
        }

        db.close();
        db = null;

        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

module.exports = {
  startBackendServer,
};
