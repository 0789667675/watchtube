import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { VideoCard } from '../components/video/VideoCard';
import axios from 'axios';

export const SearchPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q');
  const [videos, setVideos] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchResults = async () => {
      if (!q) return;
      setIsLoading(true);
      try {
        const response = await axios.get(`/api/v1/feed/search?q=${encodeURIComponent(q)}`);
        setVideos(response.data);
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchResults();
  }, [q]);

  if (!q) {
    return <div className="p-6 text-center text-gray-500">Please enter a search term.</div>;
  }

  return (
    <div className="w-full p-4 md:p-6 max-w-7xl mx-auto">
      <h1 className="text-xl font-bold font-display mb-6">Search results for "{q}"</h1>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-brand-light dark:border-brand-dark border-t-transparent rounded-full" /></div>
      ) : videos.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-10 gap-x-6">
          {videos.map((video) => (
            <VideoCard
              key={video.id}
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
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <p className="text-gray-500">No results found for "{q}".</p>
        </div>
      )}
    </div>
  );
};
