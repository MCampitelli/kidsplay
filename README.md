# KidsPlay - Streaming para TV

Aplicação de streaming infantil otimizada para navegação em TV.

## 🚀 Recursos

- **Login local**: autenticação do responsável pela API MariaDB e seleção de perfil infantil
- **Interface Limpa**: Navbar (rola com a página) com logo, nome do perfil e menu ☰ com **Trocar perfil** e **Sair**
- **Fileiras por categoria**: a tela inicial mostra uma fileira de capas por tag ativa, seguida da fileira **Desenhos** com todos os títulos publicados
- **Tela do desenho**: capa, descrição, botão de favoritar e grade de episódios
- **Player para TV**: HLS com fallback para MP4, próximo episódio automático e controles que somem durante a reprodução
- **Área dos Pais** (`/pais/`): app web para celular, instalável na tela inicial, com perfis, bloqueio de desenhos, limite diário, histórico, "assistindo agora" e sugestões de desenhos
- **Cores Vibrantes**: Paleta infantil mantida (coral, laranja, amarelo, turquesa, verde, roxo)

## 📂 Estrutura de Arquivos

```
src/
├── App.tsx              # estado global e roteamento entre telas (TV)
├── screens/             # CredentialsScreen, ProfileScreen, HomeScreen,
│                        # ShowEpisodesScreen, PlayerScreen, TimeUpScreen
├── components/          # Navbar, EpisodeCard, PlayerIcons
├── parents/             # Área dos Pais (pais/index.html → /pais/), mobile first
├── hooks/               # useFavoriteShows, useTvRemoteNavigation
├── lib/tvNavigation.ts  # navegação espacial por setas (controle remoto)
├── services/            # cliente da API, autenticação e perfis
└── types/               # catalog.ts (Show/Episode) e profile.ts

files/<Desenho>/*.mp4    # vídeos de origem (servidos em /files)
video-processing/        # pipeline HLS e thumbnails (servidos em /hls e /thumbnails)
api/                     # API local/independente (MariaDB)
catalog-admin/, electron/  # Controle administrativo (web e Windows)
public/data/profiles.json  # origem dos perfis para o primeiro seed
```

## 🎮 Navegação

### Login do responsável
- Use o e-mail e a senha da conta local criada pelo seed MariaDB.
- A senha é verificada no backend e a sessão usa cookie `HttpOnly`; credenciais MariaDB não vão para o navegador.

### Área dos Pais (celular)
- Endereço: `/pais/` (ex.: `http://192.168.1.9:8443/pais/` na rede local). Mesma conta do KidsPlay. Pode ser **salva na tela inicial**: botão **Instalar** no Android/Chrome; no iPhone, Safari → Compartilhar → **Adicionar à Tela de Início**.
- **Perfis**: criar, editar (nome e figurinha) e excluir. **Excluir é definitivo**: o perfil é apagado do MariaDB junto com preferências, histórico, tempo de tela e bloqueios, sem opção de recuperação. É intencional, por se tratar de dados de crianças.
- **Agora**: o que a criança está assistindo, em tempo real (atualiza a cada 15 s; some 45 s depois que o vídeo para).
- **Tempo**: limite diário (atalhos de 30 min a 2 h ou valor livre, até 10 h). Conta só o tempo com o vídeo tocando e recomeça à meia-noite do fuso `KIDSPLAY_TIMEZONE` (padrão `America/Sao_Paulo`). Ao esgotar, a TV mostra **Hora de descansar**. Gráfico dos últimos 7 dias.
- **Desenhos**: bloquear por perfil; o servidor omite o desenho do catálogo daquele perfil na TV.
- **Histórico**: episódios por dia, horário, até onde assistiu e se terminou.
- **Sugerir desenho**: o pedido aparece na aba **Sugestões** do Controle; o status e a resposta voltam para a família.

### Tela de seleção de perfil (TV)
- **Setas Cima/Baixo**: Navegar entre crianças e o botão **Sair da conta** (a lista é circular)
- **Enter**: Selecionar criança e entrar
- Cada aparelho lembra o perfil em uso: recarregar o app volta direto para ele. Os perfis são criados na Área dos Pais.

### Tela Principal
- **Setas Esquerda/Direita**: Navegar entre capas da mesma fileira
- **Setas Cima/Baixo**: Trocar de fileira (categoria)
- **Enter**: Abrir o desenho; **Esc/Voltar** retorna à tela inicial com o foco na mesma capa
- **Trocar perfil**: Voltar para a seleção de perfil
- **Sair**: Encerrar a sessão e voltar para a tela de login

### Player
- **Espaço/Enter**: Reproduzir ou pausar (com os controles ocultos, o primeiro Enter só os exibe)
- **← / →**: Voltar ou avançar 10 segundos (com os controles ocultos ou a barra de progresso selecionada; segurar repete). Com um botão selecionado, as setas navegam entre os botões
- **↑ / ↓**: Com os controles ocultos, exibem os controles a partir do Play
- **M**: Mudo · **F**: Tela cheia · **Esc/Voltar**: Sair do player
- **Fim do episódio**: nos últimos 4 segundos aparece, no canto, o aviso do próximo episódio, que começa sozinho em 10 segundos. "Voltar aos episódios" (ou o fim do último episódio) retorna à lista

