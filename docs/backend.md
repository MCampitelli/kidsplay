# Backend compartilhado - Fase B

## Arquitetura e compatibilidade

Node.js >= 22.12.0 e o driver MariaDB existente continuam sendo utilizados.
Não há novo framework, sistema de contas, senha administrativa fixa ou token de autenticação adicional.

- `config/environment.mjs` carrega e valida os ambientes.
- `config/database.mjs` cria os pools. Cada processo tem seu próprio pool; credenciais e regras de conexão não são duplicadas.
- `api/localApi.ts` fornece a mesma implementação de autenticação, catálogo e perfis ao servidor Node e ao adaptador Vite.
- `api/catalogAdmin.mjs` reaproveita o Controle e sua fila de mídia, sem duplicar regras.
- `api/httpServer.ts` monta a API independente e as operações administrativas.
- `src/services/apiClient.ts` centraliza a URL da API e envia cookies.

O Vite mantém a API embutida por padrão para preservar `pnpm dev`.
Ao definir `KIDSPLAY_API_TARGET`, passa a encaminhar `/api` ao backend independente, sem inicializar outro pool/API local.
Isso também funciona no preview. O build estático não contém servidor nem credenciais MariaDB.

O backend independente preserva os contratos:

| Rota | Acesso |
|---|---|
| `GET /api/health` | Verificação de conexão, sem detalhes do banco |
| `GET /api/catalog` | Catálogo publicado, público como antes |
| `POST /api/auth/login` | Conta existente ativa |
| `GET /api/auth/session` | Sessão válida |
| `POST /api/auth/logout` | Revogação da sessão atual |
| `GET/POST /api/profiles` | Perfis da própria conta |
| `PUT/DELETE /api/profiles/:id` | Perfil da própria conta |
| `/api/admin/status` | Administrador |
| `/api/admin/catalog`, `/api/admin/catalog/tags` | Administrador |
| `/api/admin/catalog/titles`, `/seasons`, `/episodes`, `/assets` | Administrador, usando o prefixo completo `/api/admin/catalog` |
| `/api/admin/accounts` e `/api/admin/media-processing/*` | Administrador |

O Controle local em `127.0.0.1:8787` mantém suas rotas antigas, mas agora exige login administrativo.
Sua página de login é a única mudança de interface desta fase; não é o aplicativo Electron nem o Controle dos Pais.

## Ambientes

Execute os comandos na raiz do projeto. No PowerShell com scripts bloqueados, use `pnpm.cmd` em vez de `pnpm`; não é necessário alterar a política de execução.

A precedência é: `.env`, `.env.local`, `.env.<ambiente>`, `.env.<ambiente>.local`, variáveis do processo.
Os arquivos são lidos sem modificar `process.env`. Valores são literais; não use interpolação `${VAR}` dentro deles.
`KIDSPLAY_ENV` (ou `NODE_ENV`) seleciona `development`, `test` ou `production` para os comandos Node.
O Vite seleciona seu ambiente por `--mode`. Reinicie os serviços após alterar configurações.
Somente `.env.example` pode ser versionado; arquivos com valores reais continuam ignorados.

Preservadas: `KIDSPLAY_DB_HOST`, `KIDSPLAY_DB_PORT`, `KIDSPLAY_DB_NAME`, `KIDSPLAY_DB_USER`, `KIDSPLAY_DB_PASSWORD`.
O usuário é obrigatório; a senha deve estar definida (vazia apenas em desenvolvimento).
Host, porta e nome mantêm os defaults locais. Portas e valores booleanos inválidos interrompem a inicialização.

Para MariaDB remoto, altere apenas esses parâmetros e, quando aplicável:

- `KIDSPLAY_DB_SSL=true`: TLS com validação de certificado.
- `KIDSPLAY_DB_SSL_CA`: caminho local do certificado CA, se o serviço remoto exigir CA particular.

Não há desativação da validação de certificado. Use usuário do banco com privilégios mínimos, regras de rede e backup.
O usuário de execução não precisa de privilégios de migração/provisionamento; estes podem ser fornecidos separadamente ao processo CLI.
Nunca coloque credenciais no prefixo público `KIDSPLAY_PUBLIC_`, no renderer Electron ou no pacote estático.
Não foi feita migração para banco remoto nem deploy.

## Inicialização

### Fluxo existente (API embutida)

```powershell
pnpm.cmd db:migrate
pnpm.cmd dev
```

