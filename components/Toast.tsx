
import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface ToastMessage {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContextType {
  toast: (message: Omit<ToastMessage, 'id'>) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const toast = useCallback((message: Omit<ToastMessage, 'id'>) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { ...message, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const handleClose = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-8 right-8 z-[2000] flex flex-col space-y-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`bg-[#2E2E38] border ${t.type === 'error' ? 'border-rose-500/50' : t.type === 'success' ? 'border-green-500/50' : 'border-[#FFE600]/30/50'} shadow-2xl rounded-2xl p-5 flex items-center space-x-5 max-w-md relative group animate-bounceIn`}
          >
            <div className={`w-12 h-12 ${t.type === 'error' ? 'bg-rose-600' : t.type === 'success' ? 'bg-green-600' : 'bg-[#FFE600]'} text-white rounded-xl flex items-center justify-center relative shrink-0`}>
              <i className={`fas ${t.type === 'error' ? 'fa-exclamation-triangle' : t.type === 'success' ? 'fa-check' : 'fa-info'}`}></i>
              <div className={`absolute inset-0 ${t.type === 'error' ? 'bg-rose-400' : t.type === 'success' ? 'bg-green-400' : 'bg-blue-400'} rounded-xl animate-ping opacity-20`}></div>
            </div>
            <div className="flex-1 min-w-0 pr-6">
              <p className={`text-[11px] font-semibold ${t.type === 'error' ? 'text-rose-400' : t.type === 'success' ? 'text-green-400' : 'text-[#FFE600]'} uppercase tracking-[0.2em] mb-1`}>
                {t.title}
              </p>
              <p className="text-sm text-slate-100 leading-snug font-medium italic overflow-y-auto max-h-32 custom-scrollbar whitespace-pre-wrap">
                {t.message}
              </p>
            </div>
            <button
              onClick={() => handleClose(t.id)}
              className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
            >
              <i className="fas fa-times text-xs"></i>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
