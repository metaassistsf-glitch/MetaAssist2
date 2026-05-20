
import React from 'react';
import { ViewType, SalesforceUser } from '../types';
import AppLogo from './AppLogo';

interface SidebarProps {
  currentView: ViewType;
  setView: (view: ViewType) => void;
  user: SalesforceUser;
  onRetrieveMetadata: () => void;
  onLogout: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, setView, user, onRetrieveMetadata, onLogout }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-chart-line' },
    { id: 'objects', label: 'Object Explorer', icon: 'fa-cube' },
    { id: 'metadata_hub', label: "Metadata's Hub", icon: 'fa-layer-group' },
    { id: 'ai-insights', label: 'Deep Research', icon: 'fa-wand-magic-sparkles' },
    { id: 'release-notes', label: 'Release Notes', icon: 'fa-rocket' },
    { id: 'enhanced-data-loader', label: 'Enhanced Data Loader', icon: 'fa-upload' },
    { id: 'security-analysis', label: 'Security Analysis', icon: 'fa-shield-halved' },
    { id: 'debugger', label: 'Jira Debugger', icon: 'fa-bug' },
    { id: 'control-tower', label: 'Control Tower', icon: 'fa-satellite-dish' },
  ];

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  };

  return (
    <aside className="w-64 bg-[#2E2E38] h-full flex flex-col flex-shrink-0">
      <div className="p-6">
        <div className="flex items-center space-x-3 text-white">
          <AppLogo size="sm" />
          <span className="font-semibold text-[11px] tracking-tighter uppercase leading-tight">Meta<span className="text-[#FFE600]">assist</span></span>
        </div>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id as ViewType)}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${
              currentView === item.id
                ? 'bg-[#FFE600] text-[#2E2E38] shadow-xl shadow-[#FFE600]/30'
                : 'text-slate-400 hover:bg-[#2E2E38] hover:text-white'
            }`}
          >
            <i className={`fas ${item.icon} w-5 text-center text-sm`}></i>
            <span className="font-semibold text-sm tracking-tight">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="px-4 pb-4 space-y-2">
        <button 
          onClick={onRetrieveMetadata}
          className="w-full flex items-center space-x-3 px-4 py-2.5 rounded-xl bg-[#FFE600]/10 border border-[#FFE600]/20 text-[#FFE600] hover:bg-[#FFE600] hover:text-[#2E2E38] transition-all text-[10px] font-semibold uppercase tracking-widest"
        >
          <i className="fas fa-sync-alt w-5 text-center"></i>
          <span>Retrieve from the org</span>
        </button>

        <div className="flex items-center space-x-3 px-3 py-3 bg-[#2E2E38]/40 rounded-xl border border-[#2E2E38]/80">
          <div className="w-9 h-9 rounded-full bg-[#FFE600] flex items-center justify-center text-[#2E2E38] text-xs font-bold shadow-lg">
            {getInitials(user.name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate uppercase tracking-wider">{user.name}</p>
            <p className="text-[10px] text-slate-400 truncate font-medium">{user.title}</p>
          </div>
        </div>

        <button 
          onClick={onLogout}
          className="w-full flex items-center space-x-3 px-4 py-2.5 rounded-xl bg-red-600/10 border border-red-600/20 text-red-400 hover:bg-red-600 hover:text-white transition-all text-[10px] font-semibold uppercase tracking-widest"
        >
          <i className="fas fa-sign-out-alt w-5 text-center"></i>
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;