Streaming: `http://localhost:8443`. Saúde: `http://localhost:8443/api/health`.
Em instalação nova, crie o banco e aplique `database/schema.sql` primeiro; seu `USE kidsplay_db` é explícito.
Para outro nome de banco, selecione/revise esse alvo antes de aplicar o schema inicial. Não execute esse schema como atualização de um banco existente.
O runner de migrações usa o banco selecionado pela configuração, sem `USE` fixo.

### Frontend e backend separados (recomendado)

Terminal 1:

```powershell
pnpm.cmd api:dev
```

Terminal 2:

```powershell
$env:KIDSPLAY_API_TARGET = 'http://127.0.0.1:8788'
pnpm.cmd dev
```

`api:dev` compila e inicia o backend; reinicie esse comando após editar seu código (não é um watcher).
`KIDSPLAY_API_HOST` e `KIDSPLAY_API_PORT` configuram a escuta, com defaults `127.0.0.1` e `8788`.
Verifique `http://127.0.0.1:8788/api/health` e `http://localhost:8443/api/health`.
Uma falha de banco/porta/migração impede a inicialização, em vez de produzir uma API aparentemente saudável.

Para executar uma compilação já gerada:

```powershell
pnpm.cmd build:api
pnpm.cmd api:start
```

Os artefatos ficam em `build/backend`; execute a partir da raiz.
O runtime compilado usa Node e MariaDB, sem depender do Vite. Mantenha os recursos de mídia e diretórios de trabalho disponíveis ao backend.
O Controle local continua disponível com `pnpm.cmd catalog:admin`.

### URL direta (opcional)

`KIDSPLAY_PUBLIC_API_BASE_URL` é uma origem HTTP(S), sem `/api`, credenciais, query ou fragmento.
Vazio mantém chamadas relativas e o proxy, evitando CORS. Essa variável é pública e é incorporada ao build.
Se configurar origem diferente, inclua a origem exata do frontend em `KIDSPLAY_ALLOWED_ORIGINS` no backend e use o mesmo hostname local para os cookies.
`localhost` e `127.0.0.1` não são o mesmo site.

A API não move nem copia os vídeos. As rotas `/files`, `/hls` e `/thumbnails` continuam na infraestrutura atual do Vite.
Em produção, configure o servidor/proxy de mídia explicitamente; somente subir o backend não publica o acervo.
Os aplicativos futuros devem consumir a mesma API e o mesmo sistema de sessões.

## Autenticação, CORS e CSRF

Senhas continuam em hash `scrypt` e tokens aleatórios de 32 bytes continuam armazenados somente como SHA-256 em `user_sessions`.
Sessões expiram em 14 dias, são revogadas no logout e exigem conta ativa em cada uso.
O cookie é host-only, `HttpOnly`, `SameSite=Strict`, `Path=/`; `Secure` é obrigatório em produção.
Login/sessão acrescentam `user.role` sem remover campos existentes.
Falha de revogação retorna erro, não sucesso; a interface informa a falha e permite tentar novamente.

Todas as mutações exigem `Content-Type: application/json`, inclusive logout e DELETE.
Origens fornecidas são comparadas integralmente, sem wildcard. `Origin: null` e origens malformadas são recusadas.
Essa combinação evita mutações por formulários cross-origin sem introduzir um segundo token.
Preflight só é aceito para origens permitidas. Cookies são enviados com `credentials: include`.
Há limite local de 20 tentativas de login por IP em 15 minutos, sem registrar e-mail/senha/token.
Não há confiança automática em `X-Forwarded-For`.

Produção exige:

1. HTTPS no frontend e API; configure `KIDSPLAY_COOKIE_SECURE=true`.
2. `KIDSPLAY_ALLOWED_ORIGINS` com origens HTTPS exatas, separadas por vírgula, inclusive a origem da própria API se hospedar uma interface ali.
3. Preferir reverse proxy de mesma origem (`/api`). Subdomínios HTTPS do mesmo site podem usar a mesma API; cada aplicação faz login usando a conta existente.
4. Não presumir cookies entre sites não relacionados: `SameSite=Strict` os bloqueia. Não relaxe a política sem reprojetar CSRF e avaliar restrições de cookies de terceiros.
5. Proxy confiável, limitação de requisições compartilhada no gateway quando houver múltiplas instâncias, proteção TLS da conexão remota e política de segredos.
6. Electron futuro deve usar uma origem controlada, não liberar `Origin: null` nem conceder APIs privilegiadas ao renderer.

