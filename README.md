# Telegram AI Marketing Agency

MVP de uma agencia de marketing com IA rodando no Telegram.

Status: prototipo/lab de portfolio, nao produto final.

## Features

- Bot conversacional no Telegram com grammY
- Multi-cliente via arquivos Markdown
- Calendario semanal e posts avulsos
- Pesquisa sob demanda
- Direcao visual e geracao de imagem sob aprovacao
- Controle local de uso estimado

## Stack

- Node.js
- TypeScript
- grammY
- OpenAI API
- Storage local em JSON/Markdown

## Setup

1. Copie .env.example para .env
2. Preencha TELEGRAM_BOT_TOKEN e OPENAI_API_KEY
3. Rode npm install
4. Rode npm run dev

## Segurança

- Nunca commitar .env
- data/ fica fora do git
- knowledge/clientes usa apenas cliente ficticio neste repo publico

## Licenca

MIT
