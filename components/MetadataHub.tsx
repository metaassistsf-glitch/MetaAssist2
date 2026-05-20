
import React from 'react';
import { useToast } from './Toast';
import { SalesforceOrgData, MetadataCategory } from '../types';
import MetadataExplorer from './MetadataExplorer';
import { SalesforceService } from '../services/salesforceService';

interface MetadataHubProps {
  orgData: SalesforceOrgData;
  onSyncCategory: (cat: MetadataCategory) => void;
  onSyncAllInCategory: (cat: MetadataCategory) => void;
  activeCategory: MetadataCategory | null;
  setActiveCategory: (cat: MetadataCategory | null) => void;
  searchTerm: string;
  sfService: SalesforceService | null;
  onOrgDataUpdate: (data: SalesforceOrgData | ((prev: SalesforceOrgData | null) => SalesforceOrgData | null)) => void;
}

const MetadataHub: React.FC<MetadataHubProps> = ({ 
  orgData, onSyncCategory, onSyncAllInCategory, activeCategory, setActiveCategory, searchTerm, sfService, onOrgDataUpdate 
}) => {
  const { toast } = useToast();
  const categories: { id: MetadataCategory; label: string; icon: string; color: string }[] = [
    { id: 'dashboards', label: 'Dashboards', icon: 'fa-gauge-high', color: 'rose' },
    { id: 'classes', label: 'Apex Classes', icon: 'fa-code', color: 'blue' },
    { id: 'triggers', label: 'Apex Triggers', icon: 'fa-bolt', color: 'orange' },
    { id: 'flows', label: 'Flows', icon: 'fa-project-diagram', color: 'green' },
    { id: 'processBuilders', label: 'Process Builders', icon: 'fa-diagram-project', color: 'teal' },
    { id: 'lwcs', label: 'LWC Components', icon: 'fa-microchip', color: 'indigo' },
    { id: 'vfPages', label: 'Visualforce Pages', icon: 'fa-file-code', color: 'sky' },
    { id: 'customMetadata', label: 'Custom Metadata', icon: 'fa-table-list', color: 'cyan' },
    { id: 'validationRules', label: 'Validation Rules', icon: 'fa-shield-check', color: 'rose' },
    { id: 'flexiPages', label: 'FlexiPages (App Builder)', icon: 'fa-window-maximize', color: 'amber' },
    { id: 'permissionSets', label: 'Permission Sets', icon: 'fa-shield-halved', color: 'purple' },
    { id: 'profiles', label: 'Security Profiles', icon: 'fa-user-lock', color: 'pink' },
    { id: 'layouts', label: 'Page Layouts', icon: 'fa-columns', color: 'amber' },
    { id: 'recordTypes', label: 'Record Types', icon: 'fa-tags', color: 'emerald' },
    { id: 'tabs', label: 'Custom Tabs', icon: 'fa-folder-plus', color: 'blue' },
    { id: 'emailTemplates', label: 'Email Templates', icon: 'fa-envelope-open-text', color: 'violet' },
    { id: 'labels', label: 'Custom Labels', icon: 'fa-language', color: 'fuchsia' },
    { id: 'staticResources', label: 'Static Resources', icon: 'fa-file-archive', color: 'slate' },
    { id: 'workflowRules', label: 'Workflow Rules', icon: 'fa-gears', color: 'red' },
    { id: 'quickActions', label: 'Quick Actions', icon: 'fa-hand-pointer', color: 'rose' },
    { id: 'buttons', label: 'Custom Buttons', icon: 'fa-square-plus', color: 'blue' },
    { id: 'compactLayouts', label: 'Compact Layouts', icon: 'fa-compress', color: 'teal' },
    { id: 'sharingSettings', label: 'Sharing Settings', icon: 'fa-share-nodes', color: 'orange' },
    { id: 'licenses', label: 'Org Licenses', icon: 'fa-id-card', color: 'blue' },
    { id: 'objectLimits', label: 'Object Limits', icon: 'fa-chart-pie', color: 'rose' },
    { id: 'approvalProcesses', label: 'Approval Processes', icon: 'fa-stamp', color: 'emerald' }
  ];

  if (activeCategory) {
    return (
      <div className="h-full flex flex-col animate-fadeIn">
        <div className="flex items-center space-x-4 mb-6">
          <button 
            onClick={() => setActiveCategory(null)}
            className="w-10 h-10 flex items-center justify-center bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-[#2E2E38] hover:border-[#FFE600]/30 transition-all shadow-sm"
          >
            <i className="fas fa-arrow-left text-sm"></i>
          </button>
          <div className="flex flex-col">
            <h2 className="text-xl font-semibold text-slate-800 capitalize">{activeCategory.replace(/([A-Z])/g, ' $1').trim()}</h2>
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest">Metadata Explorer</p>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <MetadataExplorer 
            category={activeCategory}
            orgData={orgData} 
            searchTerm={searchTerm} 
            sfService={sfService}
            onOrgDataUpdate={onOrgDataUpdate}
            onSyncAll={() => onSyncAllInCategory(activeCategory)}
            toast={{
              success: (msg) => toast({ title: 'Success', message: msg, type: 'success' }),
              error: (msg) => toast({ title: 'Error', message: msg, type: 'error' }),
              info: (msg) => toast({ title: 'Info', message: msg, type: 'info' })
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="flex flex-col">
        <h2 className="text-2xl font-semibold text-slate-800">Metadata Hub</h2>
        <p className="text-slate-500 font-medium">Select a category to pull live metadata for auditing and exploration.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => onSyncCategory(cat.id)}
            className={`group bg-white p-6 rounded-3xl border border-slate-200 shadow-sm transition-all hover:scale-[1.03] hover:shadow-xl text-left flex flex-col relative overflow-hidden ${orgData.syncedCategories[cat.id] ? 'ring-2 ring-green-500/20 border-green-200' : ''}`}
          >
            <div className={`w-12 h-12 bg-${cat.color}-50 text-${cat.color}-600 rounded-2xl flex items-center justify-center mb-6 shadow-inner transition-colors group-hover:bg-${cat.color}-600 group-hover:text-white`}>
              <i className={`fas ${cat.icon} text-xl`}></i>
            </div>
            
            <h3 className="font-semibold text-slate-800 text-sm mb-1">{cat.label}</h3>
            
            {orgData.syncedCategories[cat.id] ? (
              <div className="flex items-center space-x-1.5 text-green-600">
                <i className="fas fa-check-circle text-[10px]"></i>
                <span className="text-[10px] font-semibold uppercase tracking-widest">Synced</span>
              </div>
            ) : (
              <div className="flex items-center space-x-1.5 text-slate-400">
                <i className="fas fa-cloud-download-alt text-[10px]"></i>
                <span className="text-[10px] font-semibold uppercase tracking-widest">Pull Data</span>
              </div>
            )}

            <div className="absolute -right-2 -bottom-2 opacity-[0.03] transform rotate-12 transition-transform group-hover:scale-110">
              <i className={`fas ${cat.icon} text-6xl`}></i>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default MetadataHub;
