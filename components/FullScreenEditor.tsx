
import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import CodeEditor from './CodeEditor';
import { MetadataCategory } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  category: MetadataCategory;
  name: string;
  initialContent: string;
  initialLwcFiles?: { html?: string; js?: string; css?: string };
  onSave: (content: string, lwcFiles?: { html?: string; js?: string; css?: string }) => Promise<void>;
  onDeploy: (content: string, lwcFiles?: { html?: string; js?: string; css?: string }) => Promise<void>;
  getSuggestions: (content: string, lwcFiles?: { html?: string; js?: string; css?: string }, prompt?: string) => Promise<string>;
}

const FullScreenEditor: React.FC<Props> = ({ 
  isOpen, 
  onClose, 
  category, 
  name, 
  initialContent, 
  initialLwcFiles, 
  onSave, 
  onDeploy,
  getSuggestions
}) => {
  const [content, setContent] = useState(initialContent);
  const [lwcFiles, setLwcFiles] = useState(initialLwcFiles || {});
  const [activeLwcTab, setActiveLwcTab] = useState<'html' | 'js' | 'css'>('js');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');

  useEffect(() => {
    setContent(initialContent);
    setLwcFiles(initialLwcFiles || {});
  }, [initialContent, initialLwcFiles]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(content, lwcFiles);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeploy = async () => {
    if (window.confirm(`Are you sure you want to deploy ${name} to the Salesforce Org? This will overwrite the existing version.`)) {
      setIsDeploying(true);
      try {
        await onDeploy(content, lwcFiles);
      } finally {
        setIsDeploying(false);
      }
    }
  };

  const handleGetSuggestions = async () => {
    setIsSuggesting(true);
    try {
      const res = await getSuggestions(content, lwcFiles, aiPrompt);
      setSuggestions(res);
    } finally {
      setIsSuggesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-[#2E2E38] flex flex-col animate-fadeIn">
      {/* Header */}
      <div className="h-16 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-6">
        <div className="flex items-center space-x-4">
          <button 
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-slate-700 text-slate-300 flex items-center justify-center hover:bg-slate-600 transition-all"
          >
            <i className="fas fa-times"></i>
          </button>
          <div>
            <h2 className="text-white font-bold text-lg tracking-tight leading-none">{name}</h2>
            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-1">{category} Editor</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2.5 bg-[#FFE600] text-[#2E2E38] text-[10px] font-bold uppercase tracking-widest rounded-xl hover:bg-[#E5CF00] transition-all shadow-lg shadow-[#FFE600]/30 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save in Local'}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor Area (70%) */}
        <div className="w-[70%] flex flex-col border-r border-slate-700">
          {category === 'lwcs' && (
            <div className="bg-slate-800 p-2 flex space-x-1 border-b border-slate-700">
              <button 
                onClick={() => setActiveLwcTab('js')}
                className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all ${activeLwcTab === 'js' ? 'bg-slate-700 text-white shadow-inner' : 'text-slate-400 hover:text-slate-200'}`}
              >
                JavaScript
              </button>
              <button 
                onClick={() => setActiveLwcTab('html')}
                className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all ${activeLwcTab === 'html' ? 'bg-slate-700 text-white shadow-inner' : 'text-slate-400 hover:text-slate-200'}`}
              >
                HTML
              </button>
              <button 
                onClick={() => setActiveLwcTab('css')}
                className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all ${activeLwcTab === 'css' ? 'bg-slate-700 text-white shadow-inner' : 'text-slate-400 hover:text-slate-200'}`}
              >
                CSS
              </button>
            </div>
          )}
          <div className="flex-1 bg-[#1e1e1e]">
            <CodeEditor 
              code={category === 'lwcs' ? (lwcFiles[activeLwcTab] || '') : content}
              language={category === 'classes' || category === 'triggers' ? 'apex' : category === 'vfPages' || activeLwcTab === 'html' ? 'html' : 'javascript'}
              onChange={(val) => {
                if (category === 'lwcs') {
                  setLwcFiles(prev => ({ ...prev, [activeLwcTab]: val }));
                } else {
                  setContent(val || '');
                }
              }}
            />
          </div>
        </div>

        {/* AI Suggestions Area (30%) */}
        <div className="w-[30%] bg-slate-800 flex flex-col overflow-hidden">
          <div className="p-6 border-b border-slate-700">
            <div className="flex items-center space-x-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                <i className="fas fa-wand-magic-sparkles"></i>
              </div>
              <h3 className="text-white font-bold text-xs uppercase tracking-widest">AI Assistant</h3>
            </div>
            
            <div className="space-y-4">
              <textarea 
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Ask AI to refactor, debug, or explain this code..."
                className="w-full h-24 bg-[#2E2E38] border border-slate-700 rounded-xl p-4 text-slate-300 text-xs focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none custom-scrollbar"
              />
              <button 
                onClick={handleGetSuggestions}
                disabled={isSuggesting}
                className="w-full py-3 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50"
              >
                {isSuggesting ? (
                  <span className="flex items-center justify-center space-x-2">
                    <i className="fas fa-circle-notch animate-spin"></i>
                    <span>Analyzing Code...</span>
                  </span>
                ) : 'Get AI Suggestions'}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            {suggestions ? (
              <div className="prose prose-invert prose-slate max-w-none text-xs text-slate-300 leading-relaxed animate-fadeIn">
                <ReactMarkdown>{suggestions}</ReactMarkdown>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
                <i className="fas fa-robot text-4xl mb-4"></i>
                <p className="text-[10px] font-bold uppercase tracking-widest">No suggestions yet</p>
                <p className="text-[9px] mt-2 max-w-[200px]">Enter a prompt or click the button above to get AI-powered code analysis.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FullScreenEditor;
