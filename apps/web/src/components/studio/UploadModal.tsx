import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, X } from 'lucide-react';
import { useForm } from 'react-hook-form';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose }) => {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const { register, handleSubmit } = useForm();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
      setStep(2); // Move to upload/metadata step
      // Mock upload progress
      let p = 0;
      const interval = setInterval(() => {
        p += 10;
        setProgress(p);
        if (p >= 100) clearInterval(interval);
      }, 500);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/mp4': ['.mp4'], 'video/webm': ['.webm'], 'video/quicktime': ['.mov'] },
    maxSize: 2 * 1024 * 1024 * 1024 // 2GB
  });

  const onSubmitMetadata = (data: any) => {
    console.log('Metadata submitted:', data);
    setStep(3); // Success step
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-surface-light dark:bg-surface-dark rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-4 border-b border-border-light dark:border-border-dark">
          <h2 className="text-xl font-bold font-display">Upload Video</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"><X className="w-6 h-6" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div {...getRootProps()} className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition ${isDragActive ? 'border-brand-light bg-brand-light/10' : 'border-gray-300 dark:border-gray-700 hover:border-gray-400'}`}>
              <input {...getInputProps()} />
              <UploadCloud className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <p className="text-lg font-medium mb-1">Drag and drop video files to upload</p>
              <p className="text-sm text-gray-500 mb-6">Your videos will be private until you publish them.</p>
              <button className="bg-brand-light dark:bg-brand-dark text-white font-bold px-6 py-2 rounded-full pointer-events-none">
                Select Files
              </button>
            </div>
          )}

          {step === 2 && (
            <form id="meta-form" onSubmit={handleSubmit(onSubmitMetadata)} className="space-y-6">
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 flex items-center gap-4">
                <div className="w-16 h-16 bg-gray-200 dark:bg-gray-700 rounded flex items-center justify-center shrink-0">
                  <Video className="w-8 h-8 text-gray-400" />
                </div>
                <div className="flex-1">
                  <p className="font-medium truncate mb-1">{file?.name}</p>
                  <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-light dark:bg-brand-dark transition-all duration-300" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Uploading: {progress}%</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Title (required)</label>
                <input {...register('title', { required: true })} type="text" className="w-full rounded-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2 focus:ring-brand-light focus:outline-none" defaultValue={file?.name} />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea {...register('description')} rows={4} className="w-full rounded-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2 focus:ring-brand-light focus:outline-none" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Category</label>
                  <select {...register('category')} className="w-full rounded-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2">
                    <option>Technology</option>
                    <option>Music</option>
                    <option>Education</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Visibility</label>
                  <select {...register('visibility')} className="w-full rounded-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2">
                    <option value="PUBLIC">Public</option>
                    <option value="UNLISTED">Unlisted</option>
                    <option value="PRIVATE">Private</option>
                  </select>
                </div>
              </div>
            </form>
          )}

          {step === 3 && (
            <div className="text-center py-12">
              <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-xl font-bold mb-2">Processing Queued</h3>
              <p className="text-gray-500">We are currently processing your video into different formats. It will be available shortly.</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border-light dark:border-border-dark flex justify-end">
          {step === 2 && (
            <button form="meta-form" type="submit" disabled={progress < 100} className="bg-brand-light dark:bg-brand-dark text-white font-bold px-6 py-2 rounded-lg disabled:opacity-50 transition">
              {progress < 100 ? 'Uploading...' : 'Save & Publish'}
            </button>
          )}
          {step === 3 && (
            <button onClick={onClose} className="bg-brand-light dark:bg-brand-dark text-white font-bold px-6 py-2 rounded-lg">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Temp mock for missing lucide icon in this scope
const Video = ({ className }: { className?: string }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>;
const CheckCircle2 = ({ className }: { className?: string }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>;
