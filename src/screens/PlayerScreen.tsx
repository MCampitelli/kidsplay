import { useEffect, useRef, useState } from "react"
import type Hls from "hls.js"
import type { Episode, Show } from "../types/catalog"
import { getNextTvTarget } from "../lib/tvNavigation"
import { sendProgress } from "../services/playbackService"
import {
  BackIcon,
  ExitFullscreenIcon,
  FullscreenIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
} from "../components/PlayerIcons"

// O aviso de proximo episodio aparece so nos ultimos segundos, num canto da tela, e
// segue automaticamente se ninguem responder. Recusar volta para a lista de episodios.
const NEXT_EPISODE_THRESHOLD_SECONDS = 4
const AUTO_NEXT_SECONDS = 10
// Progresso para o historico, o "assistindo agora" e o limite diario da Area dos Pais.
const PROGRESS_INTERVAL_SECONDS = 15

function formatTime(time: number) {
  if (!Number.isFinite(time) || time < 0) return "00:00"
  const totalSeconds = Math.floor(time)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

export function PlayerScreen({
  profileId,
  show,
  episode,
  videoSrc,
  hlsSrc,
  onBack,
  onEpisodeChange,
  onTimeUp,
}: {
  profileId: number
  show: Show
  episode: Episode
  videoSrc: string
  hlsSrc?: string
  onBack: () => void
  onEpisodeChange: (episode: Episode) => void
  /** Limite diario esgotado (definido na Area dos Pais). */
  onTimeUp: () => void
}) {
  const playerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const playPauseButtonRef = useRef<HTMLButtonElement>(null)
  const playNextButtonRef = useRef<HTMLButtonElement>(null)
  const progressRef = useRef<HTMLInputElement>(null)
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const episodeTransitionTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoNextCancelledRef = useRef(false)
  const controlsHoveredRef = useRef(false)
  const hlsInstanceRef = useRef<Hls | null>(null)
  const fallbackAttemptedRef = useRef(false)
  const activeEngineRef = useRef<"native" | "hlsjs" | "mp4">("mp4")
  const hlsWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [sourceMode, setSourceMode] = useState<"hls" | "mp4">(() =>
    hlsSrc ? "hls" : "mp4",
  )
  const [isMuted, setIsMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [bufferedPercent, setBufferedPercent] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [isEpisodeTransitioning, setIsEpisodeTransitioning] = useState(false)
  const [nextEpisodeCountdown, setNextEpisodeCountdown] =
    useState<number | null>(null)

  const episodeIndex = show.episodes.findIndex((item) => item.id === episode.id)
  const previousEpisode =
    episodeIndex > 0 ? show.episodes[episodeIndex - 1] : null
  const nextEpisode =
    episodeIndex < show.episodes.length - 1
      ? show.episodes[episodeIndex + 1]
      : null

  const revealControls = () => {
    setControlsVisible(true)
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current)
    }
    if (isPlaying) {
      hideControlsTimerRef.current = setTimeout(() => {
        if (!controlsHoveredRef.current) setControlsVisible(false)
      }, 3500)
    }
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play().catch(() => setIsPlaying(false))
    } else {
      video.pause()
    }
    revealControls()
  }

  const seekBy = (seconds: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.min(
      Math.max(video.currentTime + seconds, 0),
      video.duration || 0,
    )
    revealControls()
  }

  const toggleMute = () => {
    setIsMuted((muted) => {
      const nextMuted = !muted
      if (videoRef.current) videoRef.current.muted = nextMuted
      return nextMuted
    })
    revealControls()
  }

  const toggleFullscreen = async () => {
    const player = playerRef.current
    if (!player) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (player.requestFullscreen) {
        await player.requestFullscreen()
      }
    } catch {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    revealControls()
  }

  const retryVideo = () => {
    const video = videoRef.current
    if (!video) return
    setError(false)
    setIsLoading(true)
    video.load()
    void video.play().catch(() => undefined)
  }

  const changeEpisode = (next: Episode) => {
    setNextEpisodeCountdown(null)
    setIsEpisodeTransitioning(true)
    if (episodeTransitionTimerRef.current) {
      clearTimeout(episodeTransitionTimerRef.current)
    }
    episodeTransitionTimerRef.current = setTimeout(() => {
      onEpisodeChange(next)
    }, 240)
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    // O volume fica a cargo do controle da TV; no app so existe o atalho M (mudo).
    video.muted = isMuted
  }, [isMuted])

  useEffect(() => {
    setCurrentTime(0)
    setDuration(0)
    setBufferedPercent(0)
    setIsLoading(true)
    setError(false)
    setIsPlaying(false)
    setNextEpisodeCountdown(null)
    autoNextCancelledRef.current = false
    fallbackAttemptedRef.current = false
    setSourceMode(hlsSrc ? "hls" : "mp4")
  }, [episode.id, hlsSrc])

  // Cinema mode: once the controls bar actually fades out, move logical focus
  // back to the player container so no button keeps a stray focus ring and
  // TV/remote input isn't stuck targeting a now-hidden control.
  useEffect(() => {
    if (controlsVisible || !isPlaying) return
    const player = playerRef.current
    const activeElement = document.activeElement
    if (
      player &&
      activeElement instanceof HTMLElement &&
      activeElement !== player &&
      player.contains(activeElement)
    ) {
      activeElement.blur()
    }
    player?.focus({ preventScroll: true })
  }, [controlsVisible, isPlaying])

  // Attaches the video source whenever the mode/episode changes: HLS via
  // native <video> support when available, otherwise a lazily-loaded hls.js
  // instance, falling back to MP4 at most once per episode on fatal errors.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let cancelled = false

    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.destroy()
      hlsInstanceRef.current = null
    }

    function switchToMp4() {
      if (cancelled) return
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy()
        hlsInstanceRef.current = null
      }
      setSourceMode("mp4")
    }

    function useNativeHlsOrFallback(src: string) {
      if (!video) return
      // Only a small set of engines (mainly Safari/iOS) implement native HLS
      // reliably; treat it as the last resort before giving up on HLS.
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        activeEngineRef.current = "native"
        video.src = src
        return
      }
      if (!fallbackAttemptedRef.current) {
        fallbackAttemptedRef.current = true
        switchToMp4()
      }
    }

    if (sourceMode !== "hls" || !hlsSrc) {
      activeEngineRef.current = "mp4"
      // Com a midia no storage nao ha MP4 de reserva; sem fonte, mostra o erro em vez de
      // carregar a URL da propria pagina.
      if (!videoSrc) {
        video.removeAttribute("src")
        setError(true)
        return () => {
          cancelled = true
        }
      }
      video.src = videoSrc
      video.load()
      return () => {
        cancelled = true
      }
    }

    const hlsSource = hlsSrc
    // Prefer hls.js (MSE-based) whenever available: it behaves consistently on
    // Chromium/Android TV, unlike some engines that report native HLS support
    // via canPlayType but fail unpredictably on real playlists/segments.
    const supportsMediaSource = typeof window !== "undefined" && "MediaSource" in window
    if (!supportsMediaSource) {
      useNativeHlsOrFallback(hlsSource)
      return () => {
        cancelled = true
      }
    }

    import("hls.js")
      .then(({ default: Hls }) => {
        if (cancelled) return
        if (!Hls.isSupported()) {
          useNativeHlsOrFallback(hlsSource)
          return
        }
        const hls = new Hls({ startLevel: 0, startFragPrefetch: true })
        hlsInstanceRef.current = hls
        activeEngineRef.current = "hlsjs"
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return
          console.error("[KidsPlay] Erro fatal no HLS, revertendo para MP4:", data)
          if (!fallbackAttemptedRef.current) {
            fallbackAttemptedRef.current = true
            switchToMp4()
          }
        })
        hls.loadSource(hlsSource)
        hls.attachMedia(video)

        // Safety net: some engines/codecs can leave hls.js stuck retrying
        // non-fatal buffer errors indefinitely without ever reporting a fatal
        // error. If no playable data arrives within a reasonable window,
        // treat it as an HLS failure and fall back to MP4 exactly once.
        const watchdog = setTimeout(() => {
          if (cancelled || video.readyState >= 2) return
          console.error("[KidsPlay] HLS não produziu dados reproduzíveis a tempo, revertendo para MP4")
          if (!fallbackAttemptedRef.current) {
            fallbackAttemptedRef.current = true
            switchToMp4()
          }
        }, 12000)
        hlsWatchdogRef.current = watchdog
      })
      .catch((loadError) => {
        console.error("[KidsPlay] Falha ao carregar hls.js:", loadError)
        if (!fallbackAttemptedRef.current) {
          fallbackAttemptedRef.current = true
          switchToMp4()
        }
      })

    return () => {
      cancelled = true
      if (hlsWatchdogRef.current !== null) {
        clearTimeout(hlsWatchdogRef.current)
        hlsWatchdogRef.current = null
      }
    }
  }, [sourceMode, hlsSrc, videoSrc, episode.id])

  useEffect(() => {
    if (nextEpisodeCountdown === null || !nextEpisode) return
    if (nextEpisodeCountdown === 0) {
      changeEpisode(nextEpisode)
      return
    }

    const timer = setTimeout(
      () => setNextEpisodeCountdown((countdown) => (countdown ?? 1) - 1),
      1000,
    )
    return () => clearTimeout(timer)
  }, [nextEpisode, nextEpisodeCountdown])

  // Quando o aviso de proximo episodio surge, o foco vai para "Assistir agora" para
  // que o OK do controle remoto responda direto.
  const isNextEpisodePromptVisible = nextEpisodeCountdown !== null && Boolean(nextEpisode)

  // Conta so o tempo realmente assistido (video tocando) e envia a cada 15s, ao terminar
  // e ao sair do episodio. Se o limite diario acabar, pausa e avisa o App.
  const watchedSinceLastSendRef = useRef(0)
  const flushProgressRef = useRef<(options?: { completed?: boolean; keepalive?: boolean }) => void>(() => undefined)
  const onTimeUpRef = useRef(onTimeUp)
  onTimeUpRef.current = onTimeUp
  useEffect(() => {
    const episodeId = episode.id
    watchedSinceLastSendRef.current = 0
    const flush = ({ completed = false, keepalive = false } = {}) => {
      const video = videoRef.current
      const durationSeconds = Math.floor(video?.duration ?? 0)
      if (!video || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return
      const watchedSeconds = watchedSinceLastSendRef.current
      watchedSinceLastSendRef.current = 0
      void sendProgress(
        {
          profileId,
          episodeId,
          positionSeconds: Math.min(Math.floor(video.currentTime), durationSeconds),
          durationSeconds,
          watchedSeconds,
          completed,
        },
        { keepalive },
      )
        .then((screenTime) => {
          if (screenTime?.remainingSeconds === 0) {
            videoRef.current?.pause()
            onTimeUpRef.current()
          }
        })
        .catch(() => undefined)
    }
    flushProgressRef.current = flush
    const tick = window.setInterval(() => {
      const video = videoRef.current
      if (!video || video.paused || video.ended || video.readyState < 3) return
      watchedSinceLastSendRef.current += 1
      if (watchedSinceLastSendRef.current >= PROGRESS_INTERVAL_SECONDS) flush()
    }, 1000)
    return () => {
      window.clearInterval(tick)
      if (watchedSinceLastSendRef.current > 0) flush({ keepalive: true })
    }
  }, [episode.id, profileId])
  useEffect(() => {
    if (isNextEpisodePromptVisible) playNextButtonRef.current?.focus({ preventScroll: true })
  }, [isNextEpisodePromptVisible])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange)
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
      if (hideControlsTimerRef.current)
        clearTimeout(hideControlsTimerRef.current)
      if (episodeTransitionTimerRef.current)
        clearTimeout(episodeTransitionTimerRef.current)
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy()
        hlsInstanceRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.target instanceof HTMLInputElement &&
          event.target.type !== "range") ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      )
        return

      if (event.key === " ") {
        event.preventDefault()
        togglePlay()
      } else if (
        event.key === "Enter" &&
        !(event.target instanceof HTMLButtonElement) &&
        !(event.target instanceof HTMLInputElement)
      ) {
        event.preventDefault()
        // Cinema mode: the first OK/Enter just wakes the controls back up and
        // hands focus to Play/Pause, matching TV remotes; it does not itself
        // toggle playback. When controls are already visible, keep the prior
        // behavior of treating Enter as a Play/Pause shortcut.
        if (!controlsVisible) {
          revealControls()
          playPauseButtonRef.current?.focus()
          return
        }
        togglePlay()
      } else if (
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown"
      ) {
        event.preventDefault()
        const directions = {
          ArrowLeft: "left",
          ArrowRight: "right",
          ArrowUp: "up",
          ArrowDown: "down",
        } as const
        const activeElement = document.activeElement
        const player = playerRef.current
        const focusIsOnControl =
          activeElement instanceof HTMLElement &&
          activeElement !== player &&
          Boolean(player?.contains(activeElement))
        const isHorizontal = event.key === "ArrowLeft" || event.key === "ArrowRight"

        // Padrao das plataformas de streaming: com os controles escondidos (ou com a barra
        // de progresso selecionada), esquerda/direita voltam/avancam 10s e mostram a barra.
        // Com um botao selecionado, as setas continuam navegando entre os botoes.
        if (
          isHorizontal &&
          !isNextEpisodePromptVisible &&
          (!controlsVisible || !focusIsOnControl || activeElement === progressRef.current)
        ) {
          seekBy(event.key === "ArrowLeft" ? -10 : 10)
          progressRef.current?.focus({ preventScroll: true })
          return
        }
        // Cima/baixo com os controles escondidos apenas os revelam, a partir do Play.
        if (!isHorizontal && (!controlsVisible || !focusIsOnControl) && !isNextEpisodePromptVisible) {
          revealControls()
          playPauseButtonRef.current?.focus({ preventScroll: true })
          return
        }
        if (activeElement instanceof HTMLElement) {
          const nextTarget = getNextTvTarget(
            activeElement,
            directions[event.key],
          )
          if (nextTarget && playerRef.current?.contains(nextTarget)) {
            nextTarget.focus({ preventScroll: true })
          }
        }
      } else if (event.key.toLowerCase() === "m") {
        event.preventDefault()
        toggleMute()
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault()
        void toggleFullscreen()
      } else if (event.key === "Escape" && document.fullscreenElement) {
        event.preventDefault()
        void document.exitFullscreen()
      } else if (event.key === "Escape" || event.key === "BrowserBack") {
        event.preventDefault()
        onBack()
      }
      revealControls()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  })

  useEffect(() => {
    const previousDocumentOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = "hidden"
    document.body.style.overflow = "hidden"
    return () => {
      document.documentElement.style.overflow = previousDocumentOverflow
      document.body.style.overflow = previousBodyOverflow
    }
  }, [])

  return (
    <main className="player-page">
      <div
        ref={playerRef}
        tabIndex={-1}
        className="player-container outline-none"
        onMouseMove={revealControls}
        onTouchStart={revealControls}
      >
        <div
          className={`absolute inset-x-0 top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 pb-10 pt-4 sm:gap-4 sm:px-8 sm:pt-6 transition-opacity duration-300 ${
            controlsVisible || !isPlaying
              ? "opacity-100"
              : "pointer-events-none opacity-0"
          }`}
        >
          <button
            type="button"
            onClick={onBack}
            className="player-control player-icon-button"
            aria-label="Voltar aos episódios"
            title="Voltar aos episódios"
            data-tv-focusable
          >
            <BackIcon className="h-6 w-6" />
          </button>
          <div className="min-w-0 text-white">
            <p className="truncate text-xs font-bold uppercase tracking-wide text-[#FFD93D] sm:text-sm">
              {show.title}
            </p>
            <h1 className="truncate font-display text-lg sm:text-2xl">{episode.title}</h1>
          </div>
        </div>

        <video
          ref={videoRef}
          poster={episode.image}
          autoPlay
          playsInline
          preload="metadata"
          muted={isMuted}
          controls={false}
          onClick={togglePlay}
          onLoadStart={() => {
            setIsLoading(true)
            setError(false)
          }}
          onLoadedMetadata={(event) => {
            setDuration(event.currentTarget.duration)
          }}
          onCanPlay={(event) => {
            setIsLoading(false)
            setIsEpisodeTransitioning(false)
            void event.currentTarget.play().catch(() => undefined)
          }}
          onPlay={() => {
            setIsPlaying(true)
            revealControls()
          }}
          onPause={() => {
            setIsPlaying(false)
            setControlsVisible(true)
          }}
          onTimeUpdate={(event) => {
            const video = event.currentTarget
            setCurrentTime(video.currentTime)
            const remaining = video.duration - video.currentTime
            if (
              nextEpisode &&
              !autoNextCancelledRef.current &&
              nextEpisodeCountdown === null &&
              remaining <= NEXT_EPISODE_THRESHOLD_SECONDS
            ) {
              setNextEpisodeCountdown(AUTO_NEXT_SECONDS)
            } else if (
              nextEpisodeCountdown !== null &&
              !video.ended &&
              remaining > NEXT_EPISODE_THRESHOLD_SECONDS + 1
            ) {
              // Voltou a barra de progresso: o episodio nao esta mais acabando.
              setNextEpisodeCountdown(null)
            }
          }}
          onProgress={(event) => {
            const video = event.currentTarget
            if (video.duration && video.buffered.length) {
              setBufferedPercent(
                (video.buffered.end(video.buffered.length - 1) /
                  video.duration) *
                  100,
              )
            }
          }}
          onWaiting={() => setIsLoading(true)}
          onPlaying={() => setIsLoading(false)}
          onEnded={() => {
            flushProgressRef.current({ completed: true })
            setIsPlaying(false)
            // Ultimo episodio (ou proximo recusado): volta para a lista de episodios.
            if (!nextEpisode || autoNextCancelledRef.current) {
              onBack()
              return
            }
            if (nextEpisodeCountdown === null) {
              setNextEpisodeCountdown(AUTO_NEXT_SECONDS)
            }
          }}
          onError={(event) => {
            // Changing video.src (episode switch, retry, hls.js teardown) aborts the
            // previous request and fires a spurious MEDIA_ERR_ABORTED "error" event on
            // the outgoing source. That is not a real playback failure, so ignore it.
            if (event.currentTarget.error?.code === 1) return
            // While hls.js drives playback, its own Hls.Events.ERROR listener owns the
            // fatal-error/fallback decision. The <video> element's native error event
            // is unreliable while a MediaSource is attached and must not trigger a
            // second, redundant fallback here.
            if (activeEngineRef.current === "hlsjs") return
            setIsLoading(false)
            setIsEpisodeTransitioning(false)
            if (activeEngineRef.current === "native" && !fallbackAttemptedRef.current) {
              fallbackAttemptedRef.current = true
              setSourceMode("mp4")
              return
            }
            setError(true)
          }}
          className={`player-video transition-opacity duration-300 ${
            isEpisodeTransitioning ? "opacity-0" : "opacity-100"
          }`}
        />
        {isLoading && !error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center overflow-hidden text-white">
            {(show.banner || show.image || episode.image) && (
              <img
                src={show.banner || show.image || episode.image}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-black/20" aria-hidden="true" />
            <div className="flex flex-col items-center gap-3">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/40 border-t-[#FFD93D] drop-shadow-lg" />
              <span className="font-bold drop-shadow-lg">Carregando episódio...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#20202A] p-6 text-center text-white">
            <p className="text-lg font-bold">
              Não foi possível reproduzir este episódio.
            </p>
            <button
              type="button"
              onClick={retryVideo}
              className="rounded-full bg-[#FFD93D] px-6 py-3 font-bold text-[#2D2D2D]"
              data-tv-focusable
            >
              Tentar novamente
            </button>
          </div>
        )}

        {isNextEpisodePromptVisible && nextEpisode && (
          <div
            className="absolute bottom-4 right-4 z-30 w-[min(calc(100%-2rem),24rem)] overflow-hidden rounded-2xl bg-black/85 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-md sm:bottom-8 sm:right-8"
            role="status"
            aria-live="polite"
          >
            <div className="flex gap-3 p-3">
              {nextEpisode.image && (
                <img
                  src={nextEpisode.image}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className="aspect-video w-28 shrink-0 rounded-lg object-cover"
                />
              )}
              <div className="min-w-0 self-center">
                <p className="text-xs font-bold uppercase tracking-wide text-[#FFD93D]">
                  Próximo em {nextEpisodeCountdown}s
                </p>
                <p className="line-clamp-2 text-sm font-bold sm:text-base">{nextEpisode.title}</p>
              </div>
            </div>
            <div className="flex gap-2 px-3 pb-3">
              <button
                ref={playNextButtonRef}
                type="button"
                onClick={() => changeEpisode(nextEpisode)}
                className="player-control player-control-main flex-1 gap-2 text-sm"
                data-tv-focusable
              >
                <PlayIcon className="h-4 w-4" />
                Assistir agora
              </button>
              <button
                type="button"
                onClick={() => {
                  autoNextCancelledRef.current = true
                  setNextEpisodeCountdown(null)
                  onBack()
                }}
                className="player-control flex-1 text-sm"
                data-tv-focusable
              >
                Voltar aos episódios
              </button>
            </div>
            <div className="h-1 bg-white/15" aria-hidden="true">
              <div
                className="h-full bg-[#FFD93D] transition-[width] duration-1000 ease-linear"
                style={{
                  width: `${((AUTO_NEXT_SECONDS - (nextEpisodeCountdown ?? AUTO_NEXT_SECONDS)) / AUTO_NEXT_SECONDS) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        <div
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-4 pt-16 transition-opacity duration-300 sm:px-8 sm:pb-6 ${
            (controlsVisible || !isPlaying) && !isNextEpisodePromptVisible
              ? "opacity-100"
              : "pointer-events-none opacity-0"
          }`}
          onMouseEnter={() => {
            controlsHoveredRef.current = true
            revealControls()
          }}
          onMouseLeave={() => {
            controlsHoveredRef.current = false
            revealControls()
          }}
        >
          <input
            ref={progressRef}
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={Math.min(currentTime, duration || 0)}
            aria-label="Progresso do episódio (setas esquerda e direita voltam ou avançam 10 segundos)"
            data-tv-focusable
            onChange={(event) => {
              const nextTime = Number(event.target.value)
              setCurrentTime(nextTime)
              if (videoRef.current) videoRef.current.currentTime = nextTime
              revealControls()
            }}
            className="player-progress h-1.5 w-full cursor-pointer"
            style={{
              background: `linear-gradient(to right, #FFD93D ${
                duration ? (currentTime / duration) * 100 : 0
              }%, #ffffff66 ${
                duration ? (currentTime / duration) * 100 : 0
              }%, #ffffff66 ${bufferedPercent}%, #ffffff26 ${bufferedPercent}%)`,
            }}
          />
          <div className="mt-3 flex items-center gap-1 text-white sm:gap-2">
            <button
              ref={playPauseButtonRef}
              type="button"
              onClick={togglePlay}
              className="player-control player-control-main"
              aria-label={isPlaying ? "Pausar" : "Reproduzir"}
              title={isPlaying ? "Pausar" : "Reproduzir"}
              data-tv-focusable
            >
              {isPlaying ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6" />}
            </button>
            <span className="ml-1 text-xs font-semibold tabular-nums text-white/90 sm:ml-2 sm:text-sm">
              {formatTime(currentTime)}
              <span className="text-white/50"> / {formatTime(duration)}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                if (previousEpisode) changeEpisode(previousEpisode)
                revealControls()
              }}
              className="player-control player-icon-button ml-auto"
              disabled={!previousEpisode}
              aria-label="Episódio anterior"
              title="Episódio anterior"
              data-tv-focusable
            >
              <PreviousIcon />
            </button>
            <button
              type="button"
              onClick={() => {
                if (nextEpisode) changeEpisode(nextEpisode)
                revealControls()
              }}
              className="player-control player-icon-button"
              disabled={!nextEpisode}
              aria-label="Próximo episódio"
              title="Próximo episódio"
              data-tv-focusable
            >
              <NextIcon />
            </button>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              className="player-control player-icon-button"
              aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
              title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
              data-tv-focusable
            >
              {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
