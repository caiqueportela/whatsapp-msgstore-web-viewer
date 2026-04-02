const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const mime = require('mime-types');
const Database = require('better-sqlite3');

const DEFAULT_CHAT_LIMIT = 250;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_LIMIT = 500;

function toSafeInt(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const intVal = Math.trunc(parsed);
  if (intVal < min) return min;
  if (intVal > max) return max;
  return intVal;
}

function normalizeSearch(search) {
  const value = String(search || '').trim().toLowerCase();
  return {
    exact: value,
    like: `%${value}%`,
  };
}

function buildSchemaMetadata(db) {
  const rows = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all();

  const tables = new Set(rows.map((row) => row.name));
  const columnsByTable = new Map();

  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    columnsByTable.set(table, new Set(columns.map((column) => column.name)));
  }

  return {
    hasTable(table) {
      return tables.has(table);
    },
    hasColumn(table, column) {
      const columns = columnsByTable.get(table);
      return Boolean(columns?.has(column));
    },
  };
}

function isPathInsideRoot(filePath, rootPath) {
  const relative = path.relative(rootPath, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

class ArchiveStore {
  constructor() {
    this.db = null;
    this.schema = null;
    this.currentDbPath = null;
    this.mediaRootPath = null;
  }

  closeDatabase() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.schema = null;
    }
  }

  openDatabase(dbPath, mediaRootPath) {
    this.closeDatabase();
    this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
    this.schema = buildSchemaMetadata(this.db);
    this.currentDbPath = dbPath;
    this.mediaRootPath = mediaRootPath || path.dirname(dbPath);
  }

  ensureDbLoaded() {
    if (!this.db || !this.schema) {
      throw new Error('Nenhum banco carregado.');
    }
  }

  getAllowedMediaRoots() {
    const roots = [];
    if (this.mediaRootPath) roots.push(path.resolve(this.mediaRootPath));
    if (this.currentDbPath) roots.push(path.resolve(path.dirname(this.currentDbPath)));
    return [...new Set(roots)];
  }

  buildConversationQueryParts() {
    const hasJidRaw = this.schema.hasColumn('jid', 'raw_string');
    const jidValue = hasJidRaw ? 'COALESCE(jid.raw_string, jid.user)' : 'jid.user';

    const joins = ['LEFT JOIN jid ON chat.jid_row_id = jid._id'];

    if (this.schema.hasTable('wa_contacts')) {
      joins.push(
        `LEFT JOIN wa_contacts contact ON contact.jid = ${
          hasJidRaw ? 'COALESCE(jid.raw_string, jid.user || "@s.whatsapp.net")' : '(jid.user || "@s.whatsapp.net")'
        }`
      );
    }

    if (this.schema.hasTable('lid_display_name')) {
      // Direct match: chat.jid_row_id is itself a LID (modern WhatsApp backups)
      joins.push('LEFT JOIN lid_display_name lid_direct ON lid_direct.lid_row_id = chat.jid_row_id');
    }

    if (this.schema.hasTable('jid_map') && this.schema.hasTable('lid_display_name')) {
      // Indirect match: chat.jid_row_id is a regular JID, resolve via jid_map
      joins.push('LEFT JOIN jid_map jm ON jm.jid_row_id = jid._id');
      joins.push('LEFT JOIN lid_display_name lid_name ON lid_name.lid_row_id = jm.lid_row_id');
    }

    const displayExpr = [
      this.schema.hasTable('wa_contacts') ? "NULLIF(contact.display_name, '')" : 'NULL',
      this.schema.hasTable('wa_contacts') ? "NULLIF(contact.given_name, '')" : 'NULL',
      this.schema.hasTable('wa_contacts') ? "NULLIF(contact.wa_name, '')" : 'NULL',
      this.schema.hasTable('lid_display_name') ? "NULLIF(lid_direct.display_name, '')" : 'NULL',
      this.schema.hasTable('lid_display_name') ? "NULLIF(lid_direct.username, '')" : 'NULL',
      this.schema.hasTable('lid_display_name') ? "NULLIF(lid_name.display_name, '')" : 'NULL',
      this.schema.hasTable('lid_display_name') ? "NULLIF(lid_name.username, '')" : 'NULL',
      "NULLIF(chat.subject, '')",
      'jid.user',
    ].join(', ');

    return {
      joins: joins.join('\n      '),
      jidValue,
      displayNameExpr: `COALESCE(${displayExpr})`,
    };
  }

  getConversations({ limit, offset, search }) {
    this.ensureDbLoaded();

    const boundedLimit = toSafeInt(limit, DEFAULT_CHAT_LIMIT, 1, MAX_LIMIT);
    const boundedOffset = toSafeInt(offset, 0, 0);
    const searchValue = normalizeSearch(search);

    const parts = this.buildConversationQueryParts();

    const query = `
      SELECT
        chat._id,
        chat.subject,
        chat.sort_timestamp,
        ${parts.jidValue} AS jid,
        ${parts.displayNameExpr} AS display_name
      FROM chat
      ${parts.joins}
      WHERE (
        ? = '' OR
        LOWER(${parts.displayNameExpr}) LIKE ? OR
        LOWER(${parts.jidValue}) LIKE ? OR
        LOWER(COALESCE(chat.subject, '')) LIKE ?
      )
      ORDER BY chat.sort_timestamp DESC
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM chat
      ${parts.joins}
      WHERE (
        ? = '' OR
        LOWER(${parts.displayNameExpr}) LIKE ? OR
        LOWER(${parts.jidValue}) LIKE ? OR
        LOWER(COALESCE(chat.subject, '')) LIKE ?
      )
    `;

    const rows = this.db
      .prepare(query)
      .all(searchValue.exact, searchValue.like, searchValue.like, searchValue.like, boundedLimit, boundedOffset);
    const totalRow = this.db
      .prepare(countQuery)
      .get(searchValue.exact, searchValue.like, searchValue.like, searchValue.like);

    return {
      data: rows.map((row) => ({
        _id: row._id,
        jid: row.jid || 'desconhecido',
        subject: row.subject,
        display_name: row.display_name || row.subject || row.jid || 'Desconhecido',
        timestamp: row.sort_timestamp || 0,
      })),
      total: totalRow?.total || 0,
    };
  }

  buildMessageQueryParts() {
    const hasSortId = this.schema.hasColumn('message', 'sort_id');
    const hasSenderJid = this.schema.hasColumn('message', 'sender_jid_row_id');
    const hasMessageMedia = this.schema.hasTable('message_media');
    const hasAddonMedia = this.schema.hasTable('addon_message_media');
    const hasMessageThumbnail = this.schema.hasTable('message_thumbnail') && this.schema.hasColumn('message_thumbnail', 'thumbnail');
    const hasQuoted = this.schema.hasTable('message_quoted');

    const joins = [];

    if (hasMessageMedia) {
      joins.push('LEFT JOIN message_media mm ON mm.message_row_id = message._id');
    }

    if (hasAddonMedia) {
      joins.push('LEFT JOIN addon_message_media amm ON amm.message_row_id = message._id AND amm.addon_message_index = 0');
    }

    if (hasMessageThumbnail) {
      joins.push('LEFT JOIN message_thumbnail mt ON mt.message_row_id = message._id');
    }

    if (hasSenderJid) {
      joins.push('LEFT JOIN jid sender_jid ON message.sender_jid_row_id = sender_jid._id');

      if (this.schema.hasTable('lid_display_name')) {
        // Direct match: sender_jid_row_id is itself a LID (modern WhatsApp backups)
        joins.push('LEFT JOIN lid_display_name sender_lid_direct ON sender_lid_direct.lid_row_id = sender_jid._id');
      }

      if (this.schema.hasTable('wa_contacts')) {
        joins.push(
          "LEFT JOIN wa_contacts sender_contact ON sender_contact.jid = COALESCE(sender_jid.raw_string, sender_jid.user || '@s.whatsapp.net')"
        );
      }

      if (this.schema.hasTable('jid_map') && this.schema.hasTable('lid_display_name')) {
        // Indirect match: sender is a regular JID, resolve via jid_map
        joins.push('LEFT JOIN jid_map sender_jm ON sender_jm.jid_row_id = sender_jid._id');
        joins.push('LEFT JOIN lid_display_name sender_lid ON sender_lid.lid_row_id = sender_jm.lid_row_id');

        // Reverse mapping: sender_jid can be LID; map it back to regular phone JID
        joins.push('LEFT JOIN jid_map sender_jm_from_lid ON sender_jm_from_lid.lid_row_id = sender_jid._id');
        joins.push('LEFT JOIN jid sender_mapped_jid ON sender_mapped_jid._id = sender_jm_from_lid.jid_row_id');
      }

      // Chat contact fallback: for 1:1 received messages where sender_jid_row_id IS NULL
      joins.push('LEFT JOIN chat msg_chat ON msg_chat._id = message.chat_row_id');
      joins.push('LEFT JOIN jid chat_contact_jid ON chat_contact_jid._id = msg_chat.jid_row_id');
      if (this.schema.hasTable('lid_display_name')) {
        joins.push('LEFT JOIN lid_display_name chat_contact_lid_direct ON chat_contact_lid_direct.lid_row_id = msg_chat.jid_row_id');
      }
      if (this.schema.hasTable('jid_map') && this.schema.hasTable('lid_display_name')) {
        joins.push('LEFT JOIN jid_map chat_jm ON chat_jm.jid_row_id = chat_contact_jid._id');
        joins.push('LEFT JOIN lid_display_name chat_contact_lid_map ON chat_contact_lid_map.lid_row_id = chat_jm.lid_row_id');
      }
    }

    const senderNameExpr = hasSenderJid
      ? `COALESCE(
          ${this.schema.hasTable('wa_contacts') ? "NULLIF(sender_contact.display_name, '')" : 'NULL'},
          ${this.schema.hasTable('wa_contacts') ? "NULLIF(sender_contact.given_name, '')" : 'NULL'},
          ${this.schema.hasTable('wa_contacts') ? "NULLIF(sender_contact.wa_name, '')" : 'NULL'},
          ${this.schema.hasTable('lid_display_name') ? "NULLIF(sender_lid_direct.display_name, '')" : 'NULL'},
          ${this.schema.hasTable('lid_display_name') ? "NULLIF(sender_lid.display_name, '')" : 'NULL'},
          ${this.schema.hasTable('jid_map') ? "NULLIF(sender_mapped_jid.user, '')" : 'NULL'},
          NULLIF(sender_jid.user, ''),
          NULLIF(sender_jid.raw_string, ''),
          ${this.schema.hasTable('lid_display_name') ? "NULLIF(chat_contact_lid_direct.display_name, '')" : 'NULL'},
          ${this.schema.hasTable('lid_display_name') ? "NULLIF(chat_contact_lid_map.display_name, '')" : 'NULL'},
          NULLIF(chat_contact_jid.user, '')
        )`
      : 'NULL';

    const mediaFilePathExpr = hasMessageMedia || hasAddonMedia
      ? `COALESCE(${hasMessageMedia ? 'mm.file_path' : 'NULL'}, ${hasAddonMedia ? 'amm.file_path' : 'NULL'})`
      : 'NULL';

    const mediaMimeTypeExpr = hasMessageMedia || hasAddonMedia
      ? `COALESCE(${hasMessageMedia ? 'mm.mime_type' : 'NULL'}, ${hasAddonMedia ? 'amm.mime_type' : 'NULL'})`
      : 'NULL';

    const mediaNameParts = [];
    if (hasMessageMedia && this.schema.hasColumn('message_media', 'media_name')) mediaNameParts.push('mm.media_name');
    if (hasAddonMedia && this.schema.hasColumn('addon_message_media', 'media_name')) mediaNameParts.push('amm.media_name');
    const mediaNameExpr = mediaNameParts.length > 1
      ? `COALESCE(${mediaNameParts.join(', ')})`
      : mediaNameParts[0] ?? 'NULL';

    const thumbnailExpr = hasMessageThumbnail
      ? 'mt.thumbnail'
      : (hasAddonMedia && this.schema.hasColumn('addon_message_media', 'thumbnail') ? 'amm.thumbnail' : 'NULL');

    const quotedExpr = hasQuoted
      ? '(SELECT text_data FROM message_quoted WHERE message_quoted.message_row_id = message._id LIMIT 1)'
      : 'NULL';

    return {
      joins: joins.join('\n      '),
      senderNameExpr,
      mediaFilePathExpr,
      mediaMimeTypeExpr,
      mediaNameExpr,
      thumbnailExpr,
      quotedExpr,
      orderColumn: hasSortId ? 'message.sort_id' : 'message._id',
    };
  }

  buildThumbnailDataUrl(thumbnailBlob, mediaMimeType) {
    if (!thumbnailBlob) return null;

    let buffer;
    if (Buffer.isBuffer(thumbnailBlob)) {
      buffer = thumbnailBlob;
    } else if (thumbnailBlob instanceof Uint8Array) {
      buffer = Buffer.from(thumbnailBlob);
    } else {
      return null;
    }

    const mimeType = typeof mediaMimeType === 'string' && mediaMimeType.startsWith('image/')
      ? mediaMimeType
      : 'image/jpeg';
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  buildMediaCandidates(candidate) {
    const raw = String(candidate || '').trim();
    if (!raw) return [];

    const normalized = raw.replace(/\\/g, '/').replace(/^\.\/+/, '');
    const variants = new Set([raw, normalized]);

    if (normalized.startsWith('Media/')) {
      variants.add(normalized.slice('Media/'.length));
    }

    if (normalized.startsWith('/Media/')) {
      variants.add(normalized.slice('/Media/'.length));
    }

    if (!normalized.startsWith('Media/') && !normalized.startsWith('/Media/')) {
      variants.add(`Media/${normalized}`);
    }

    return [...variants].filter(Boolean);
  }

  resolveMediaFile(row) {
    const candidates = [row.media_file_path, row.media_name].filter(Boolean);
    const allowedRoots = this.getAllowedMediaRoots();

    for (const candidate of candidates) {
      if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
        const absoluteCandidate = path.resolve(candidate);
        if (allowedRoots.some((root) => isPathInsideRoot(absoluteCandidate, root))) {
          return absoluteCandidate;
        }
      }

      for (const root of allowedRoots) {
        const candidateVariants = this.buildMediaCandidates(candidate);
        for (const variant of candidateVariants) {
          const resolved = path.resolve(root, variant);
          if (fs.existsSync(resolved)) {
            return resolved;
          }
        }
      }
    }

    return null;
  }

  getMessages({ chatId, limit, offset, search }) {
    this.ensureDbLoaded();

    const parsedChatId = toSafeInt(chatId, 0, 1);
    if (!parsedChatId) {
      throw new Error('chatId e obrigatorio.');
    }

    const boundedLimit = toSafeInt(limit, DEFAULT_MESSAGE_LIMIT, 1, MAX_LIMIT);
    const boundedOffset = toSafeInt(offset, 0, 0);
    const searchValue = normalizeSearch(search);
    const parts = this.buildMessageQueryParts();

    const query = `
      SELECT
        message._id,
        message.from_me,
        message.text_data,
        message.timestamp,
        ${parts.quotedExpr} AS quoted_text,
        ${parts.senderNameExpr} AS sender_name,
        ${parts.mediaFilePathExpr} AS media_file_path,
        ${parts.mediaMimeTypeExpr} AS media_mime_type,
        ${parts.mediaNameExpr} AS media_name,
        ${parts.thumbnailExpr} AS media_thumbnail
      FROM message
      ${parts.joins}
      WHERE message.chat_row_id = ?
      AND (? = '' OR LOWER(COALESCE(message.text_data, '')) LIKE ?)
      ORDER BY ${parts.orderColumn} DESC
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM message
      WHERE message.chat_row_id = ?
      AND (? = '' OR LOWER(COALESCE(message.text_data, '')) LIKE ?)
    `;

    const rows = this.db.prepare(query).all(parsedChatId, searchValue.exact, searchValue.like, boundedLimit, boundedOffset);
    const totalRow = this.db.prepare(countQuery).get(parsedChatId, searchValue.exact, searchValue.like);

    const mapped = rows
      .map((row) => {
        const mediaPath = this.resolveMediaFile(row);
        const mediaThumbnailUrl = this.buildThumbnailDataUrl(row.media_thumbnail, row.media_mime_type);
        return {
          _id: row._id,
          from_me: row.from_me === 1,
          text_data: row.text_data,
          timestamp: row.timestamp,
          quoted_text: row.quoted_text,
          sender_name: row.sender_name,
          has_media: Boolean(mediaPath || mediaThumbnailUrl),
          media_path: mediaPath,
          media_mime_type: row.media_mime_type || null,
          media_url: mediaPath ? `/api/media?path=${encodeURIComponent(mediaPath)}` : null,
          media_thumbnail_url: mediaThumbnailUrl,
        };
      })
      .reverse();

    return {
      data: mapped,
      total: totalRow?.total || 0,
    };
  }
}

