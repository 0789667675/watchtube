import React, { useState } from 'react';
import { UploadModal } from '../../components/studio/UploadModal';

export const ContentPage: React.FC = () => {
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  // Mock tabular data
  const MOCK_CONTENT = [
    { id: '1', title: 'My First Video', status: 'READY', visibility: 'PUBLIC', views: 120, date: 'Oct 30, 2023' },
    { id: '2', title: 'Uploading...', status: 'PROCESSING', visibility: 'PRIVATE', views: 0, date: 'Oct 31, 2023' },
  ];

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold font-display">Channel content</h1>
        <button onClick={() => setIsUploadOpen(true)} className="bg-secondary-amber text-black font-bold px-4 py-2 rounded-lg hover:opacity-90">
          Upload Video
        </button>
      </div>

      <div className="w-full overflow-x-auto border border-border-light dark:border-border-dark rounded-xl">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-border-light dark:border-border-dark">
            <tr>
              <th className="p-4 font-medium">Video</th>
              <th className="p-4 font-medium">Visibility</th>
              <th className="p-4 font-medium">Status</th>
              <th className="p-4 font-medium">Date</th>
              <th className="p-4 font-medium">Views</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light dark:divide-border-dark">
            {MOCK_CONTENT.map(video => (
              <tr key={video.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="p-4 flex items-center gap-3">
                  <div className="w-24 aspect-video bg-gray-200 dark:bg-gray-700 rounded" />
                  <span className="font-medium line-clamp-2">{video.title}</span>
                </td>
                <td className="p-4">{video.visibility}</td>
                <td className="p-4">
                  <span className={`px-2 py-1 text-xs font-bold rounded-full ${video.status === 'READY' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'}`}>
                    {video.status}
                  </span>
                </td>
                <td className="p-4">{video.date}</td>
                <td className="p-4">{video.views}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <UploadModal isOpen={isUploadOpen} onClose={() => setIsUploadOpen(false)} />
    </div>
  );
};
