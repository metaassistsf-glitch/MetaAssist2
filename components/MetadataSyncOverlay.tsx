import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface MetadataSyncOverlayProps {
  isVisible: boolean;
  currentCategory: string;
  currentItem: string;
  progress: number;
  total: number;
  errorCount: number;
  onCancel: () => void;
  source?: 'salesforce' | 'database';
}

const MetadataSyncOverlay: React.FC<MetadataSyncOverlayProps> = ({ isVisible, currentCategory, currentItem, progress, total, errorCount, onCancel, source = 'salesforce' }) => {
  if (!isVisible) return null;

  const percentage = total > 0 ? Math.round((progress / total) * 100) : 0;
  const message = source === 'database' 
    ? 'Retrieving metadata from database...' 
    : 'Fetching latest metadata from Salesforce and storing securely in database.';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] bg-[#2E2E38]/90 backdrop-blur-md flex items-center justify-center p-6"
      >
        <div className="max-w-md w-full bg-white rounded-[32px] p-10 shadow-2xl text-center">
          <div className="relative w-24 h-24 mx-auto mb-8">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="48"
                cy="48"
                r="40"
                stroke="currentColor"
                strokeWidth="8"
                fill="transparent"
                className="text-slate-100"
              />
              <circle
                cx="48"
                cy="48"
                r="40"
                stroke="currentColor"
                strokeWidth="8"
                fill="transparent"
                strokeDasharray={251.2}
                strokeDashoffset={251.2 - (251.2 * percentage) / 100}
                className="text-[#2E2E38] transition-all duration-500 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xl font-semibold text-slate-900">{percentage}%</span>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-slate-900 uppercase tracking-tight mb-2">
            {source === 'database' ? 'Retrieving Metadata' : 'Syncing Metadata'}
          </h2>
          <p className="text-slate-500 text-sm mb-8 font-medium">
            {message}
          </p>

          <div className="space-y-4 text-left">
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Category</span>
                <span className="text-[10px] font-semibold text-[#2E2E38] uppercase tracking-widest bg-[#FFE600]/10 px-2 py-0.5 rounded-full">
                  {currentCategory || 'Initializing...'}
                </span>
              </div>
              <div className="text-sm font-semibold text-slate-700 truncate">
                {currentItem || 'Preparing batch...'}
              </div>
            </div>

            <div className="flex items-center justify-between px-1">
              <div className="flex flex-col">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Progress</span>
                <span className="text-xs font-semibold text-slate-700">{progress} / {total} Items</span>
              </div>
              {errorCount > 0 && (
                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-semibold text-rose-400 uppercase tracking-widest">Errors</span>
                  <span className="text-xs font-semibold text-rose-600">{errorCount} Failed</span>
                </div>
              )}
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center space-y-6">
            <div className="flex items-center justify-center space-x-2 text-slate-400">
              <div className="w-1.5 h-1.5 bg-[#FFE600]/100 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-1.5 h-1.5 bg-[#FFE600]/100 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-1.5 h-1.5 bg-[#FFE600]/100 rounded-full animate-bounce"></div>
            </div>

            <button
              onClick={onCancel}
              className="px-8 py-3 bg-slate-100 text-slate-600 font-semibold rounded-xl hover:bg-rose-50 hover:text-rose-600 transition-all uppercase tracking-widest text-[10px]"
            >
              Cancel Retrieval
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default MetadataSyncOverlay;
