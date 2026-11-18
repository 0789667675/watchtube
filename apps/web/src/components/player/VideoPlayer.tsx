import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Play, Pause, Volume2, VolumeX, Maximize, Settings, SignalLow } from 'lucide-react';

interface VideoPlayerProps {
  src: string; // The master.m3u8 URL
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ src }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState('00:00');
  const [duration, setDuration] = useState('00:00');
  const [showControls, setShowControls] = useState(true);
  const [isLowBandwidth, setIsLowBandwidth] = useState(false);
  const [showResMenu, setShowResMenu] = useState(false);
  const [currentRes, setCurrentRes] = useState<number>(-1); // -1 is Auto
  const [levels, setLevels] = useState<{height: number; index: number}[]>([]);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const formatTime = (time: number) => {
    if (!Number.isFinite(time)) return '00:00';
    const min = Math.floor(time / 60).toString().padStart(2, '0');
    const sec = Math.floor(time % 60).toString().padStart(2, '0');
    return `${min}:${sec}`;
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setPlaybackError(null);
    setIsPlaying(false);

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
        if (data.fatal) setPlaybackError('This video could not be played. Try again later.');
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    } else {
      setPlaybackError('This browser does not support this video format.');
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [src, isLowBandwidth]);

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
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(formatTime(videoRef.current.duration));
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (videoRef.current) {
      const time = (parseFloat(e.target.value) / 100) * videoRef.current.duration;
      videoRef.current.currentTime = time;
      setProgress(parseFloat(e.target.value));
    }
  };

  const toggleFullscreen = () => {
    if (containerRef.current) {
      if (!document.fullscreenElement) {
        containerRef.current.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    }
  };

  return (
    <div ref={containerRef} className="group relative aspect-video w-full overflow-hidden bg-black">
      <video
        ref={videoRef}
        className="h-full w-full"
        playsInline
        onClick={togglePlay}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={() => setPlaybackError('This video could not be played. Try again later.')}
        onEnded={() => setIsPlaying(false)}
        muted={isMuted}
      />
      {playbackError && (
        <div role="alert" className="absolute inset-0 z-10 flex items-center justify-center bg-black/75 p-6 text-center text-sm text-white">
          {playbackError}
        </div>
      )}

      <div className={`absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent transition-opacity duration-300 ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0'}`}>
        <div className="w-full mb-4">
          <input
            type="range"
            min="0"
            max="100"
            value={progress || 0}
            onChange={handleSeek}
            className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-brand-light dark:accent-brand-dark"
            aria-label="Seek video"
          />
        </div>

        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-4">
            <button type="button" onClick={togglePlay} aria-label={isPlaying ? 'Pause video' : 'Play video'} className="hover:text-brand-light transition">
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            </button>
            <button type="button" onClick={() => setIsMuted(!isMuted)} aria-label={isMuted ? 'Unmute video' : 'Mute video'} className="hover:text-brand-light transition">
              {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
            </button>
            <span className="font-display tabular-nums text-sm">
              {currentTime} / {duration}
            </span>
          </div>

          <div className="flex items-center gap-4 relative">
            <button
                type="button"
                onClick={toggleLowBandwidth}
                className={`flex items-center gap-1 rounded-control px-2 py-1 text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${isLowBandwidth ? 'bg-status-warning text-status-warning-foreground' : 'bg-surface-subtle text-text-primary hover:bg-surface-hover'}`}
                title="Low-Bandwidth Mode (360p)"
            >
                <SignalLow className="w-4 h-4" />
                <span className="hidden sm:inline">Data Saver</span>
            </button>

            <div className="relative">
                <button type="button" onClick={() => setShowResMenu(!showResMenu)} className="hover:text-brand-light transition mt-1" aria-label="Playback settings" aria-expanded={showResMenu}>
                    <Settings className="w-5 h-5 cursor-pointer" />
                </button>

                {showResMenu && (
                    <div className="absolute bottom-8 right-0 z-50 flex min-w-[120px] flex-col rounded-lg border border-border bg-surface-dark py-2 text-text-primary shadow-xl">
                        <button
                            className={`px-4 py-1 text-left text-sm hover:bg-surface-hover ${currentRes === -1 ? 'text-brand-dark font-bold' : ''}`}
                            onClick={() => changeResolution(-1)}
                            type="button"
                        >
                            Auto
                        </button>
                        {levels.map(level => (
                            <button
                                key={level.index}
                                className={`px-4 py-1 text-left text-sm hover:bg-surface-hover ${currentRes === level.index ? 'text-brand-dark font-bold' : ''}`}
                                onClick={() => changeResolution(level.index)}
                                type="button"
                            >
                                {level.height}p
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <button type="button" onClick={toggleFullscreen} aria-label="Toggle fullscreen" className="hover:text-brand-light transition mt-1">
              <Maximize className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
