import React, { useState } from 'react';
import { X } from 'lucide-react';
import axios from 'axios';

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

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await axios.post('/api/v1/reports', {
        targetType,
        targetId,
        reason,
        details
      });
      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        onClose();
      }, 2000);
    } catch (error) {
      alert('Failed to submit report.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-surface-light dark:bg-surface-dark p-6 rounded-2xl shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold font-display">Report Content</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"><X className="w-5 h-5" /></button>
        </div>

        {isSuccess ? (
          <div className="py-8 text-center text-green-600 dark:text-green-400 font-bold">
            Report submitted successfully. Thank you.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Reason</label>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2 focus:ring-brand-light focus:outline-none">
                <option value="SPAM">Spam or misleading</option>
                <option value="HARASSMENT">Harassment or bullying</option>
                <option value="HATE_SPEECH">Hate speech</option>
                <option value="COPYRIGHT">Copyright infringement</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Additional Details</label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={4}
                className="w-full rounded-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2 focus:ring-brand-light focus:outline-none"
                placeholder="Provide any additional context..."
              />
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-800">Cancel</button>
              <button type="submit" disabled={isSubmitting} className="px-4 py-2 rounded-lg text-sm font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">Submit Report</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
