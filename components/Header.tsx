
import React, { useState } from 'react';
import { SalesforceOrgData, MetadataCategory, ViewType } from '../types';
import { useNotifications } from '../src/contexts/NotificationContext';

interface HeaderProps {
  orgData: SalesforceOrgData;
  searchTerm: string;
  setSearchTerm: (val: string) => void;
  activeCategory: MetadataCategory | null;
  setView: (view: ViewType) => void;
  backgroundSync: {
    isProcessing: boolean;
    total: number;
    current: number;
    category: string;
    item: string;
  };
}

const Header: React.FC<HeaderProps> = ({ orgData, searchTerm, setSearchTerm, activeCategory, setView, backgroundSync }) => {
  const { notifications, clearNotifications, removeNotification } = useNotifications();
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 z-10 shrink-0">
      <div className="relative group flex-1 max-w-md">
        <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#2E2E38] transition-colors"></i>
        <input 
          type="text" 
          placeholder={activeCategory ? `Search ${activeCategory}...` : "Global metadata search..."}
          className="pl-11 pr-4 py-2.5 bg-slate-100 border-none rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 outline-none w-full transition-all"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="flex items-center space-x-4">
        {backgroundSync.isProcessing && (
          <div className="flex items-center space-x-3 px-4 py-1.5 bg-[#FFE600]/10 border border-[#FFE600]/30 rounded-2xl animate-fadeIn">
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-semibold text-[#2E2E38] uppercase tracking-widest">AI Documentation Syncing</span>
              <span className="text-[10px] font-semibold text-slate-600 truncate max-w-[120px]">
                {backgroundSync.current} / {backgroundSync.total} - {backgroundSync.item}
              </span>
            </div>
            <div className="w-6 h-6 border-2 border-[#FFE600]/30 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}

        <div className="flex flex-col items-end border-r border-slate-200 pr-6">
          <div className="flex items-center space-x-2">
            <span className="text-[9px] font-semibold text-[#2E2E38] bg-[#FFE600]/10 px-1.5 py-0.5 rounded uppercase tracking-widest">
              {orgData.orgId}
            </span>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.2em]">Live Instance</span>
          </div>
          <span className="text-sm font-semibold text-slate-800 flex items-center truncate max-w-[200px]">
            <span className="w-2 h-2 bg-green-500 rounded-full mr-2 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
            {orgData.orgName}
          </span>
        </div>
        
        <div className="flex space-x-1.5 relative">
          <button 
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative w-10 h-10 flex items-center justify-center text-slate-400 hover:text-[#2E2E38] hover:bg-[#FFE600]/10 rounded-xl transition-all"
          >
            <i className="fas fa-bell"></i>
            {notifications.length > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full"></span>
            )}
          </button>
          
          {showNotifications && (
            <div className="absolute right-0 top-12 w-80 bg-white border border-slate-200 rounded-2xl shadow-lg z-50 p-4 max-h-96 overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-slate-800">Notifications</h3>
                <button onClick={clearNotifications} className="text-xs text-[#2E2E38] hover:underline">Clear All</button>
              </div>
              {notifications.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">No notifications</p>
              ) : (
                notifications.map(n => (
                  <div key={n.id} className="mb-3 p-3 bg-slate-50 rounded-xl border border-slate-100 relative group pr-8">
                    <button 
                      onClick={() => removeNotification(n.id)}
                      className="absolute top-2 right-2 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <i className="fas fa-times text-xs"></i>
                    </button>
                    <p className="font-semibold text-sm text-slate-800 break-words">{n.title}</p>
                    <p className="text-xs text-slate-600 break-words mt-1">{n.message}</p>
                  </div>
                ))
              )}
            </div>
          )}

          <button 
            onClick={() => setView('query-editor')}
            className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-[#2E2E38] hover:bg-[#FFE600]/10 rounded-xl transition-all"
            title="Query Editor"
          >
            <i className="fas fa-terminal"></i>
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
