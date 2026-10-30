import axios from 'axios';
import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Play, Pause, Volume2, VolumeX, Maximize, Settings, SignalLow } from 'lucide-react';

interface VideoPlayerProps {
  videoId?: string;
  src: string; // The master.m3u8 URL
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ src, videoId }) => {
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

  const formatTime = (time: number) => {
    if (isNaN(time)) return '00:00';
    const min = Math.floor(time / 60).toString().padStart(2, '0');
    const sec = Math.floor(time % 60).toString().padStart(2, '0');
    return `${min}:${sec}`;
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

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
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    }





    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
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
    let timeout: number | ReturnType<typeof setTimeout>;
    const handleMouseMove = () => {
      setShowControls(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setShowControls(false), 3000);
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('mousemove', handleMouseMove);
      container.addEventListener('mouseleave', () => setShowControls(false));
    }

    return () => {
      if (container) {
        container.removeEventListener('mousemove', handleMouseMove);
        container.removeEventListener('mouseleave', () => setShowControls(false));
      }
      clearTimeout(timeout);
    };
  }, []);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const current = videoRef.current.currentTime;
      const total = videoRef.current.duration;
      setProgress((current / total) * 100);
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

  // Telemetry Engine Heartbeat
  useEffect(() => {
    let interval: number | ReturnType<typeof setInterval>;

    if (isPlaying && videoId) {
      interval = setInterval(() => {
        if (videoRef.current) {
          const currentPosition = videoRef.current.currentTime;
          const duration = videoRef.current.duration;
          const completed = currentPosition >= duration * 0.95;

          // Send beacon without blocking main thread
          axios.post('/api/v1/analytics/telemetry', {
            videoId,
            sessionId: 'client-session-id', // normally generated once per app load
            currentPosition,
            durationWatched: 5,
            completed
          }).catch(console.error);
        }
      }, 5000);
    }

    return () => clearInterval(interval);
  }, [isPlaying, videoId]);



  return (
    <div ref={containerRef} className="relative w-full aspect-video bg-black group overflow-hidden">
      <video
        ref={videoRef}
        className="w-full h-full"
        onClick={togglePlay}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
        muted={isMuted}
      />

      <div className={`absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent transition-opacity duration-300 ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0'}`}>
        <div className="w-full mb-4">
          <input
            type="range"
            min="0"
            max="100"
            value={progress || 0}
            onChange={handleSeek}
            className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-brand-light dark:accent-brand-dark"
          />
        </div>

        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-4">
            <button onClick={togglePlay} className="hover:text-brand-light transition">
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            </button>
            <button onClick={() => setIsMuted(!isMuted)} className="hover:text-brand-light transition">
              {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
            </button>
            <span className="font-display tabular-nums text-sm">
              {currentTime} / {duration}
            </span>
          </div>

          <div className="flex items-center gap-4 relative">
            <button
                onClick={toggleLowBandwidth}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition ${isLowBandwidth ? 'bg-secondary-amber text-black' : 'bg-gray-800 text-white hover:bg-gray-700'}`}
                title="Low-Bandwidth Mode (360p)"
            >
                <SignalLow className="w-4 h-4" />
                <span className="hidden sm:inline">Data Saver</span>
            </button>

            <div className="relative">
                <button onClick={() => setShowResMenu(!showResMenu)} className="hover:text-brand-light transition mt-1">
                    <Settings className="w-5 h-5 cursor-pointer" />
                </button>

                {showResMenu && (
                    <div className="absolute bottom-8 right-0 bg-gray-900 border border-gray-700 rounded-lg py-2 flex flex-col min-w-[120px] z-50">
                        <button
                            className={`px-4 py-1 text-left text-sm hover:bg-gray-800 ${currentRes === -1 ? 'text-brand-light font-bold' : ''}`}
                            onClick={() => changeResolution(-1)}
                        >
                            Auto
                        </button>
                        {levels.map(level => (
                            <button
                                key={level.index}
                                className={`px-4 py-1 text-left text-sm hover:bg-gray-800 ${currentRes === level.index ? 'text-brand-light font-bold' : ''}`}
                                onClick={() => changeResolution(level.index)}
                            >
                                {level.height}p
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <button onClick={toggleFullscreen} className="hover:text-brand-light transition mt-1">
              <Maximize className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
