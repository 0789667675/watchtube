import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Play, Pause, Volume2, VolumeX, Maximize, Settings, SignalLow, LoaderCircle } from 'lucide-react';

interface VideoPlayerProps {
  src: string; // The master.m3u8 URL
  initialPosition?: number;
  onProgress?: (currentTime: number, duration: number, completed: boolean) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ src, initialPosition = 0, onProgress }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState('00:00');
  const [duration, setDuration] = useState('00:00');
  const [showControls, setShowControls] = useState(true);
  const [isLowBandwidth, setIsLowBandwidth] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [showResMenu, setShowResMenu] = useState(false);
  const [currentRes, setCurrentRes] = useState<number>(-1); // -1 is Auto
  const [levels, setLevels] = useState<{height: number; index: number}[]>([]);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [seekableKey, setSeekableKey] = useState<string | null>(null);
  const playbackKey = `${src}:${playbackAttempt}`;

  const formatTime = (time: number) => {
    if (!Number.isFinite(time)) return '00:00';
    const totalSeconds = Math.floor(time);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = String(totalMinutes % 60).padStart(2, '0');
    const hours = Math.floor(totalMinutes / 60);
    return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${totalMinutes}:${seconds}`;
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setPlaybackError(null);
    setIsPlaying(false);
    setIsBuffering(true);
    setProgress(0);
    setCurrentTime('00:00');
    setDuration('00:00');

    if (Hls.isSupported()) {
      const hls = new Hls({
        capLevelToPlayerSize: !isLowBandwidth,
      });
      hlsRef.current = hls;

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        const availableLevels = data.levels.map((l, index) => ({ height: l.height, index })).sort((a,b) => b.height - a.height);
        setLevels(availableLevels);

        if (isLowBandwidth) {
            const idx360p = hls.levels.findIndex(l => l.height === 360);
            hls.currentLevel = idx360p !== -1 ? idx360p : 0;
            setCurrentRes(idx360p !== -1 ? idx360p : 0);
        } else {
            hls.currentLevel = -1; // Auto
            setCurrentRes(-1);
        }
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setPlaybackError('This video could not be played. Try again later.');
          setIsBuffering(false);
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    } else {
      setPlaybackError('This browser does not support this video format.');
      setIsBuffering(false);
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [src, isLowBandwidth, playbackAttempt]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
  }, [volume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = isMuted;
  }, [isMuted]);

  const toggleLowBandwidth = () => {
    setIsLowBandwidth(prev => {
        const next = !prev;
        if (hlsRef.current) {
            if (next) {
                const idx360p = hlsRef.current.levels.findIndex(l => l.height === 360);
                hlsRef.current.currentLevel = idx360p !== -1 ? idx360p : 0;
                setCurrentRes(idx360p !== -1 ? idx360p : 0);
            } else {
                hlsRef.current.currentLevel = -1; // Auto
                setCurrentRes(-1);
            }
        }
        return next;
    });
  };

  const changeResolution = (levelIndex: number) => {
      if (hlsRef.current) {
          hlsRef.current.currentLevel = levelIndex;
          setCurrentRes(levelIndex);
          if (levelIndex === -1 || hlsRef.current.levels[levelIndex]?.height !== 360) {
              setIsLowBandwidth(false);
          } else if (hlsRef.current.levels[levelIndex]?.height === 360) {
              setIsLowBandwidth(true);
          }
      }
      setShowResMenu(false);
  };

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const handleMouseMove = () => {
      setShowControls(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setShowControls(false), 3000);
    };
    const handleMouseLeave = () => setShowControls(false);

    const container = containerRef.current;
    if (container) {
      container.addEventListener('mousemove', handleMouseMove);
      container.addEventListener('mouseleave', handleMouseLeave);
    }

    return () => {
      if (container) {
        container.removeEventListener('mousemove', handleMouseMove);
        container.removeEventListener('mouseleave', handleMouseLeave);
      }
      clearTimeout(timeout);
    };
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) video.pause();
    else void video.play().catch(() => setPlaybackError('Playback could not start. Try again.'));
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const current = videoRef.current.currentTime;
      const total = videoRef.current.duration;
      setProgress(total > 0 ? (current / total) * 100 : 0);
      setCurrentTime(formatTime(current));
      onProgress?.(current, total, total > 0 && current >= total * 0.98);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      setDuration(formatTime(video.duration));
      if (initialPosition > 0 && initialPosition < video.duration) {
        video.currentTime = initialPosition;
        setProgress((initialPosition / video.duration) * 100);
        setCurrentTime(formatTime(initialPosition));
      }
      setSeekableKey(playbackKey);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (videoRef.current && Number.isFinite(videoRef.current.duration) && videoRef.current.duration > 0) {
      const time = (parseFloat(e.target.value) / 100) * videoRef.current.duration;
      videoRef.current.currentTime = time;
      setProgress(parseFloat(e.target.value));
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await containerRef.current?.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      setPlaybackError('Fullscreen is unavailable in this browser.');
    }
  };

  const handlePlayerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target !== containerRef.current) {
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON') return;
    }

    const video = videoRef.current;
    if (!video) return;
    if (event.key === ' ' || event.key.toLowerCase() === 'k') {
      event.preventDefault();
      togglePlay();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const offset = event.key === 'ArrowRight' ? 5 : -5;
      video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + offset));
    } else if (event.key.toLowerCase() === 'm') {
      setIsMuted((muted) => !muted);
    } else if (event.key.toLowerCase() === 'f') {
      void toggleFullscreen();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      setVolume((current) => Math.max(0, Math.min(1, current + (event.key === 'ArrowUp' ? 0.1 : -0.1))));
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handlePlayerKeyDown}
      role="group"
      aria-label="Video player. Press Space to play or pause, left and right arrows to seek, M to mute, and F for fullscreen."
      className="group relative aspect-video w-full overflow-hidden bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
    >
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        playsInline
        onClick={togglePlay}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onCanPlay={() => setIsBuffering(false)}
        onWaiting={() => {
          if (!videoRef.current?.paused) setIsBuffering(true);
        }}
        onPlay={() => setIsPlaying(true)}
        onPlaying={() => {
          setIsPlaying(true);
          setIsBuffering(false);
        }}
        onPause={() => setIsPlaying(false)}
        onError={() => {
          setPlaybackError('This video could not be played. Try again later.');
          setIsBuffering(false);
        }}
        onEnded={() => setIsPlaying(false)}
        muted={isMuted}
      />
      {isBuffering && !playbackError && (
        <div role="status" aria-live="polite" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 bg-black/35 text-sm text-white">
          <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" />
          <span>Buffering video…</span>
        </div>
      )}
      {playbackError && (
        <div role="alert" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/75 p-6 text-center text-sm text-white">
          <p>{playbackError}</p>
          <button
            type="button"
            onClick={() => {
              setPlaybackError(null);
              setPlaybackAttempt((attempt) => attempt + 1);
            }}
            className="min-h-11 rounded-control bg-white/15 px-4 font-semibold text-white hover:bg-white/25"
          >
            Try playback again
          </button>
        </div>
      )}

      <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 transition-opacity duration-300 sm:p-4 ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0'}`}>
        <div className="mb-1 w-full sm:mb-3">
          <input
            type="range"
            min="0"
            max="100"
            value={progress || 0}
            onChange={handleSeek}
            disabled={seekableKey !== playbackKey}
            aria-valuetext={`${currentTime} of ${duration}`}
            className="h-6 w-full cursor-pointer accent-brand-light disabled:cursor-not-allowed sm:h-4"
            aria-label="Seek video"
          />
        </div>

        <div className="flex items-center justify-between gap-2 text-white">
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <button type="button" onClick={togglePlay} aria-label={isPlaying ? 'Pause video' : 'Play video'} className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-white/10 hover:text-brand-light">
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            </button>
            <button type="button" onClick={() => setIsMuted(!isMuted)} aria-label={isMuted ? 'Unmute video' : 'Mute video'} aria-pressed={isMuted} className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-white/10 hover:text-brand-light">
              {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(volume * 100)}
              onChange={(event) => {
                const next = Number(event.target.value) / 100;
                setVolume(next);
                if (next > 0) setIsMuted(false);
              }}
              aria-label="Volume"
              className="hidden h-4 w-20 accent-brand-light sm:block"
            />
            <span className="whitespace-nowrap font-display text-[11px] tabular-nums sm:text-sm">
              {currentTime} / {duration}
            </span>
          </div>

          <div className="relative flex shrink-0 items-center gap-2 sm:gap-4">
            <button
                type="button"
                onClick={toggleLowBandwidth}
                aria-pressed={isLowBandwidth}
                className={`flex items-center gap-1 rounded-control px-2 py-1 text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${isLowBandwidth ? 'bg-status-warning text-status-warning-foreground' : 'bg-surface-subtle text-text-primary hover:bg-surface-hover'}`}
                title="Low-Bandwidth Mode (360p)"
            >
                <SignalLow className="w-4 h-4" />
                <span className="hidden sm:inline">Data Saver</span>
            </button>

            <div className="relative">
                <button type="button" onClick={() => setShowResMenu(!showResMenu)} className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-white/10 hover:text-brand-light" aria-label="Playback settings" aria-haspopup="menu" aria-expanded={showResMenu}>
                    <Settings className="w-5 h-5 cursor-pointer" />
                </button>

                {showResMenu && (
                    <div role="menu" className="absolute bottom-12 right-0 z-50 flex min-w-[120px] flex-col rounded-lg border border-border bg-surface-dark py-2 text-text-primary shadow-xl">
                        <button
                            role="menuitem"
                            className={`px-4 py-1 text-left text-sm hover:bg-surface-hover ${currentRes === -1 ? 'text-brand-dark font-bold' : ''}`}
                            onClick={() => changeResolution(-1)}
                            type="button"
                        >
                            Auto
                        </button>
                        {levels.map(level => (
                            <button
                                key={level.index}
                                role="menuitem"
                                className={`px-4 py-1 text-left text-sm hover:bg-surface-hover ${currentRes === level.index ? 'text-brand-dark font-bold' : ''}`}
                                onClick={() => changeResolution(level.index)}
                                type="button"
                            >
                                {level.height}p
                            </button>
                        ))}
                        <div className="my-1 border-t border-border" />
                        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                            <button
                                key={rate}
                                role="menuitem"
                                type="button"
                                className={`px-4 py-1 text-left text-sm hover:bg-surface-hover ${playbackRate === rate ? 'text-brand-dark font-bold' : ''}`}
                                onClick={() => {
                                    setPlaybackRate(rate);
                                    setShowResMenu(false);
                                }}
                            >
                                {rate === 1 ? 'Normal' : `${rate}x`}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <button type="button" onClick={() => void toggleFullscreen()} aria-label="Toggle fullscreen" className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-white/10 hover:text-brand-light">
              <Maximize className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
