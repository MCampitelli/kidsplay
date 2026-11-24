# KidsPlay: processamento local para HLS

Esta etapa converte os MP4 existentes em `files/` para HLS VOD local. Os MP4 nao sao copiados nem removidos.

## Requisitos

- Node.js `>=22.12.0`
- pnpm
- FFmpeg
- FFprobe

A pipeline depende dos executaveis `ffmpeg` e `ffprobe` no `PATH`.

## Instalar FFmpeg no Windows

Nao inclua binarios do FFmpeg no repositorio. Instale uma distribuicao confiavel e adicione a pasta que contem `ffmpeg.exe` e `ffprobe.exe` ao `PATH` do Windows.

Depois abra um novo PowerShell e valide:

```powershell
ffmpeg -version
ffprobe -version
```

Alternativamente, com Chocolatey instalado:

```powershell
choco install ffmpeg
```

## Executar

A origem e descoberta automaticamente:

```text
files/**/*.mp4
```

Execute:

```powershell
pnpm encode-videos
```

A pipeline:

1. encontra os MP4 recursivamente;
2. usa `ffprobe` para coletar resolucao, duracao, codecs, bitrate, framerate e audio;
3. escolhe qualidades sem fazer upscale;
4. gera HLS VOD H.264/AAC com segmentos de aproximadamente 6 segundos;
5. gera `master.m3u8`, playlists e segmentos `.ts`;
6. valida playlists e referencias dos segmentos;
7. salva metadata por episodio.

## Saida

```text
video-processing/output/<Desenho>/<Episodio>/
├── master.m3u8
├── 480p/index.m3u8
├── 480p/segment_000.ts
├── 720p/index.m3u8
└── ...
```

Os metadados ficam em:

```text
video-processing/metadata/
```

Essas pastas sao ignoradas pelo Git. A estrutura e adequada para um upload futuro para R2, mas nenhum upload e feito nesta fase.

## Qualidades

- `480p`: somente se a origem tiver pelo menos 854x480 (teto de 1200 kbps);
- `720p`: somente se a origem tiver pelo menos 1280x720 (teto de 2500 kbps).

Para uma origem menor que 480p, a pipeline gera uma qualidade com a dimensao original, sem upscale artificial.

O video usa x264 `-preset medium -tune animation` com CRF 20 (qualidade constante). O bitrate maximo de cada qualidade e o menor valor entre o teto acima e 1,5x o bitrate de video da origem, reduzido pela proporcao de pixels entre a qualidade e a origem elevada a 0,75 (minimo de 400 kbps). Assim nenhum HLS fica muito maior que o MP4 original e o 480p de uma origem 720p custa cerca de metade do 720p, em vez de quase o mesmo. O 1080p esta desativado por enquanto para reduzir armazenamento e consumo de dados; para reativar, adicione o perfil em `profiles` de `encode-videos.mjs` e incremente `ENCODER_VERSION`.

`ENCODER_VERSION` e gravado no metadata de cada episodio. Ao alterar as configuracoes de codificacao, incremente esse numero: saidas com metadata de versao anterior sao consideradas desatualizadas e recodificadas tanto por `pnpm encode-videos` quanto pelo worker do Controle. Saidas HLS validas sem metadata continuam sendo reutilizadas.

## Idempotencia e retomada

Cada episodio tem um JSON em `video-processing/metadata/`. Um episodio completo e ignorado quando:

- metadata possui `status: completed`;
- quando tamanho/data da origem estao registrados, ambos continuam iguais;
- `master.m3u8`, todas as playlists e todos os segmentos referenciados passam pela validacao estrutural.

Saidas HLS validas sem metadata tambem sao reutilizadas. Regeneracoes sao produzidas em uma pasta temporaria, validadas e promovidas somente ao final; uma pasta anterior e mantida como backup durante a troca e restaurada se a promocao falhar. Um erro em um episodio nao impede os demais; o comando termina com codigo diferente de zero se algum episodio falhar.

## Processamento automatico pelo Controle

No painel **Arquivos de midia**, selecione o episodio e informe somente o caminho do MP4 dentro de `files/`, por exemplo `/files/Baby%20Looney%20Tunes/Quem%20%C3%A9%20a%20vov%C3%B3.mp4`. O servidor grava/atualiza o registro MP4 antes de enfileirar o trabalho; ausencia ou erro de processamento nao remove esse cadastro.

Ao executar `pnpm catalog:admin`, o mesmo processo do Controle inicia um worker local serial. Ele reaproveita a thumbnail registrada se ela ainda for valida e estiver na versao atual; se estiver ausente, invalida ou antiga, gera um JPG em `video-processing/thumbnails/episodes/<hash-estavel>.jpg`, tentando o frame de 40 segundos e depois posicoes alternativas. O caminho versionado e salvo em `episodes.thumbnail_path` como `/thumbnails/episodes/<hash>.jpg` e servido pelo Vite. O hash deriva do caminho relativo do MP4 e da versao da captura, evitando colisao entre episodios com nomes iguais e renovando thumbnails antigas.

