
import React, { useState } from 'react';
import { SalesforceOrgData } from '../types';

interface LogicExplorerProps {
  orgData: SalesforceOrgData;
  searchTerm: string;
  onSyncCategory: (cat: 'flows' | 'classes') => void;
}

const LogicExplorer: React.FC<LogicExplorerProps> = ({ orgData, searchTerm, onSyncCategory }) => {
  const [activeTab, setActiveTab] = useState<'flows' | 'apex'>('flows');

  const filteredFlows = orgData.flows.filter(f => 
    (f.label || '').toLowerCase().includes((searchTerm || '').toLowerCase()) ||
    (f.name || '').toLowerCase().includes((searchTerm || '').toLowerCase())
  );

  const filteredApex = orgData.classes.filter(c => 
    (c.name || '').toLowerCase().includes((searchTerm || '').toLowerCase())
  );

  const renderEmptyState = (category: 'flows' | 'classes') => (
    <div className="p-20 text-center animate-fadeIn">
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner ${category === 'flows' ? 'bg-green-50 text-green-500' : 'bg-indigo-50 text-indigo-500'}`}>
        <i className={`fas ${category === 'flows' ? 'fa-project-diagram' : 'fa-code'} text-2xl`}></i>
      </div>
      <h3 className="text-lg font-semibold text-slate-800 capitalize">{category} not synced</h3>
      <p className="text-slate-500 text-sm mt-2 mb-6 max-w-xs mx-auto">Pull the latest {category} from your Org to analyze logic and automation coverage.</p>
      <button 
        onClick={() => onSyncCategory(category)}
        className={`px-6 py-2.5 rounded-xl text-white font-semibold text-xs shadow-lg transition-all ${category === 'flows' ? 'bg-green-600 shadow-green-200' : 'bg-indigo-600 shadow-indigo-200'}`}
      >
        Sync {category} now
      </button>
    </div>
  );

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex space-x-4 border-b border-slate-200">
        <button 
          onClick={() => setActiveTab('flows')}
          className={`pb-4 px-4 font-semibold text-sm transition-all relative ${
            activeTab === 'flows' ? 'text-[#2E2E38]' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          Flows {orgData.syncedCategories.flows ? `(${orgData.flows.length})` : ''}
          {activeTab === 'flows' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#FFE600] rounded-t-full"></div>}
        </button>
        <button 
          onClick={() => setActiveTab('apex')}
          className={`pb-4 px-4 font-semibold text-sm transition-all relative ${
            activeTab === 'apex' ? 'text-[#2E2E38]' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          Apex Classes {orgData.syncedCategories.classes ? `(${orgData.classes.length})` : ''}
          {activeTab === 'apex' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#FFE600] rounded-t-full"></div>}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">
        {activeTab === 'flows' ? (
          orgData.syncedCategories.flows ? (
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Label</th>
                  <th className="px-6 py-4 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Type</th>
                  <th className="px-6 py-4 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Version</th>
                  <th className="px-6 py-4 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredFlows.map((flow) => (
                  <tr key={flow.name} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                       <p className="text-sm font-semibold text-slate-800">{flow.label}</p>
                       <p className="text-[10px] font-mono text-slate-400">{flow.name}</p>
                    </td>
                    <td className="px-6 py-4 text-[11px] font-medium text-slate-600">{flow.type}</td>
                    {/* Accessing version safely using the updated GenericMetadata interface */}
                    <td className="px-6 py-4 text-[11px] text-slate-400">v{flow.version || '1'}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-[9px] font-semibold uppercase ${
                        flow.status === 'Active' ? 'bg-green-100 text-green-700' : 
                        flow.status === 'Inactive' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {flow.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : renderEmptyState('flows')
        ) : (
          orgData.syncedCategories.classes ? (
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Class Name</th>
                  <th className="px-6 py-4 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Size</th>
                  <th className="px-6 py-4 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredApex.map((cls) => (
                  <tr key={cls.name} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                       <p className="text-sm font-semibold text-slate-800">{cls.name}</p>
                       {/* Accessing apiVersion safely using the updated GenericMetadata interface */}
                       <p className="text-[10px] font-mono text-slate-400">v{cls.apiVersion || 'Unknown'}</p>
                    </td>
                    {/* Accessing size safely with fallback for division operation */}
                    <td className="px-6 py-4 text-xs font-medium text-slate-500">{((cls.size || 0) / 1024).toFixed(1)} KB</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-[9px] font-semibold uppercase ${
                        cls.status === 'Active' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {cls.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : renderEmptyState('classes')
        )}
      </div>
    </div>
  );
};

export default LogicExplorer;
