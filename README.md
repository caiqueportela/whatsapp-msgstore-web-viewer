# WA Viewer Pro Desktop

Aplicativo desktop em Electron para abrir e navegar mensagens de `msgstore.db` localmente, com backend HTTP interno para consulta.

## Arquitetura

- Renderer: React + Vite (sem acesso direto ao SQLite).
- Backend local: Node.js/Express dentro do processo desktop.
- Banco: acessado somente no backend via `better-sqlite3`.
- IPC: seleção de arquivos/pastas exposta pelo preload do Electron.

## Principais recursos

- Abertura de banco por seletor de arquivo ou drag-and-drop de `msgstore.db`.
- Seleção opcional de pasta de mídias.
- Lista de conversas com busca.
- Chat com paginação e scroll infinito ao subir.
- Busca de mensagens por conversa.
- Exibição de mídia quando o arquivo existe em raiz permitida.
- Resolução de nomes usando estrutura disponível no banco (`wa_contacts`, `jid_map`, `lid_display_name`, etc.).

## Requisitos

- Node.js 20+
- npm 10+

## Desenvolvimento

```bash
npm install
npm run dev
```

O comando inicia:

- Frontend Vite em `http://localhost:5173`
- Janela Electron
- Backend local em porta dinâmica (localhost)

## Testes

```bash
npm run test
```

Comandos adicionais:

```bash
npm run test:watch
npm run test:coverage
```

## Build

Build padrão (plataforma atual):

```bash
npm run build
```

Build Linux:

```bash
npm run build:linux
```

Build Windows (em runner/ambiente Windows):

```bash
npm run build:win
```

Artefatos são gerados em `release/`.

## Release no GitHub

Workflow: `.github/workflows/release.yml`

- Executa testes.
- Gera artefatos Linux e Windows.
- Publica release com anexos.

Disparo automático por tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Também pode ser executado manualmente via `workflow_dispatch`.

## Uso no app

1. Arraste `msgstore.db` na tela inicial ou clique em selecionar arquivo.
2. Opcionalmente selecione a pasta de mídias (`WhatsApp Images`, `WhatsApp Video` etc.).
3. Escolha uma conversa.
4. Role para cima para carregar mensagens antigas.
5. Use busca na conversa para filtrar mensagens.

## Limitações

- Suporte apenas a bancos SQLite não criptografados.
- Exibição de mídia depende da existência física do arquivo e de caminho resolvível.

## Introspecção de DB grande

Para extrair schema e metadados de tabelas de um banco grande:

```bash
node scripts/export-db-introspection.cjs "/caminho/msgstore.db" "./introspection-output"
```

Saída esperada:

- `introspection-output/schema.sql`
- `introspection-output/tables.json`
