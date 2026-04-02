# WA Viewer Pro Desktop

Aplicativo desktop (Electron) para abrir e consultar `msgstore.db` do WhatsApp com backend local.

## O que mudou

- Migração de app web puro para app desktop Electron.
- Backend local em Node.js (dentro do Electron) com API HTTP para consultas.
- Remoção do suporte a arquivos criptografados (`.crypt12`, `.crypt14`, `.crypt15`).
- Paginação de mensagens com scroll infinito (carrega mais ao rolar para cima).
- Busca de mensagens dentro da conversa.
- Tentativa de resolução de nome de contato e remetente de grupos (via tabelas `jid` e `wa_contacts`).
- Tentativa de exibição de mídias quando houver referência no banco e arquivo físico acessível.

## Requisitos

- Node.js 20+
- npm 10+

## Executando em desenvolvimento

```bash
npm install
npm run dev
```

Isso sobe:

- Frontend Vite em `http://localhost:5173`
- Janela Electron apontando para esse frontend
- Backend local (porta dinâmica em localhost)

## Build de executáveis

Build padrão no Linux (gera AppImage e .deb):

```bash
npm run build
```

Artefatos em `release/`.

Para gerar instalador Windows (`.exe`/NSIS), execute em um ambiente Windows:

```bash
npm run build -- --win
```

Para Linux:

```bash
npm run build -- --linux
```

## Uso no app

1. Clique em "Selecionar msgstore.db".
2. (Opcional) Clique em "Selecionar pasta de mídias" e escolha a pasta que contém diretórios como `WhatsApp Images`, `WhatsApp Video`, etc.
3. Selecione uma conversa.
4. Role para cima para carregar mensagens antigas.
5. Use a busca no topo do chat para filtrar mensagens daquela conversa.

## Limitações atuais

- Apenas bancos SQLite não criptografados.
- Nomes de contato/remetente dependem da estrutura e qualidade de dados em `wa_contacts`.
- Exibição de mídia depende de correspondência entre caminhos da tabela e arquivos no disco.

## Como extrair estrutura de um DB grande (ex.: 500MB)

Para analisar schema e amostras de tabelas, rode:

```bash
node scripts/export-db-introspection.cjs "/caminho/msgstore.db" "./introspection-output"
```

Arquivos gerados:

- `introspection-output/schema.sql`
- `introspection-output/tables.json`

Com isso é possível mapear melhor tabelas extras do seu dump real e melhorar consultas (nomes, mídia, status, etc.).