O catálogo e a infraestrutura de mídia continuam públicos como antes; autorização por perfil na reprodução, bloqueios e tempo de tela pertencem à fase seguinte e ainda não são oferecidos.

## Administradores

`users.role` admite `user` e `admin`, com padrão `user`. A migração não promove nenhuma conta.
As contas criadas pelo Controle e pelo seed permanecem comuns.
APIs de contas rejeitam envio do campo `role`, inclusive por administradores. O renderer nunca é autoridade.
Todas as famílias administrativas passam pela validação de sessão e consulta do papel atual no banco.

Para provisionar uma conta ativa já existente, o operador autorizado executa localmente:

```powershell
pnpm.cmd admin:role grant email-da-conta-existente --confirm
```

Para revogar:

```powershell
pnpm.cmd admin:role revoke email-da-conta-existente --confirm
```

Esses comandos exigem acesso operacional ao backend e permissão SQL correspondente.
Não há endpoint de autopromoção. Senha e status não são alterados; sessões anteriores dessa conta são revogadas.
Entre novamente no Controle com o login existente.
Não foi escolhido nem promovido automaticamente um administrador do usuário nesta fase.

O backend independente e o Controle usam a mesma fila local de mídia e lock existente.
Se ambos estiverem em execução, somente um worker assume o lock.
FFmpeg e FFprobe continuam necessários no computador do worker; nada foi instalado ou empacotado.
O instalador Electron e a distribuição dessas ferramentas serão tratados na Fase C.

## Schema e migrações

O banco inspecionado utiliza MariaDB 12.2.2, InnoDB e utf8mb4.
`title_tags` e `title_tag_relations` existiam no banco, mas faltavam no schema de referência.
O DDL de referência e a migração 001 refletem suas colunas, timestamps, índices, slug único, PK composta e FKs reais, sem substituí-las por `genres`.

- `001-title-tags.sql`: cria somente tabelas de tags ausentes; tabelas existentes e seus dados são preservados.
- `002-user-role.sql`: adiciona somente a coluna de papel, com padrão comum.
- `schema_migrations`: histórico de versão, checksum SHA-256 e aplicação.

```powershell
pnpm.cmd db:migrate
```

O runner usa lock MariaDB por banco, valida checksums e não reaplica versões registradas.
DDL MariaDB pode fazer commit implícito; não se promete rollback transacional de ALTER/CREATE.
Se houver interrupção, as operações são idempotentes e podem ser retomadas.
Não altere migrações já aplicadas: crie uma nova versão.
As duas migrações pressupõem as tabelas-base (`users` e `titles`) existentes.
`IF NOT EXISTS` não corrige schemas arbitrariamente divergentes: compare as definições antes de aplicar em outro ambiente.
Faça backup e valide em homologação antes de produção.

## Testes

```powershell
pnpm.cmd test
pnpm.cmd test:integration
pnpm.cmd typecheck
pnpm.cmd build
```

Testes específicos continuam disponíveis: `test:media`, `test:tags`, `test:tags:integration`, `test:api:integration`.
Integrações exigem MariaDB e migrações aplicadas; sobem servidores temporários em portas livres, sem exigir o Controle ou Vite já abertos.
Criam somente suas próprias contas/perfis/títulos/tags e removem suas fixtures ao terminar.
O worker não é iniciado nesses testes, portanto não processam o acervo.
O teste de login existente usa `KIDSPLAY_TEST_USER_EMAIL/PASSWORD` se configurados, sem exibi-los nem alterá-los; caso ausentes, informa skip.
Esse login cria e revoga apenas sua própria sessão e atualiza `last_login_at` como um login normal.

Não há script de lint no projeto. `format` é um formatador, não um lint.
Os testes cobrem isolamento de perfis, sessão expirada/revogada, conta suspensa, autorização por papel, CORS/CSRF, cookies, cadastro de tags e contratos de catálogo.
Build não substitui teste de reprodução em dispositivos de TV reais.

### Resultado da validação local desta fase

- 29 testes unitários aprovados e 24 testes de integração aprovados, sem skips na execução local.
- Login com a conta local previamente existente aprovado, sem revelar/alterar sua senha.
- Preservação dos registros existentes de usuários e tags verificada antes/depois das migrações; reaplicação sem alterações.
- Schema inicial e migrações executados também em banco temporário novo, removido ao final; colunas de tags compatíveis com o banco local.
- `typecheck`, `build:api`, `build` e verificação de sintaxe do JavaScript do Controle aprovados.
- API embutida no Vite: saúde, catálogo, login existente, perfis e logout aprovados.
- API independente e proxy Vite: saúde 200 e catálogos equivalentes.
- Navegador: login, criação/seleção de perfil, catálogo e reprodução MP4 pelo proxy aprovados.
- Controle no navegador: login administrativo, restauração de sessão, tela de tags, logout, limpeza dos dados visuais e desabilitação dos controles sem sessão conferidos.
- Bundles de produção verificados sem configuração/senha MariaDB.
- Somente fixtures próprias foram removidas. Nenhuma conta real foi promovida. Os serviços temporários de validação foram encerrados.

