import React, { useState } from 'react';
import { ThumbsUp, ThumbsDown, Share2, Download, BookmarkPlus, CheckCircle2 } from 'lucide-react';
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
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [likeState, setLikeState] = useState<'NONE' | 'LIKE' | 'DISLIKE'>('NONE');

  const toggleSubscribe = () => setIsSubscribed(!isSubscribed);

  return (
    <div className="max-w-[1800px] mx-auto sm:p-4 md:p-6 lg:flex lg:gap-6">
      <div className="lg:w-[70%] xl:w-[75%]">
        <VideoPlayer src={MOCK_VIDEO.masterPlaylistUrl} videoId={MOCK_VIDEO.id} />

        <div className="px-4 sm:px-0"><h1 className="text-xl md:text-2xl font-bold font-display mt-4">{MOCK_VIDEO.title}</h1>

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
            <button
              onClick={toggleSubscribe}
              className={`font-bold px-4 py-2 rounded-full ml-2 transition ${
                isSubscribed
                  ? 'bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-700'
                  : 'bg-secondary-amber text-black hover:opacity-90'
              }`}
            >
              {isSubscribed ? 'Subscribed' : 'Subscribe'}
            </button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0">
            <div className="flex bg-gray-100 dark:bg-surface-dark rounded-full overflow-hidden">
              <button
                onClick={() => setLikeState(likeState === 'LIKE' ? 'NONE' : 'LIKE')}
                className={`flex items-center gap-2 px-4 py-2 hover:bg-gray-200 dark:hover:bg-gray-800 transition border-r border-gray-300 dark:border-gray-700 ${likeState === 'LIKE' ? 'text-brand-light dark:text-brand-dark' : ''}`}
              >
                <ThumbsUp className="w-4 h-4" /> 12K
              </button>
              <button
                onClick={() => setLikeState(likeState === 'DISLIKE' ? 'NONE' : 'DISLIKE')}
                className={`flex items-center gap-2 px-4 py-2 hover:bg-gray-200 dark:hover:bg-gray-800 transition ${likeState === 'DISLIKE' ? 'text-brand-light dark:text-brand-dark' : ''}`}
              >
                <ThumbsDown className="w-4 h-4" />
              </button>
            </div>
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

        {/* Comments Section */}
        <div className="mt-8">
          <h2 className="text-xl font-bold font-display mb-4">1,432 Comments</h2>
          <div className="flex gap-4 mb-8">
            <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-700 shrink-0" />
            <div className="flex-1">
              <textarea
                className="w-full bg-transparent border-b border-gray-300 dark:border-gray-700 focus:border-brand-light dark:focus:border-brand-dark outline-none resize-none py-1"
                placeholder="Add a comment..."
                rows={1}
              />
              <div className="flex justify-end mt-2 gap-2">
                <button className="px-4 py-2 rounded-full font-medium hover:bg-gray-100 dark:hover:bg-gray-800 transition">Cancel</button>
                <button className="px-4 py-2 rounded-full font-bold bg-brand-light dark:bg-brand-dark text-white opacity-50 cursor-not-allowed">Comment</button>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-700 shrink-0" />
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-sm">@user{i}</span>
                    <span className="text-xs text-gray-500">2 hours ago</span>
                  </div>
                  <p className="text-sm mb-2">This is an amazing explanation of the architecture. I really appreciate the detailed breakdown of the HLS transcoding process.</p>
                  <div className="flex items-center gap-4">
                    <button className="flex items-center gap-1 hover:text-brand-light transition">
                      <ThumbsUp className="w-4 h-4" /> <span className="text-xs">45</span>
                    </button>
                    <button className="hover:text-brand-light transition">
                      <ThumbsDown className="w-4 h-4" />
                    </button>
                    <button className="text-xs font-bold hover:bg-gray-100 dark:hover:bg-gray-800 px-3 py-1 rounded-full transition">Reply</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      </div><div className="px-4 sm:px-0 lg:w-[30%] xl:w-[25%] mt-6 lg:mt-0">
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
