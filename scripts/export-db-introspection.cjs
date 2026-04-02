const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const [dbPathArg, outputDirArg] = process.argv.slice(2);

if (!dbPathArg) {
  console.error('Uso: node scripts/export-db-introspection.cjs <caminho-do-db> [diretorio-saida]');
  process.exit(1);
}

const dbPath = path.resolve(dbPathArg);
const outputDir = path.resolve(outputDirArg || './introspection-output');

if (!fs.existsSync(dbPath)) {
  console.error(`Arquivo não encontrado: ${dbPath}`);
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const tables = db
  .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all();

const schemaOutput = tables
  .map((table) => `-- ${table.name}\n${table.sql || '-- sem SQL armazenado'}\n`)
  .join('\n');

fs.writeFileSync(path.join(outputDir, 'schema.sql'), schemaOutput, 'utf-8');

const tableInfo = {};

for (const table of tables) {
  const columns = db.prepare(`PRAGMA table_info(${table.name})`).all();
  const count = db.prepare(`SELECT COUNT(*) AS total FROM ${table.name}`).get().total;

  let sample = [];
  try {
    sample = db.prepare(`SELECT * FROM ${table.name} LIMIT 5`).all();
  } catch {
    sample = [];
  }

  tableInfo[table.name] = {
    columns,
    totalRows: count,
    sample,
  };
}

fs.writeFileSync(path.join(outputDir, 'tables.json'), JSON.stringify(tableInfo, null, 2), 'utf-8');

console.log(`Schema salvo em: ${path.join(outputDir, 'schema.sql')}`);
console.log(`Estrutura e amostras salvas em: ${path.join(outputDir, 'tables.json')}`);
