import React, { useState } from 'react';
import { ThumbsUp, Share2, Download, BookmarkPlus, CheckCircle2 } from 'lucide-react';
import { VideoPlayer } from '../components/player/VideoPlayer';

// Mock data until API is wired up
const MOCK_VIDEO = {
  id: '1',
  title: 'Building a Scalable Video Platform',
  views: '124,532',
  date: '2 days ago',
  description: 'Join us as we explore the architecture behind scalable video streaming. We will cover HLS, adaptive bitrate streaming, and Cloudflare R2 storage.',
  thumbnailUrl: 'https://images.unsplash.com/photo-1627398225081-24c8b0914db9?auto=format&fit=crop&q=80&w=1000',
  masterPlaylistUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', // Public HLS test stream
  channel: {
    name: 'Tech Architecture',
    handle: '@TechArch',
    subscribers: '1.2M',
    avatar: 'https://images.unsplash.com/photo-1531297172864-822db6ce0d8d?auto=format&fit=crop&q=80&w=150',
    isVerified: true,
  }
};

export const WatchPage: React.FC = () => {
  const [isDescExpanded, setIsDescExpanded] = useState(false);

  return (
    <div className="max-w-[1800px] mx-auto p-4 md:p-6 lg:flex lg:gap-6">
      <div className="lg:w-[70%] xl:w-[75%]">
        <VideoPlayer src={MOCK_VIDEO.masterPlaylistUrl} />

        <h1 className="text-xl md:text-2xl font-bold font-display mt-4">{MOCK_VIDEO.title}</h1>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between mt-4 gap-4">
          <div className="flex items-center gap-4">
            <img src={MOCK_VIDEO.channel.avatar} alt={MOCK_VIDEO.channel.name} className="w-10 h-10 rounded-full object-cover" />
            <div>
              <div className="flex items-center gap-1">
                <span className="font-bold">{MOCK_VIDEO.channel.name}</span>
                {MOCK_VIDEO.channel.isVerified && <CheckCircle2 className="w-4 h-4 text-brand-light dark:text-brand-dark" />}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{MOCK_VIDEO.channel.subscribers} subscribers</p>
            </div>
            <button className="bg-secondary-amber text-black font-bold px-4 py-2 rounded-full ml-2 hover:opacity-90 transition">
              Subscribe
            </button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0">
            <button className="flex items-center gap-2 bg-gray-100 dark:bg-surface-dark px-4 py-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 transition whitespace-nowrap">
              <ThumbsUp className="w-4 h-4" /> 12K
            </button>
            <button className="flex items-center gap-2 bg-gray-100 dark:bg-surface-dark px-4 py-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 transition whitespace-nowrap">
              <Share2 className="w-4 h-4" /> Share
            </button>
            <button className="flex items-center gap-2 bg-gray-100 dark:bg-surface-dark px-4 py-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 transition whitespace-nowrap">
              <Download className="w-4 h-4" /> Download
            </button>
            <button className="flex items-center gap-2 bg-gray-100 dark:bg-surface-dark p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 transition">
              <BookmarkPlus className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="mt-4 bg-gray-100 dark:bg-surface-dark p-4 rounded-xl cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-800 transition" onClick={() => setIsDescExpanded(!isDescExpanded)}>
          <p className="font-bold text-sm mb-1">{MOCK_VIDEO.views} views • {MOCK_VIDEO.date}</p>
          <p className={`text-sm ${isDescExpanded ? '' : 'line-clamp-2'}`}>
            {MOCK_VIDEO.description}
          </p>
        </div>
      </div>

      <div className="lg:w-[30%] xl:w-[25%] mt-6 lg:mt-0">
        <h3 className="font-bold mb-4 font-display">Up Next</h3>
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-2 cursor-pointer group">
              <div className="relative w-40 aspect-video rounded-lg overflow-hidden shrink-0">
                <img src={MOCK_VIDEO.thumbnailUrl} alt="Thumbnail" className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] font-bold px-1 rounded tabular-nums">12:34</span>
              </div>
              <div className="flex flex-col py-1">
                <h4 className="text-sm font-bold line-clamp-2 leading-tight group-hover:text-brand-light dark:group-hover:text-brand-dark transition">{MOCK_VIDEO.title}</h4>
                <span className="text-xs text-gray-500 mt-1">{MOCK_VIDEO.channel.name}</span>
                <span className="text-xs text-gray-500">{MOCK_VIDEO.views} views • {MOCK_VIDEO.date}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