## 📝 Arquivos de Dados

### `public/data/profiles.json`
Contém os perfis infantis (id estável, usado como chave dos favoritos em `localStorage`):
```json
[
  {
    "id": 1,
    "name": "Criança 1"
  }
]
```
Esse arquivo é usado apenas como origem dos nomes de perfil pelo seed local. Em execução, os perfis são carregados e gravados no MariaDB por `src/services/profileService.ts` e `api/localApi.ts`.

O KidsPlay carrega os títulos pela API local `GET /api/catalog`, que consulta as tabelas `titles`, `seasons`, `episodes` e `media_assets` do MariaDB. Cadastre e edite títulos, temporadas, episódios e mídia no Controle; `public/data/shows.json` não é fonte da tela principal.

## 🛠️ Instalação e Execução

### Requisitos
- Node.js >= 22.12.0
- pnpm

### Passos

1. **Instalar dependências**:
```bash
pnpm install --frozen-lockfile
```

2. **Modo Desenvolvimento**:
```bash
pnpm dev
```
Acesse: `http://localhost:8443/`

3. **Build para Produção**:
```bash
pnpm build
```

### API local MariaDB

1. Copie as variáveis `KIDSPLAY_*` de `.env.example` para o `.env` local (já ignorado pelo Git). Configure usuário/senha MariaDB e uma senha de teste com pelo menos 12 caracteres. Não use prefixo `VITE_` nessas credenciais.
2. Em instalação nova, aplique `database/schema.sql` ao banco `kidsplay_db`. Para banco existente, use somente `pnpm db:migrate` (migrações aditivas).
3. Crie a conta local e os perfis existentes no JSON:
```bash
pnpm seed:local-user
```
O seed cria a conta somente se o e-mail ainda não existir, guarda senha em hash `scrypt`, reaproveita os perfis `Criança 1–3`, preserva IDs quando livres e não cria títulos nem episódios. Pode ser executado novamente sem duplicar a conta ou os perfis.
4. Reinicie `pnpm dev` após mudar variáveis `.env` e entre com o e-mail/senha configurados. A API local oferece `/api/auth/login`, `/api/auth/session`, `/api/auth/logout` e CRUD autenticado em `/api/profiles`.

A API pode continuar embutida no Vite ou rodar separadamente com `pnpm api:dev`. No segundo caso, defina `KIDSPLAY_API_TARGET=http://127.0.0.1:8788` no processo do Vite; `/api` será encaminhado ao backend. A build estática não inclui o backend.

Consulte [Configuração e backend compartilhado](./docs/backend.md) para ambientes, TLS MariaDB remoto, comandos, cookies, CORS/CSRF, migrações, provisionamento administrativo e reversão. No PowerShell com scripts bloqueados, use `pnpm.cmd`.

### Controle local

O Controle de configuração é separado da experiência KidsPlay e fica disponível somente no computador local:

```bash
pnpm catalog:admin
```

Abra `http://127.0.0.1:8787/` e entre com uma conta administrativa existente. Nenhuma conta é promovida automaticamente: use `pnpm admin:role grant email-da-conta-existente --confirm` como operador autorizado. Nas abas **Contas**, **Títulos**, **Temporadas**, **Episódios**, **Arquivos de mídia** e **Tags / Categorias** é possível criar e editar cadastros. Contas podem ser ativadas, pendentes ou suspensas; registros não são apagados pelo Controle. Senhas têm mínimo de 12 caracteres e são armazenadas com hash `scrypt`. O Controle usa a configuração compartilhada `KIDSPLAY_DB_*` e escuta apenas em `127.0.0.1`.

Em **Arquivos de mídia**, informe apenas o caminho do MP4 dentro de `files/`. O MP4 é registrado imediatamente; um worker local gera a thumbnail quando necessário, valida/reutiliza HLS existente e converte somente quando precisa. O status, retry por episódio e processamento de todos os pendentes ficam nesse painel. O worker processa um vídeo por vez e para junto com o Controle ao pressionar `Ctrl+C` no terminal.

### KidsPlay Admin para Windows

O KidsPlay Admin é um aplicativo Electron que reutiliza as telas de administração e a API independente. Ele não inicia nem encerra o backend, não acessa MariaDB pelo Renderer e exige uma conta autorizada pelo servidor.

```powershell
pnpm.cmd electron:dev
```

Na primeira execução, informe a origem HTTPS da API; HTTP só é aceito para loopback durante desenvolvimento. A URL é guardada no perfil do usuário do Windows. Em desenvolvimento, `KIDSPLAY_ADMIN_API_URL` em `.env` ou no ambiente pode definir a origem padrão. O backend é iniciado separadamente com `pnpm.cmd api:dev`.

Para criar e testar o instalador Windows x64:

```powershell
pnpm.cmd electron:pack:dir
pnpm.cmd electron:build
```