function createApiApp(store) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, dbLoaded: Boolean(store.db), dbPath: store.currentDbPath });
  });

  app.post('/api/open-db', (req, res) => {
    try {
      const body = req.body || {};
      const dbPath = body.dbPath;
      const selectedMediaRoot = body.mediaRootPath;

      if (!dbPath || typeof dbPath !== 'string') {
        return res.status(400).json({ error: 'dbPath e obrigatorio.' });
      }

      store.openDatabase(dbPath, selectedMediaRoot);
      return res.json({
        ok: true,
        dbPath: store.currentDbPath,
        mediaRootPath: store.mediaRootPath,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Falha ao abrir database.' });
    }
  });

  app.get('/api/conversations', (req, res) => {
    try {
      const result = store.getConversations({
        limit: req.query.limit,
        offset: req.query.offset,
        search: req.query.search,
      });
      return res.json(result);
    } catch (error) {
      const statusCode = /Nenhum banco carregado/.test(String(error.message)) ? 400 : 500;
      return res.status(statusCode).json({ error: error.message || 'Falha ao consultar conversas.' });
    }
  });

  app.get('/api/messages', (req, res) => {
    try {
      const result = store.getMessages({
        chatId: req.query.chatId,
        limit: req.query.limit,
        offset: req.query.offset,
        search: req.query.search,
      });
      return res.json(result);
    } catch (error) {
      const statusCode = /chatId e obrigatorio/.test(String(error.message)) || /Nenhum banco carregado/.test(String(error.message)) ? 400 : 500;
      return res.status(statusCode).json({ error: error.message || 'Falha ao consultar mensagens.' });
    }
  });

  app.get('/api/media', (req, res) => {
    try {
      store.ensureDbLoaded();
      const requested = String(req.query.path || '');
      if (!requested) {
        return res.status(400).json({ error: 'path e obrigatorio.' });
      }

      const absolute = path.resolve(requested);
      const allowedRoots = store.getAllowedMediaRoots();
      const isAllowed = allowedRoots.some((root) => isPathInsideRoot(absolute, root));

      if (!isAllowed) {
        return res.status(403).json({ error: 'Acesso negado ao arquivo solicitado.' });
      }

      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        return res.status(404).json({ error: 'Arquivo de midia nao encontrado.' });
      }

      const mimeType = mime.lookup(absolute) || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      return fs.createReadStream(absolute).pipe(res);
    } catch (error) {
      const statusCode = /Nenhum banco carregado/.test(String(error.message)) ? 400 : 500;
      return res.status(statusCode).json({ error: error.message || 'Falha ao carregar midia.' });
    }
  });

  return app;
}

async function startBackendServer() {
  const store = new ArchiveStore();
  const app = createApiApp(store);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  const address = server.address();
  const port = typeof address === 'string' ? 0 : address.port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        store.closeDatabase();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

module.exports = {
  ArchiveStore,
  createApiApp,
  startBackendServer,
};
