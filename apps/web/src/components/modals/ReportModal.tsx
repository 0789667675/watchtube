import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { X } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '../../api/apiClient';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetId: string;
  targetType: 'VIDEO' | 'COMMENT' | 'CHANNEL';
}

export const ReportModal: React.FC<ReportModalProps> = ({ isOpen, onClose, targetId, targetType }) => {
  const [reason, setReason] = useState('SPAM');
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setReason('SPAM');
    setDetails('');
    setIsSubmitting(false);
    setIsSuccess(false);
    setError(null);
  }, [isOpen, targetId, targetType]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/api/v1/reports', {
        targetType,
        targetId,
        reason,
        details: details.trim() || undefined,
      });
      setIsSuccess(true);
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        setError('Sign in to submit a report.');
      } else {
        setError(getApiErrorMessage(requestError, 'The report could not be submitted.'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-surface-light dark:bg-surface-dark p-6 rounded-2xl shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold font-display">Report Content</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close report dialog"
            className="rounded-full p-1 transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isSuccess ? (
          <div className="py-6 text-center">
            <p role="status" className="font-bold text-green-600 dark:text-green-400">
              Report submitted successfully. Thank you.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 rounded-control bg-surface-subtle px-4 py-2 text-sm font-semibold transition hover:bg-surface-hover"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Reason</label>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-control border border-border-light bg-canvas-light px-4 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-focus dark:border-border-dark dark:bg-canvas-obsidian">
              <option value="SPAM">Spam</option>
                <option value="HARASSMENT">Harassment or bullying</option>
                <option value="HATE_SPEECH">Hate speech</option>
                <option value="COPYRIGHT">Copyright infringement</option>
              <option value="MISLEADING">Misleading content</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Additional Details</label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={4}
                className="w-full rounded-control border border-border-light bg-canvas-light px-4 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-focus dark:border-border-dark dark:bg-canvas-obsidian"
                placeholder="Provide any additional context..."
              />
            </div>

            {error && <p role="alert" className="text-sm text-status-warning">{error}</p>}

            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-control px-4 py-2 text-sm font-medium transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={isSubmitting} className="px-4 py-2 rounded-lg text-sm font-bold bg-red-600 text-white hover:bg-red-700 disabled:cursor-wait disabled:opacity-50">
                {isSubmitting ? 'Submitting…' : 'Submit Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
