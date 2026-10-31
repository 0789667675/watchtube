import React, { useState } from 'react';
import { VideoCard } from '../components/video/VideoCard';

const CATEGORIES = ['All', 'Kinyarwanda', 'Music', 'Technology', 'Documentaries', 'Culture', 'Sports', 'News', 'Gaming', 'Education'];

// Mock data until API is wired up
const MOCK_VIDEOS = Array(12).fill(null).map((_, i) => ({
  id: `vid-${i}`,
  title: 'Exploring the Virunga Mountains: A Journey Through Rwanda',
  thumbnail: `https://images.unsplash.com/photo-1627398225081-24c8b0914db9?auto=format&fit=crop&q=80&w=1000&sig=${i}`, // Cache buster
  duration: '45:20',
  views: '24K',
  date: '3 days ago',
  channel: {
    name: 'Rwanda Tourism',
    handle: '@VisitRwanda',
    avatar: 'https://images.unsplash.com/photo-1531297172864-822db6ce0d8d?auto=format&fit=crop&q=80&w=150',
    isVerified: true,
  }
}));

export const HomePage: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState('All');

  return (
    <div className="w-full">
      <div className="sticky top-16 z-40 bg-canvas-light/95 dark:bg-canvas-obsidian/95 backdrop-blur w-full border-b border-border-light dark:border-border-dark py-3 overflow-x-auto hide-scrollbar">
        <div className="flex gap-3 px-4 md:px-6 w-max mx-auto md:mx-0">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                activeCategory === cat
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-surface-dark dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 md:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-y-10 gap-x-4">
        {MOCK_VIDEOS.map((video) => (
          <VideoCard key={video.id} {...video} />
        ))}
      </div>
    </div>
  );
};
