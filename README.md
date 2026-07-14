# Telegram AI Marketing Agency

MVP de uma agencia de marketing com IA no Telegram, usando Node.js, TypeScript, grammY e OpenAI API.

> Status: prototipo/lab de portfolio. Este projeto documenta uma experiencia real de construcao de um agente conversacional para marketing, nao um produto final pronto para clientes.

## Portfolio Pitch

**Telegram AI Marketing Agency** e um prototipo de agencia de conteudo com IA, multi-cliente, pesquisa sob demanda, geracao de posts e direcao visual, com aprovacoes humanas e controle de custo.

O objetivo foi explorar, na pratica, ate onde um bot no Telegram poderia atuar como uma pequena agencia de marketing: entender contexto de clientes, planejar pautas, criar posts, pesquisar temas atuais, propor direcao visual e gerar imagens somente depois de confirmacao explicita.

## Features

- Bot conversacional no Telegram com grammY.
- Multi-cliente via arquivos Markdown.
- Calendario semanal e posts avulsos.
- Pesquisa sob demanda para enriquecer temas.
- Direcao visual e geracao de imagem sob aprovacao.
- Controle local de uso estimado.
- Estado por usuario salvo em arquivos locais.
- Base de conhecimento editavel em Markdown.

## Stack

- Node.js
- TypeScript
- grammY
- OpenAI API
- Storage local em JSON/Markdown
 
## Setup 
 
1. Copie .env.example para .env. 
2. Preencha TELEGRAM_BOT_TOKEN e OPENAI_API_KEY. 
3. Rode npm install. 
4. Rode npm run dev.
 
## Topics Sugeridos 
 
telegram-bot, ai-agents, openai, typescript, grammy, marketing-automation, content-generation 
 
## Portfolio 
 
Apresente como: prototipo de agencia de conteudo com IA, multi-cliente, pesquisa sob demanda, geracao de posts e direcao visual, com aprovacoes humanas e controle de custo.
 
## Seguranca 
 
- Nunca commitar .env. 
- data/ fica fora do git. 
- knowledge/clientes usa apenas cliente ficticio neste repositorio publico. 
 
## Licenca 
 
MIT