Os artefatos ficam em `release/`. O instalador inclui apenas a interface/processo Electron; não inclui backend, MariaDB ou credenciais. Para executar em outro computador, instale o KidsPlay Admin, configure uma API HTTPS alcançável e use a mesma conta existente, provisionada como administradora no servidor. O backend e os arquivos de mídia precisam permanecer disponíveis. O formulário de mídia recebe caminhos do host do backend; não há upload de arquivos locais no aplicativo.

Veja [KidsPlay Admin (Electron)](./docs/electron-admin.md) para detalhes de sessão, rede, instalação, atualização e limitações.

### Tags e categorias da tela inicial

- Em **Tags / Categorias**, crie e pesquise tags, edite nome e descrição, defina a ordem e ative/desative categorias. A lista informa a quantidade de títulos associados, incluindo rascunhos e arquivados.
- O nome aceita até 100 caracteres e a descrição até 255. O slug é gerado automaticamente ao salvar o nome, inclusive na edição: `Para os Pequenos` vira `para-os-pequenos`. Nomes que geram um slug já existente são rejeitados, mesmo se a outra tag estiver desativada.
- Em **Títulos**, o campo **Tags / Categorias** permite pesquisar, marcar várias opções e remover individualmente as tags selecionadas. Clique em **Salvar título** para persistir as alterações.
- Somente tags ativas estão disponíveis para novas associações. Tags desativadas já associadas continuam selecionadas e identificadas como **desativada**; salvar outros campos não as remove. A remoção deve ser explícita. Depois de removidas e salvas, não podem ser associadas novamente enquanto estiverem desativadas.
- O título e suas associações são salvos na mesma transação. Na API do Controle, `tagIds` omitido preserva as relações; `tagIds: []` remove todas. IDs repetidos, inexistentes ou novas associações a tags desativadas são rejeitados.
- A TV exibe categorias ativas que tenham pelo menos um título **Publicado**. Rascunhos e arquivados não aparecem na tela inicial. A seção **Desenhos** permanece com todos os títulos publicados, inclusive os que não têm tags; um mesmo título pode aparecer em várias fileiras sem duplicar seu cadastro.
- Categorias são ordenadas por `title_tags.display_order`, com desempate por nome e ID; títulos usam `titles.display_order`, nome e ID, preservando os critérios do catálogo. Valores menores aparecem primeiro.
- A rota existente `GET /api/catalog` continua retornando uma lista de títulos, agora com `tags`. A API faz uma consulta de catálogo e uma consulta em lote das tags ativas relacionadas a títulos publicados: não há consulta por título nem cruzamento das tags com cada mídia/episódio.
- As alterações são refletidas pela atualização existente do catálogo, a cada 60 segundos (e imediatamente quando o app volta a ficar visível), sem reiniciar os servidores. As capas são carregadas sob demanda (`loading="lazy"`); montar fileiras não faz download de vídeos. Setas navegam entre capas e fileiras, Enter abre o título e voltar restaura o foco na mesma categoria.
- Tags são globais e não alteram os favoritos por perfil.

As tabelas `title_tags` e `title_tag_relations` devem existir no banco configurado. A funcionalidade não cria, recria nem migra estruturas e não publica ou reclassifica títulos existentes automaticamente.

### Validação de tags

```bash
pnpm test:tags
pnpm test:tags:integration
pnpm test:media
pnpm exec tsc --noEmit
pnpm build
```

O teste de integração exige MariaDB configurado e migrações aplicadas. Ele inicia uma API temporária em porta livre, cria sua própria conta administrativa de teste e seus próprios títulos e tags, valida persistência e catálogo HTTP e remove essas fixtures ao terminar. Não executa DDL nem altera cadastros existentes. `pnpm test:integration` também valida login, sessões, perfis, isolamento e autorização. Os testes unitários não precisam de banco.

## 🎨 Personalização

### Adicionar/editar/remover perfis
Use a **Área dos Pais** (`/pais/`) no celular. A exclusão de perfil é definitiva (veja acima). `public/data/profiles.json` é somente a origem dos nomes para o primeiro seed; depois disso, a API persiste os perfis no MariaDB.

### Adicionar Novos Desenhos
1. No Controle, cadastre o título na aba **Títulos**.
2. Cadastre a temporada e os episódios nas abas correspondentes.
3. Em **Arquivos de mídia**, associe o caminho do MP4. A miniatura e o HLS são processados automaticamente.

## 🎬 Tecnologias

- React 19
- Vite 8
- Tailwind CSS v4
- TypeScript

## 📺 Otimização para TV

- Navegação por setas/controle remoto
- Foco visível com borda amarela
- Cards com tamanho apropriado para telas grandes
- Interface simplificada e limpa

## 🔐 Notas de Segurança

- O backend local armazena apenas hash `scrypt` para senhas e hash SHA-256 para tokens de sessão.
- As credenciais MariaDB ficam no `.env` local e nunca usam o prefixo `VITE_`.
- O backend independente exige autorização administrativa e pode ser iniciado sem o Vite. Antes de publicar, configure HTTPS, origens explícitas, cookies seguros, gestão de segredos, infraestrutura de mídia e revisão de privacidade para dados infantis; veja [backend](./docs/backend.md).
