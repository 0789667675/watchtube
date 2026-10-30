import React from 'react';
import { VideoCard } from '../components/video/VideoCard';

// Mock data until API is wired up
const MOCK_VIDEOS = Array(6).fill(null).map((_, i) => ({
  id: `vid-${i}`,
  title: 'Understanding PostgreSQL Indexing Strategies',
  thumbnail: `https://images.unsplash.com/photo-1627398225081-24c8b0914db9?auto=format&fit=crop&q=80&w=1000&sig=${i+10}`, // Cache buster
  duration: '15:20',
  views: '2K',
  date: '1 hour ago',
  channel: {
    name: 'Tech Insights',
    handle: '@TechInsights',
    avatar: 'https://images.unsplash.com/photo-1531297172864-822db6ce0d8d?auto=format&fit=crop&q=80&w=150',
    isVerified: true,
  }
}));

export const SubscriptionsPage: React.FC = () => {
  return (
    <div className="w-full p-4 md:p-6">
      <h1 className="text-2xl font-bold font-display mb-6">Subscriptions</h1>

      {MOCK_VIDEOS.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-y-10 gap-x-4">
          {MOCK_VIDEOS.map((video) => (
            <VideoCard key={video.id} {...video} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-full mb-4" />
          <h2 className="text-xl font-bold mb-2">No videos yet</h2>
          <p className="text-gray-500">Subscribe to channels to see their latest videos here.</p>
        </div>
      )}
    </div>
  );
};
