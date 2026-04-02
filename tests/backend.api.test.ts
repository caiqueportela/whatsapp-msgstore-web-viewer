import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import Database from 'better-sqlite3';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { ArchiveStore, createApiApp } = require('../electron/backend.cjs');

describe('backend API', () => {
  let tempDir: string;
  let dbPath: string;
  let mediaRootPath: string;
  let store: any;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-viewer-test-'));
    mediaRootPath = path.join(tempDir, 'media');
    fs.mkdirSync(path.join(mediaRootPath, 'WhatsApp Images'), { recursive: true });

    const mediaFilePath = path.join(mediaRootPath, 'WhatsApp Images', 'sample.jpg');
    fs.writeFileSync(mediaFilePath, 'fake-image-data');

    dbPath = path.join(tempDir, 'msgstore.db');
    const db = new Database(dbPath);

    db.exec(`
      CREATE TABLE jid (_id INTEGER PRIMARY KEY, user TEXT, server TEXT, raw_string TEXT);
      CREATE TABLE jid_map (lid_row_id INTEGER PRIMARY KEY, jid_row_id INTEGER NOT NULL);
      CREATE TABLE lid_display_name (lid_row_id INTEGER PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, username TEXT);
      CREATE TABLE chat (_id INTEGER PRIMARY KEY, jid_row_id INTEGER UNIQUE, subject TEXT, sort_timestamp INTEGER);
      CREATE TABLE message (_id INTEGER PRIMARY KEY, chat_row_id INTEGER NOT NULL, from_me INTEGER NOT NULL, key_id TEXT NOT NULL, sender_jid_row_id INTEGER, timestamp INTEGER, text_data TEXT, sort_id INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE message_media (message_row_id INTEGER PRIMARY KEY, file_path TEXT, mime_type TEXT, media_name TEXT);
    `);

    db.exec(`
      INSERT INTO jid(_id, user, server, raw_string) VALUES (1, '5511999990000', 's.whatsapp.net', '5511999990000@s.whatsapp.net');
      INSERT INTO jid(_id, user, server, raw_string) VALUES (2, '5511988881111', 's.whatsapp.net', '5511988881111@s.whatsapp.net');
      INSERT INTO jid_map(lid_row_id, jid_row_id) VALUES (10, 1);
      INSERT INTO lid_display_name(lid_row_id, display_name, username) VALUES (10, 'Contato Teste', 'contato_teste');
      INSERT INTO chat(_id, jid_row_id, subject, sort_timestamp) VALUES (10, 1, NULL, 1712010000000);
      INSERT INTO message(_id, chat_row_id, from_me, key_id, sender_jid_row_id, timestamp, text_data, sort_id) VALUES (100, 10, 0, 'k1', 2, 1712010000100, 'oi', 1);
      INSERT INTO message(_id, chat_row_id, from_me, key_id, sender_jid_row_id, timestamp, text_data, sort_id) VALUES (101, 10, 0, 'k2', 2, 1712010000200, NULL, 2);
      INSERT INTO message_media(message_row_id, file_path, mime_type, media_name) VALUES (101, 'WhatsApp Images/sample.jpg', 'image/jpeg', 'sample.jpg');
    `);

    db.close();

    store = new ArchiveStore();
    store.openDatabase(dbPath, mediaRootPath);
  });

  afterEach(() => {
    if (store) {
      store.closeDatabase();
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('retorna conversas com display_name', async () => {
    const app = createApiApp(store);
    const response = await request(app).get('/api/conversations?limit=10&offset=0&search=').expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.data[0].display_name).toBe('Contato Teste');
  });

  it('retorna mensagens e url de midia resolvida', async () => {
    const app = createApiApp(store);
    const response = await request(app).get('/api/messages?chatId=10&limit=10&offset=0&search=').expect(200);

    expect(response.body.total).toBe(2);
    expect(response.body.data[1].has_media).toBe(true);
    expect(response.body.data[1].media_url).toContain('/api/media?path=');
  });

  it('bloqueia tentativa de acessar arquivo fora da raiz permitida', async () => {
    const app = createApiApp(store);
    const response = await request(app)
      .get(`/api/media?path=${encodeURIComponent('/etc/passwd')}`)
      .expect(403);

    expect(response.body.error).toContain('Acesso negado');
  });
});