O worker procura HLS primeiro nos registros do episodio e depois no caminho convencional derivado do MP4: `video-processing/output/<caminho-relativo>/<nome-sem-extensao>/master.m3u8`. Ele valida a playlist principal, todas as playlists referenciadas, segmentos, caminhos relativos e arquivos nao vazios. Segmentos `.ts` tambem precisam iniciar com o sync byte MPEG-TS. HLS valido e associado por upsert, sem conversao; HLS ausente/invalido e gerado pela mesma funcao do encoder em staging e so fica disponivel no banco depois da validacao.

O estado duravel dos trabalhos fica em `video-processing/metadata/media-processing.jsonl`; nao foi necessario alterar o schema MariaDB. O lock `media-processing.lock` impede dois workers locais. Ao iniciar, estados interrompidos voltam para a fila. O Controle mostra a etapa atual, erros e acoes **Tentar novamente** e **Processar pendentes**.

Para iniciar, rode `pnpm catalog:admin` na raiz do projeto (no PowerShell desta maquina, use `cmd /c "pnpm catalog:admin"`). Para parar o worker e o Controle, pressione `Ctrl+C` no mesmo terminal; o FFmpeg ativo e cancelado e o trabalho pode ser retomado na proxima inicializacao. Use **Tentar novamente** no episodio com erro ou **Processar pendentes** para revalidar os MP4 cadastrados. A fila processa um episodio por vez.

Execute os testes de processamento, com fixtures temporarias e sem alterar o banco local:

```powershell
pnpm test:media
```

## Testar HLS localmente

Nao abra `master.m3u8` com `file:///`, pois HLS normalmente precisa de HTTP. Depois de gerar os arquivos, inicie o servidor Vite:

```powershell
pnpm dev
```

O output esta fora de `public/`; o plugin Vite local o publica em `/hls/` com validacao dos segmentos de caminho.

Exemplo com Python, se disponivel:

```powershell
python -m http.server 8787 --directory video-processing/output
```

Acesse a URL do arquivo com o caminho codificado, por exemplo:

```text
http://localhost:8787/Camundongos%20Aventureiros/<episodio>/master.m3u8
```

## Troubleshooting

- `ffmpeg nao encontrado`: instale FFmpeg e abra um novo terminal.
- `ffprobe nao encontrado`: confirme que a mesma pasta dos executaveis esta no `PATH`.
- `playlist sem segmentos`: remova a saida incompleta daquele episodio e execute novamente.
- erro de codec: confirme se a distribuicao do FFmpeg inclui `libx264`.
- nomes com acentos: mantenha UTF-8 e use URLs codificadas ao testar por HTTP.
- navegador nao reproduz HLS: confira se o manifesto foi publicado como disponivel somente depois de validar todos os seus arquivos.

## Envio para o Cloudflare R2

Configure no `.env` local `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (token com permissao Object Read & Write restrita ao bucket), `R2_BUCKET` e `R2_PUBLIC_URL`. O bucket precisa de acesso publico (URL `r2.dev` ou dominio proprio) e de uma politica CORS que permita `GET`/`HEAD` para a origem do app.

```powershell
pnpm media:upload --dry-run   # mostra quantos arquivos e GB faltam enviar
pnpm media:upload             # envia somente o que falta ou mudou de tamanho
```

O script envia `video-processing/output` para `hls/`, `video-processing/thumbnails` para `thumbnails/` e as imagens de `files/` (capas, banners, posters) para `files/`, espelhando as rotas locais. Os MP4 originais nao sao enviados. Playlists recebem cache de 5 minutos, thumbnails (nomes versionados) cache imutavel e o restante 1 dia. Pode ser executado de novo a qualquer momento; falhas sao reenviadas na proxima execucao. Arquivos removidos localmente nao sao apagados do bucket.

Depois do envio, defina `KIDSPLAY_MEDIA_BASE_URL` com a mesma URL publica do bucket. O catalogo passa a devolver URLs do storage para HLS, thumbnails e artes, sem alterar o banco; os MP4 deixam de ser oferecidos e o player usa somente HLS. Com a variavel vazia, tudo volta a ser servido localmente. Ao adicionar episodios, processe-os no Controle e rode `pnpm media:upload` antes de publica-los.

## Integracao do player

O player carrega os titulos registrados no MariaDB por `GET /api/catalog`; registros em `files/` ou em `public/data/shows.json` nao criam titulos na tela. O endpoint associa thumbnails e arquivos de mídia disponíveis por episódio. O player prioriza o master HLS validado, usando `hls.js` em navegadores com MediaSource e HLS nativo como fallback de engine; falha fatal ou timeout volta ao MP4. `scripts/generate-shows.mjs` continua gerando um catálogo auxiliar para build/diagnóstico, mas não é a fonte de dados da tela KidsPlay.
