
import React from 'react';

interface ProjectManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

const ProjectManager: React.FC<ProjectManagerProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] bg-[#2E2E38]/80 backdrop-blur-sm flex items-center justify-center p-6 animate-fadeIn">
      <div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[80vh]">
        <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-[#FFE600] text-[#2E2E38] rounded-2xl flex items-center justify-center shadow-xl shadow-[#FFE600]/30">
              <i className="fas fa-folder-open text-xl"></i>
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-slate-900 tracking-tight uppercase italic">Project Manager</h2>
              <p className="text-slate-500 font-medium text-xs uppercase tracking-widest">Manage your metadata projects and migrations</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-400 flex items-center justify-center hover:text-[#2E2E38] hover:border-[#FFE600]/30 transition-all shadow-sm"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-12 flex flex-col items-center justify-center text-center space-y-6">
          <div className="w-24 h-24 bg-[#FFE600]/10 rounded-full flex items-center justify-center text-[#2E2E38] mb-4">
            <i className="fas fa-tools text-4xl opacity-20"></i>
          </div>
          <h3 className="text-xl font-semibold text-slate-800">Project Management Module</h3>
          <p className="text-slate-500 max-w-md mx-auto leading-relaxed">
            This module is currently under development. Soon you will be able to create metadata projects, track changes, and manage deployments across multiple environments.
          </p>
          <div className="flex space-x-4 mt-8">
            <button 
              onClick={onClose}
              className="px-8 py-3 bg-[#2E2E38] text-white font-semibold rounded-2xl text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/20"
            >
              Close Manager
            </button>
          </div>
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 text-center">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.2em]">Metaassist • v1.0.0-beta</p>
        </div>
      </div>
    </div>
  );
};

export default ProjectManager;
