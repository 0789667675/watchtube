import React, { useState, useEffect } from 'react';
import { VideoCard } from '../components/video/VideoCard';
import axios from 'axios';

export const TrendingPage: React.FC = () => {
  const [videos, setVideos] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTrending = async () => {
      try {
        const response = await axios.get('/api/v1/feed/trending');
        setVideos(response.data);
      } catch (error) {
        console.error('Trending fetch failed:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTrending();
  }, []);

  return (
    <div className="w-full p-4 md:p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold font-display mb-6">Trending Now</h1>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full" /></div>
      ) : videos.length > 0 ? (
        <div className="flex flex-col gap-6">
          {videos.map((video, index) => (
            <div key={video.id} className="flex gap-4 items-start relative group">
              <div className="absolute -left-2 -top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 border-canvas-light bg-brand-action font-bold text-brand-foreground shadow-sm dark:border-canvas-obsidian">
                #{index + 1}
              </div>
              <div className="w-full sm:w-80 shrink-0">
                  <VideoCard
                    id={video.id}
                    title={video.title}
                    thumbnail={video.thumbnailUrl || ''}
                    duration={'Auto'}
                    views={`${video.viewsCount}`}
                    date={'Recently'}
                    channel={{
                        name: video.channel.name,
                        handle: video.channel.handle,
                        avatar: video.channel.avatarUrl,
                        isVerified: video.channel.isVerified
                    }}
                  />
              </div>
              <div className="hidden sm:block flex-1 pt-2">
                 <p className="line-clamp-3 text-sm text-text-muted">{video.description}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <p className="text-text-muted">No trending videos right now.</p>
        </div>
      )}
    </div>
  );
};
