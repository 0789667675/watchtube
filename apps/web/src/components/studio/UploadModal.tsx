import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { apiClient, getApiErrorMessage } from '../../api/apiClient';
import {
  retryUploadVerification,
  retryVideoUpload,
  startVideoUpload,
  UploadWorkflowError,
  type UploadWorkflowDependencies,
} from '../../api/videoUploadWorkflow';

interface UploadModalProps {
  isOpen: boolean;
  channelId: string;
  onClose: () => void;
  onUploaded: () => void;
}

interface UploadForm {
  title: string;
}

type UploadPhase =
  | 'select'
  | 'ready'
  | 'requesting'
  | 'uploading'
  | 'verifying'
  | 'processing'
  | 'ready-to-watch'
  | 'rejected'
  | 'upload-error'
  | 'verify-error'
  | 'request-error';

const MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024;
const allowedTypes = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  channelId,
  onClose,
  onUploaded,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase>('select');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const { register, handleSubmit, reset, formState: { errors } } = useForm<UploadForm>();

  const workflowDependencies: UploadWorkflowDependencies = {
    requestIntent: async (metadata) => (
      await apiClient.post('/api/v1/videos/upload-intent', metadata)
    ).data,
    refreshUploadUrl: async (id, metadata) => (
      await apiClient.post<{ uploadUrl: string }>(`/api/v1/videos/${id}/upload-url`, metadata)
    ).data.uploadUrl,
    upload: async (url, selectedFile, onProgress) => {
      setPhase('uploading');
      setProgress(0);
      await axios.put(url, selectedFile, {
        withCredentials: false,
        headers: { 'Content-Type': selectedFile.type },
        onUploadProgress: (event) => {
          if (event.total) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        },
      });
      onProgress(100);
    },
    verify: async (id) => {
      setPhase('verifying');
      await apiClient.post(`/api/v1/videos/${id}/verify-upload`);
    },
  };

  const beginUpload = async ({ title }: UploadForm) => {
    if (!file || !channelId) {
      setError('Select a video and channel before uploading.');
      return;
    }
    if (!allowedTypes.has(file.type) || file.size <= 0 || file.size > MAX_UPLOAD_SIZE) {
      setError('Choose an MP4, WebM, or QuickTime video no larger than 2 GB.');
      return;
    }

    setError('');
    setPhase('requesting');
    try {
      const videoId = await startVideoUpload(
        workflowDependencies,
        { title: title.trim(), contentType: file.type, fileSize: file.size, channelId },
        file,
        setVideoId,
        setProgress,
      );
      setPhase('processing');
      onUploaded();
      return videoId;
    } catch (uploadError) {
      if (uploadError instanceof UploadWorkflowError && uploadError.videoId) {
        setVideoId(uploadError.videoId);
      }
      const stage = uploadError instanceof UploadWorkflowError ? uploadError.stage : 'intent';
      const cause = uploadError instanceof UploadWorkflowError ? uploadError.originalError : uploadError;
      const fallback = stage === 'upload'
        ? 'Upload failed or the upload link expired. Retry to get a fresh link.'
        : stage === 'verification'
          ? 'The upload could not be verified. Retry verification.'
          : 'Could not start the upload. Please try again.';
      setError(getApiErrorMessage(cause, fallback));
      setPhase(stage === 'upload' ? 'upload-error' : stage === 'verification' ? 'verify-error' : 'request-error');
    }
  };

  const retryUpload = async () => {
    if (!file || !videoId) return;
    setError('');
    setPhase('requesting');
    try {
      await retryVideoUpload(
        workflowDependencies,
        videoId,
        { contentType: file.type, fileSize: file.size },
        file,
        setProgress,
      );
      setPhase('processing');
      onUploaded();
    } catch (retryError) {
      const stage = retryError instanceof UploadWorkflowError ? retryError.stage : 'upload';
      const cause = retryError instanceof UploadWorkflowError ? retryError.originalError : retryError;
      setError(getApiErrorMessage(cause, 'Retry failed. Check your connection and try again.'));
      setPhase(stage === 'verification' ? 'verify-error' : 'upload-error');
    }
  };

  const retryVerification = async () => {
    if (!videoId) return;
    setError('');
    setPhase('verifying');
    try {
      await retryUploadVerification(workflowDependencies, videoId);
      setPhase('processing');
      onUploaded();
    } catch (verifyError) {
      const cause = verifyError instanceof UploadWorkflowError ? verifyError.originalError : verifyError;
      setError(getApiErrorMessage(cause, 'Verification is temporarily unavailable. Retry again.'));
      setPhase('verify-error');
    }
  };

  const refreshStatus = useCallback(async (id: string) => {
    const response = await apiClient.get<{ status: string }>(`/api/v1/videos/${id}/upload-status`);
    if (response.data.status === 'READY') {
      setPhase('ready-to-watch');
      onUploaded();
    } else if (response.data.status === 'REJECTED') {
      setPhase('rejected');
      setError('Processing failed. The video was not published.');
      onUploaded();
    }
  }, [onUploaded]);

  useEffect(() => {
    if (phase !== 'processing' || !videoId) return;
    let active = true;
    let timeout: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        await refreshStatus(videoId);
      } catch {
        if (active) setError('Could not refresh processing status. The server status is unchanged.');
      }
      if (active && phase === 'processing') {
        timeout = setTimeout(poll, 2000);
      }
    };

    timeout = setTimeout(poll, 1500);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [phase, videoId, refreshStatus]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;
    setFile(acceptedFiles[0]);
    setPhase('ready');
    setVideoId(null);
    setProgress(0);
    setError('');
    reset({ title: acceptedFiles[0].name });
  }, [reset]);

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    accept: {
      'video/mp4': ['.mp4'],
      'video/webm': ['.webm'],
      'video/quicktime': ['.mov'],
    },
    maxSize: MAX_UPLOAD_SIZE,
    multiple: false,
  });

  if (!isOpen) return null;

  const isBusy = ['requesting', 'uploading', 'verifying'].includes(phase);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-dialog-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface-light shadow-xl dark:bg-surface-dark"
      >
        <div className="flex justify-between items-center p-4 border-b border-border-light dark:border-border-dark">
          <h2 id="upload-dialog-title" className="text-xl font-bold font-display">Upload video</h2>
          <button type="button" onClick={onClose} disabled={isBusy} aria-label="Close upload dialog" className="rounded-full p-1 transition hover:bg-surface-hover disabled:opacity-50">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {!file && (
            <div {...getRootProps()} className={`cursor-pointer rounded-card border-2 border-dashed p-12 text-center transition ${isDragActive ? 'border-brand-primary bg-brand-primary/10' : 'border-border hover:border-brand-primary'}`}>
              <input {...getInputProps()} />
              <UploadCloud className="mx-auto mb-4 h-16 w-16 text-text-muted" />
              <p className="text-lg font-medium mb-1">Drag and drop a video file</p>
              <p className="text-sm text-text-muted">MP4, WebM, or QuickTime, up to 2 GB.</p>
            </div>
          )}
          {fileRejections.length > 0 && (
            <div role="alert" className="rounded-control bg-surface-subtle p-3 text-sm text-status-warning">
              {fileRejections.map(({ file: rejectedFile, errors: rejectionErrors }) => (
                <p key={`${rejectedFile.name}-${rejectedFile.size}`}>
                  {rejectedFile.name}: {rejectionErrors.map((item) => item.message).join(' ')}
                </p>
              ))}
            </div>
          )}

          {file && (
            <>
              <p className="font-medium truncate">{file.name}</p>
              {['ready', 'requesting', 'uploading', 'upload-error', 'request-error'].includes(phase) && (
                <form id="upload-form" onSubmit={handleSubmit(beginUpload)} className="space-y-4">
                  <label className="block text-sm font-medium">
                    Title
                    <input
                      {...register('title', {
                        required: 'Enter a video title.',
                        maxLength: { value: 255, message: 'Video titles must be 255 characters or fewer.' },
                        validate: (value) => value.trim().length > 0 || 'Enter a video title.',
                      })}
                      maxLength={255}
                      aria-invalid={Boolean(errors.title)}
                      aria-describedby={errors.title ? 'upload-title-error' : undefined}
                      className="mt-1 w-full rounded-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2"
                    />
                  </label>
                  {errors.title?.message && <p id="upload-title-error" role="alert" className="text-sm text-status-warning">{errors.title.message}</p>}
                  {phase === 'uploading' && (
                    <div aria-live="polite">
                      <progress
                        aria-label="Video upload progress"
                        max={100}
                        value={progress}
                        className="h-2 w-full accent-brand-action"
                      />
                      <p className="mt-1 text-xs text-text-muted">Uploading: {progress}%</p>
                    </div>
                  )}
                  {phase === 'upload-error' && videoId && (
                    <button type="button" onClick={retryUpload} className="rounded-control bg-brand-action px-4 py-2 font-bold text-brand-foreground">
                      Retry upload
                    </button>
                  )}
                </form>
              )}
              {phase === 'verifying' && <p role="status">Verifying the uploaded file…</p>}
              {phase === 'verify-error' && (
                <button type="button" onClick={retryVerification} className="rounded-control bg-brand-action px-4 py-2 font-bold text-brand-foreground">
                  Retry verification
                </button>
              )}
              {phase === 'processing' && <p role="status">Processing video…</p>}
              {phase === 'ready-to-watch' && <p role="status">Video processing completed.</p>}
              {phase === 'rejected' && <p role="alert">Video processing failed.</p>}
              {error && <p role="alert" className="text-sm text-status-warning">{error}</p>}
            </>
          )}
        </div>

        <div className="p-4 border-t border-border-light dark:border-border-dark flex justify-between">
          {file && !isBusy && phase !== 'processing' && phase !== 'ready-to-watch' && phase !== 'rejected' && (
            <button type="button" onClick={() => { setFile(null); setPhase('select'); setVideoId(null); setError(''); }} className="rounded-control px-4 py-2 text-sm font-medium">
              Choose another file
            </button>
          )}
          {['ready', 'request-error'].includes(phase) && (
            <button form="upload-form" type="submit" disabled={isBusy} className="ml-auto rounded-control bg-brand-action px-6 py-2 font-bold text-brand-foreground disabled:opacity-50">
              {phase === 'request-error' ? 'Retry' : 'Upload'}
            </button>
          )}
          {phase === 'ready-to-watch' && (
            <button type="button" onClick={onClose} className="ml-auto rounded-control bg-brand-action px-6 py-2 font-bold text-brand-foreground">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
