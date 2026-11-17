# KidsPlay Admin para Windows

## Arquitetura adotada

O KidsPlay Admin reaproveita `catalog-admin/` e consome a API Node independente; não cria uma API paralela e não inicia nem encerra o backend. O backend pode ser compartilhado pelo streaming, pelo aplicativo Electron e por outros clientes autorizados. Essa opção evita múltiplas filas de processamento de mídia e permite atualizar o desktop sem reescrever regras de negócio.

O processo principal do Electron envia requisições à origem configurada usando uma sessão persistente do Electron. O Renderer tem `contextIsolation`, sandbox e `webSecurity` habilitados, `nodeIntegration` desabilitado e CSP restritiva. O preload expõe somente leitura/configuração do endereço e requisições JSON; o processo principal valida origem, rota, método e tamanho do payload. Não são expostos filesystem, execução de comandos, driver MariaDB, credenciais ou acesso administrativo implícito. O servidor continua responsável por login, sessão e papel `admin`.

O instalador contém apenas os arquivos de interface e processo Electron. O app não inclui o backend, o banco, segredos ou mídia.

## Desenvolvimento

1. Configure o banco e aplique as migrações conforme [backend.md](./backend.md).
2. Em um terminal, execute `pnpm.cmd api:dev` para construir e iniciar o backend em `http://127.0.0.1:8788`.
3. Em outro terminal, execute `pnpm.cmd electron:dev`.
4. Na primeira abertura, configure a origem `http://127.0.0.1:8788`; essa exceção HTTP só é aceita para loopback em desenvolvimento.
5. Entre com uma conta existente cujo papel `admin` foi provisionado no backend. Contas comuns não são promovidas pelo aplicativo.

`KIDSPLAY_ADMIN_API_URL` pode definir a origem padrão no ambiente de desenvolvimento ou em `.env`. Se definida, a origem fica controlada pelo ambiente e não pode ser substituída pela tela. Valores de `.env` permanecem ignorados pelo Git. No pacote Windows, não há leitura de `.env` empacotado: defina `KIDSPLAY_ADMIN_API_URL` no ambiente do processo ou configure a origem pela tela na primeira execução. Não inclua segredos nessa URL.

## Empacotamento e instalação

```powershell
pnpm.cmd electron:pack:dir
pnpm.cmd electron:build
```

`electron:build` executa primeiro o smoke test do processo Electron e depois gera o instalador NSIS x64 em `release/KidsPlay-Admin-1.0.0-Setup.exe`. `electron:pack:dir` produz uma pasta unpacked para validação. A saída `release/` é ignorada pelo Git.

Em outro computador Windows:

1. Instale o NSIS gerado, distribuído por canal confiável.
2. Garanta que o backend independente esteja executando e publicado em HTTPS com certificado válido.
3. Abra KidsPlay Admin e informe a origem da API; a configuração é salva no perfil local do usuário.
4. Entre com a conta existente que um operador provisionou como administradora.

O desktop não instala nem inicia o backend e não encerra serviços compartilhados. Atualizar ou fechar o aplicativo não interrompe o streaming nem o worker. A sessão de autenticação usa o cookie `HttpOnly` existente, guardado no partition persistente do Electron; sair revoga a sessão no servidor. O aplicativo não extrai nem armazena a senha ou o token de sessão em texto puro.

## HTTPS, cookies e origem

Para produção, use somente HTTPS com certificado confiável. HTTP é bloqueado fora de loopback, e redirects HTTP são recusados. O processo principal faz as chamadas administrativas; o Renderer não recebe uma URL irrestrita para `fetch`. O backend ainda exige cookie de sessão e `role=admin`; a instalação não substitui autenticação, autorização, TLS ou gestão segura de contas.

O Electron não deve ser autorizado por `Origin: null` nem exigir uma exceção pública de CORS. As chamadas são originadas pelo processo principal, não pelo Renderer/file URL; cookies são mantidos pela sessão persistente do Electron. O backend conserva validação de origem para navegadores e sua política existente contra CSRF. Mantenha login e mutações em JSON, `SameSite=Strict`, cookies `Secure` em produção, HTTPS e origens HTTPS explícitas para os clientes web. Não relaxe essas proteções para contornar incompatibilidades de rede do desktop.

O primeiro login usa a API de autenticação existente. Contas sem papel administrativo são rejeitadas e a sessão é encerrada. A autorização é aplicada no backend para cada endpoint protegido. Revogue o privilégio pelo procedimento operacional de administração de papéis; o comando existente revoga também as sessões ativas.

## Catálogo e arquivos de mídia

Contas, títulos, temporadas, episódios, assets e tags continuam sendo mantidos pela interface existente, através dos endpoints administrativos compartilhados. As regras e validações permanecem no backend. O desktop não altera schema nem migrações.

O cadastro de mídia recebe caminhos, não uploads. Um MP4 deve existir dentro de `files/` no host do backend que executa o worker. Capas, posters, banners, thumbnails e HLS também devem estar presentes no host/servidor de mídia já utilizado pelo streaming. Se o backend for remoto, um caminho no computador do operador não aponta para um arquivo no servidor remoto. Planeje a sincronização de mídia separadamente; esta fase não implementa upload ou armazenamento remoto.

## Scripts de validação

- `pnpm.cmd test:electron`: regras e allowlist IPC.
- `pnpm.cmd test:electron:integration`: sessão Electron real, login admin, recusa de usuário comum, leitura e CRUD via IPC de contas/tags/títulos/temporadas/episódios, logout, indisponibilidade, recusa de redirect HTTP e persistência da configuração entre inicializações. Requer MariaDB configurado e Electron executável.
- `pnpm.cmd test`: testes unitários existentes.
- `pnpm.cmd test:integration`: contratos de autenticação, autorização, catálogo, tags e banco local configurado.
- `pnpm.cmd typecheck`: verificações TypeScript frontend/backend.
- `pnpm.cmd build`: build do streaming.
- `pnpm.cmd electron:smoke`: inicialização do Electron, preload e, se a API estiver configurada, saúde, sessão autorizada, catálogo, tags, fila e logout. Sem endpoint configurado, valida somente Renderer e preload.

Os testes Electron de integração usam contas descartáveis e removem suas fixtures. O teste administrativo de API também cria e edita título, temporada e episódio, removendo-os ao terminar. Para provar uma instalação final, execute também `electron:pack:dir`, abra o executável da pasta unpacked em Windows com interface gráfica e valide os fluxos de escrita contra fixtures temporárias.

## Limitações

- O instalador requer uma API independente acessível; não inclui nem gerencia sua disponibilidade.
- Mídia não é transferida pelo aplicativo; o backend e o servidor de mídia precisam compartilhar os arquivos referenciados.
- O smoke automatizado não substitui validação manual do instalador, atualização, acessibilidade, escala de tela ou uso no computador-alvo.
- Não estão incluídos Controle dos Pais, limites de tela, monitoramento em tempo real ou novas permissões além do papel administrativo existente.
- Não distribuir até configurar HTTPS, provisionar administradores autorizados e validar o instalador no Windows de destino.