Ressalvas: o build mantém o aviso de chunk HLS acima de 500 kB. No navegador integrado, o player atingiu o timeout de HLS e reproduziu pelo fallback MP4.
Master e playlist HLS responderam 200 e o segmento respondeu 206 com os bytes solicitados; isso não comprova reprodução HLS naquele cliente.
O player não foi reescrito. A reprodução HLS deve ser conferida nos dispositivos de destino antes da distribuição.
O hook de build existente regenerou o catálogo auxiliar `public/data/shows.json` e os artefatos de `dist`; ele não é a fonte de catálogo do streaming.
O projeto não tem integração de descoberta de testes Node no painel de testes do editor; as suites foram executadas pelo runner `node --test` existente.

## Inventário de arquivos da Fase B

Criados:

- Configuração: [environment.mjs](../config/environment.mjs), [database.mjs](../config/database.mjs), [environment.test.mjs](../config/environment.test.mjs).
- Backend: [httpServer.ts](../api/httpServer.ts), [server.ts](../api/server.ts), [catalogAdmin.mjs](../api/catalogAdmin.mjs) (regras extraídas do script anterior), [requestPolicy.mjs](../api/requestPolicy.mjs), [requestPolicy.test.mjs](../api/requestPolicy.test.mjs).
- Integração: [testSupport.mjs](../api/testSupport.mjs), [backend.integration.test.mjs](../api/backend.integration.test.mjs).
- Frontend/build: [apiClient.ts](../src/services/apiClient.ts), [tsconfig.backend.json](../tsconfig.backend.json).
- Operação: [migrate.mjs](../scripts/migrate.mjs), [admin-role.mjs](../scripts/admin-role.mjs), [migração 001](../database/migrations/001-title-tags.sql), [migração 002](../database/migrations/002-user-role.sql).
- Documentação: [este guia](./backend.md).

Alterados:

- [localApi.ts](../api/localApi.ts), [catalogTags.integration.test.mjs](../api/catalogTags.integration.test.mjs).
- [catalog-admin.mjs](../scripts/catalog-admin.mjs) (agora inicialização compatível), [seed-local-user.mjs](../scripts/seed-local-user.mjs).
- [vite.config.ts](../vite.config.ts), [tsconfig.json](../tsconfig.json), [package.json](../package.json).
- [App.tsx](../src/App.tsx) (cliente da API e feedback de logout, sem mudar o player), [authService.ts](../src/services/authService.ts), [profileRepository.ts](../src/services/profileRepository.ts), [vite-env.d.ts](../src/vite-env.d.ts).
- [app.js](../catalog-admin/app.js), [index.html](../catalog-admin/index.html) (autenticação do Controle existente).
- [schema.sql](../database/schema.sql), [.env.example](../.env.example), [.gitignore](../.gitignore), [README](../README.md).

Dependências adicionadas/removidas: nenhuma. O `.env` local não foi editado.

## Reversão e próximos passos

Pare apenas os serviços iniciados por você com `Ctrl+C`.
Para voltar do proxy ao modo embutido, remova `KIDSPLAY_API_TARGET` do ambiente do processo e reinicie o Vite; não precisa modificar o banco.
Para reverter o código, restaure a revisão/backup anterior e recompile. Não use comandos destrutivos sobre alterações de outras pessoas.
As adições do banco podem permanecer: não é necessário apagar tabelas/coluna para executar a versão anterior.
Se voltar ao Controle antigo sem autenticação, mantenha-o estritamente local e não o exponha.
Esta pasta não tinha metadados Git durante a implementação; não foi criado commit nem existe rollback Git automático desta fase.

Próxima etapa: provisionar explicitamente o administrador desejado e validar o fluxo na máquina de operação. A interface Electron foi adicionada sobre esta API; consulte [KidsPlay Admin](./electron-admin.md). Controle dos Pais, favoritos sincronizados, sessões de reprodução, bloqueios e limites permanecem para a Fase D.
