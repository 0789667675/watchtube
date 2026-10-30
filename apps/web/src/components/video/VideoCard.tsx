import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

interface VideoCardProps {
  id: string;
  title: string;
  thumbnail: string;
  duration: string;
  views: string;
  date: string;
  channel: {
    name: string;
    handle: string;
    avatar: string;
    isVerified: boolean;
  };
}

export const VideoCard: React.FC<VideoCardProps> = ({ id, title, thumbnail, duration, views, date, channel }) => {
  return (
    <div className="flex flex-col gap-3 cursor-pointer group w-full">
      <Link to={`/watch/${id}`}>
        <div className="relative w-full aspect-video rounded-xl overflow-hidden">
          <img src={thumbnail} alt={title} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
          <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs font-bold px-1.5 py-0.5 rounded tabular-nums">
            {duration}
          </span>
        </div>
      </Link>

      <div className="flex gap-3 pr-4">
        <img src={channel.avatar} alt={channel.name} className="w-9 h-9 rounded-full object-cover shrink-0 mt-1" />
        <div className="flex flex-col">
          <Link to={`/watch/${id}`}>
            <h3 className="text-base font-bold line-clamp-2 leading-snug group-hover:text-brand-light dark:group-hover:text-brand-dark transition">
              {title}
            </h3>
          </Link>
          <div className="flex items-center gap-1 mt-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition">
            <span>{channel.name}</span>
            {channel.isVerified && <CheckCircle2 className="w-3.5 h-3.5 text-gray-500" />}
          </div>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {views} views • {date}
          </span>
        </div>
      </div>
    </div>
  );
};
