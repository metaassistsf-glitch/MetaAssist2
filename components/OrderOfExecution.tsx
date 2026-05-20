import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'framer-motion';
import MermaidRenderer from './MermaidRenderer';
import { getValidationRuleDetails, getFormulaFromContent } from '../src/utils/metadataUtils';

interface OrderOfExecutionProps {
  automations: any[];
  summaries: Record<string, string>;
}

const OrderOfExecution: React.FC<OrderOfExecutionProps> = ({ automations, summaries }) => {
  const [expandedNodes, setExpandedNodes] = useState<Record<number, boolean>>({});
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  const toggleNode = (step: number) => {
    setExpandedNodes(prev => ({ ...prev, [step]: !prev[step] }));
  };

  const isActive = (item: any) => {
    // Priority order for status detection:
    // 1. Explicit Status field (Flows/Rules)
    // 2. Active boolean-like string/bool
    // 3. Process status properties
    const activeVal = item.Status || item.status || item.Active || item.active;
    
    if (activeVal === true) return true;
    if (typeof activeVal === 'string') {
      const lower = activeVal.toLowerCase();
      return lower === 'active' || lower === 'true';
    }
    return false;
  };

  const isManaged = (item: any) => {
    return item.ManageableState === 'installed' || item.ManageableState === 'beta' || (item.NamespacePrefix && item.NamespacePrefix !== '');
  };

  const getBriefDescription = (id: string) => {
    let fullText = summaries[id];
    if (!fullText) return null;
    
    // Strip markdown headers and clean up
    const cleanText = fullText
      .replace(/###?\s*High-Level Summary/gi, '')
      .replace(/##\s*Conclusion[\s\S]*?(?=##|$)/gi, '')
      .replace(/Not Applicable\.?/gi, '')
      .trim();

    const lines = cleanText.split('\n').filter(l => l.trim().length > 0);
    const brief = lines.slice(0, 3).join(' ');
    return brief.length > 200 ? brief.substring(0, 200) + '...' : brief;
  };

  // Define the detailed order of execution steps
  const steps = [
    { id: 1, name: 'System Validations', description: 'Checks required fields and format.' },
    { id: 2, name: 'Before-Save Flows', description: 'Optimized for fast field updates.' },
    { id: 3, name: 'Before Triggers', description: 'Apex logic before save.' },
    { id: 4, name: 'Custom Validation Rules', description: 'Evaluates custom validation conditions.' },
    { id: 5, name: 'Duplicate Rules', description: 'Checks for record duplication.' },
    { id: 6, name: 'Saves Record (Not Committed)', description: 'Saves to DB but transaction remains open.' },
    { id: 7, name: 'After Triggers', description: 'Apex logic after save with ID.' },
    { id: 8, name: 'Assignment Rules', description: 'Assigns owners for leads/cases.' },
    { id: 9, name: 'Auto-Response Rules', description: 'Sends automated response emails.' },
    { id: 10, name: 'Workflow Rules', description: 'Executes legacy workflow logic (can trigger loops!).' },
    { id: 11, name: 'Escalation Rules', description: 'Escalates cases.' },
    { id: 12, name: 'After-Save Flows & Processes', description: 'Executes related record updates & actions.' },
    { id: 13, name: 'Entitlement Rules', description: 'Checks SLA/Entitlements.' },
    { id: 14, name: 'Commits DML', description: 'Finalizes the transaction.' },
  ];

  // Categorize automations into corresponding steps
  const categorizeAutomations = () => {
    const buckets: Record<number, any[]> = {};
    steps.forEach(step => buckets[step.id] = []);

    automations?.forEach(item => {
      const content = item.content || '';
      if (item.type === 'Validation Rule') {
        buckets[4].push(item);
      } else if (item.type === 'Workflow') {
        buckets[10].push(item);
      } else if (item.type === 'Record-Triggered Flow') {
         // Attempt to distinguish before vs after flow via content string match
         if (content.includes('<triggerType>RecordBeforeSave</triggerType>') || content.includes('_FastFieldUpdate')) {
            buckets[2].push(item);
         } else {
            buckets[12].push(item);
         }
      } else if (item.type === 'Trigger') {
         if (content.includes('before insert') || content.includes('before update') || content.includes('before delete')) {
           buckets[3].push(item);
         } 
         if (content.includes('after insert') || content.includes('after update') || content.includes('after delete') || (!content.includes('before') && !content.includes('after'))) {
           buckets[7].push(item); 
         }
      } else if (item.type === 'Process Builder' || item.type === 'Flow') {
        buckets[12].push(item);
      } else if (item.type === 'Approval Process') {
        buckets[12].push(item);
      }
    });

    return buckets;
  };

  const buckets = categorizeAutomations();

  return (
    <div className="animate-fadeIn py-2 max-w-4xl relative">
      <div className="flex flex-col space-y-4 relative">
        <div className="absolute left-[39px] top-6 bottom-6 w-0.5 bg-slate-200/60 z-0"></div>
        {steps.map(step => {
          const items = buckets[step.id];
          const hasItems = items && items.length > 0;
          const isExpanded = expandedNodes[step.id];

          return (
            <div key={step.id} className="relative z-10">
              <button 
                onClick={() => hasItems && toggleNode(step.id)}
                className={`w-full flex items-center justify-between p-4 rounded-[20px] transition-all duration-300 ${
                  hasItems 
                    ? 'bg-white border-2 border-indigo-100 shadow-lg shadow-indigo-500/5 hover:-translate-y-0.5 hover:shadow-xl cursor-pointer group' 
                    : 'bg-transparent border border-slate-100 shadow-none opacity-50 cursor-default'
                }`}
              >
                <div className="flex items-center space-x-6">
                  <div className={`w-12 h-12 flex-shrink-0 flex items-center justify-center rounded-2xl font-black text-lg transition-colors ${
                    hasItems ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {step.id}
                  </div>
                  <div className="text-left">
                    <h4 className={`font-bold text-base ${hasItems ? 'text-slate-900 group-hover:text-indigo-600 transition-colors' : 'text-slate-600'} tracking-tight`}>
                      {step.name}
                    </h4>
                    <p className={`text-[11px] font-medium mt-0.5 ${hasItems ? 'text-slate-500' : 'text-slate-400'}`}>{step.description}</p>
                    {hasItems && (
                      <div className="inline-flex items-center px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-md text-[10px] font-bold uppercase tracking-widest mt-2 border border-indigo-100">
                        {items.length} {items.length === 1 ? 'Component' : 'Components'}
                      </div>
                    )}
                  </div>
                </div>
                {hasItems && (
                  <div className={`w-8 h-8 flex items-center justify-center rounded-full bg-slate-50 text-slate-400 transition-all ${isExpanded ? 'bg-indigo-100 text-indigo-600 shadow-sm rotate-180' : 'group-hover:bg-slate-100'}`}>
                    <i className="fas fa-chevron-down text-xs"></i>
                  </div>
                )}
              </button>

              {hasItems && isExpanded && (
                <div className="ml-[39px] pl-10 mt-4 mb-8 space-y-4 animate-fadeIn">
                   {items.map((item: any, idx: number) => {
                      const managed = isManaged(item);
                      return (
                        <div 
                          key={item.id || item.Id || item.name || `automation-${step.id}-${idx}`} 
                          onClick={() => setSelectedItem(item)}
                          className="p-6 bg-white border border-slate-200/60 rounded-[24px] shadow-sm hover:border-indigo-400 hover:shadow-md transition-all cursor-pointer group/item"
                        >
                          <div className="flex items-center justify-between mb-5 border-b border-slate-100 pb-5">
                            <div className="flex items-center space-x-4">
                              <div className="w-12 h-12 bg-indigo-50/80 text-indigo-600 rounded-2xl flex items-center justify-center shadow-sm border border-indigo-100/50 group-hover/item:bg-indigo-600 group-hover/item:text-white transition-colors">
                                <i className={`fas ${
                                  item.type === 'Trigger' ? 'fa-bolt text-amber-500' : 
                                  item.type === 'Record-Triggered Flow' ? 'fa-wind text-sky-500' : 
                                  item.type === 'Approval Process' ? 'fa-stamp text-emerald-500' : 
                                  item.type === 'Validation Rule' ? 'fa-shield-halved text-rose-500' : 
                                  'fa-robot text-indigo-500'
                                } text-lg group-hover/item:text-white`}></i>
                              </div>
                              <div>
                                <div className="flex items-center space-x-2">
                                  <p className="font-bold text-slate-800 text-base">{item.label || item.MasterLabel || item.name}</p>
                                  {managed && (
                                    <span className="px-1.5 py-0.5 bg-amber-50 text-amber-600 border border-amber-100 text-[9px] font-black uppercase rounded shadow-sm">
                                      Managed Package
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center space-x-2 mt-1">
                                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{item.type}</p>
                                  <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                                  <p className="text-[10px] text-slate-400 font-mono tracking-tight">{item.id?.substring(0, 15) || 'Metadata'}</p>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center space-x-3">
                              <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest ${isActive(item) ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-slate-50 text-slate-500 border border-slate-200'}`}>
                                {isActive(item) ? 'Active' : 'Inactive'}
                              </span>
                              <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover/item:bg-indigo-50 group-hover/item:text-indigo-600 transition-colors">
                                <i className="fas fa-arrow-right text-xs"></i>
                              </div>
                            </div>
                          </div>

                          <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 group-hover/item:bg-indigo-50/30 transition-all flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <i className="fas fa-lightbulb text-amber-500 text-sm"></i>
                              <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">Logic Insight Available</span>
                            </div>
                            <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center">
                              View Detailed Explanation <i className="fas fa-chevron-right ml-1 text-[8px]"></i>
                            </span>
                          </div>
                        </div>
                      );
                   })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedItem && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 md:p-8 overflow-hidden">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedItem(null)}
              className="absolute inset-0 bg-[#2E2E38]/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 30 }}
              className="relative w-full max-w-5xl max-h-[95vh] bg-white rounded-[32px] sm:rounded-[48px] shadow-2xl overflow-hidden flex flex-col border border-white/20"
            >
              {/* Header */}
              <div className="px-6 py-6 sm:px-10 sm:py-8 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-white sticky top-0 z-20">
                <div className="flex items-center space-x-4 sm:space-x-6 min-w-0">
                  <div className={`w-12 h-12 sm:w-16 sm:h-16 flex-shrink-0 flex items-center justify-center rounded-2xl sm:rounded-3xl shadow-xl transition-all ${
                    selectedItem.type === 'Trigger' ? 'bg-amber-500 shadow-amber-200 text-white' : 
                    selectedItem.type === 'Record-Triggered Flow' ? 'bg-sky-500 shadow-sky-200 text-white' : 
                    selectedItem.type === 'Approval Process' ? 'bg-emerald-500 shadow-emerald-200 text-white' : 
                    selectedItem.type === 'Validation Rule' ? 'bg-rose-500 shadow-rose-200 text-white' : 
                    'bg-indigo-600 shadow-indigo-200 text-white'
                  }`}>
                    <i className={`fas ${
                      selectedItem.type === 'Trigger' ? 'fa-bolt' : 
                      selectedItem.type === 'Record-Triggered Flow' ? 'fa-wind' : 
                      selectedItem.type === 'Approval Process' ? 'fa-stamp' : 
                      selectedItem.type === 'Validation Rule' ? 'fa-shield-halved' : 
                      'fa-robot'
                    } text-xl sm:text-2xl`}></i>
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl sm:text-3xl font-black text-slate-900 tracking-tight truncate leading-tight">
                      {selectedItem.label || selectedItem.MasterLabel || selectedItem.name}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1.5 sm:mt-2">
                      <span className={`text-[10px] sm:text-xs font-black uppercase tracking-widest px-2.5 py-1 rounded-full border ${
                         selectedItem.type === 'Trigger' ? 'bg-amber-50 text-amber-600 border-amber-100' : 
                         selectedItem.type === 'Validation Rule' ? 'bg-rose-50 text-rose-600 border-rose-100' :
                         'bg-indigo-50 text-indigo-600 border-indigo-100'
                      }`}>
                        {selectedItem.type}
                      </span>
                      <span className="w-1 h-1 rounded-full bg-slate-300 hidden sm:block"></span>
                      <span className="text-[10px] sm:text-xs font-mono font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                        {selectedItem.id || 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedItem(null)}
                  className="w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-rose-50 hover:text-rose-500 hover:rotate-90 transition-all duration-300 border border-slate-100"
                >
                  <i className="fas fa-times text-base sm:text-lg"></i>
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6 sm:p-10 bg-slate-50/50 custom-scrollbar relative">
                <div className="space-y-8 sm:space-y-10 max-w-5xl mx-auto">
                    {/* Specialized Content Section */}
                    {(() => {
                      if (selectedItem.type === 'Validation Rule') {
                        const vrDetails = getValidationRuleDetails(selectedItem.content);
                        const formula = selectedItem.validationformula || selectedItem.ErrorConditionFormula || vrDetails?.errorConditionFormula || getFormulaFromContent(selectedItem.content);
                        const active = selectedItem.Active !== undefined ? selectedItem.Active : (selectedItem.active !== undefined ? selectedItem.active : vrDetails?.active);
                        const errorMessage = selectedItem.errormessage || selectedItem.ErrorMessage || selectedItem.errorMessage || vrDetails?.errorMessage;
                        
                        return (
                          <div className="space-y-6 animate-slideUp">
                             <section className="bg-white p-6 sm:p-8 rounded-[32px] border border-slate-100 shadow-xl shadow-slate-200/50">
                               <div className="flex items-center justify-between mb-8">
                                 <div className="flex items-center space-x-3">
                                   <div className="w-10 h-10 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600 shadow-sm border border-rose-100/50">
                                     <i className="fas fa-shield-halved text-sm"></i>
                                   </div>
                                   <h3 className="text-xl font-black text-slate-800 tracking-tight">Validation Governance</h3>
                                 </div>
                                 <div className="flex items-center space-x-2.5 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-100">
                                   <span className={`w-2.5 h-2.5 rounded-full ${isActive(selectedItem) ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`}></span>
                                   <span className={`text-[10px] font-black uppercase tracking-widest ${isActive(selectedItem) ? 'text-emerald-600' : 'text-red-600'}`}>
                                     {isActive(selectedItem) ? 'Active Path' : 'Blocked Path'}
                                   </span>
                                 </div>
                               </div>
                               
                               <div className="space-y-6">
                                 <div>
                                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Primary Warning message</p>
                                   <div className="p-6 bg-rose-50/20 border border-rose-100/50 rounded-3xl relative overflow-hidden">
                                     <div className="absolute top-0 left-0 w-1 h-full bg-rose-500"></div>
                                     <p className="text-base font-bold text-rose-900 leading-snug">{errorMessage || 'No error message defined in metadata.'}</p>
                                   </div>
                                 </div>
                                 
                                 <div>
                                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Logic Pattern (Formula)</p>
                                   <div className="relative group/code">
                                     <div className="text-xs sm:text-sm font-mono text-indigo-100 bg-[#2E2E38] p-8 rounded-[32px] whitespace-pre-wrap break-all leading-relaxed border border-slate-800 shadow-2xl">
                                       {formula || 'Logic definition not found.'}
                                     </div>
                                     <button 
                                        onClick={() => navigator.clipboard.writeText(formula || '')}
                                        className="absolute top-4 right-4 p-3 bg-white/5 text-white/40 hover:bg-indigo-500 hover:text-white rounded-xl transition-all border border-white/10 opacity-0 group-hover/code:opacity-100 shadow-lg"
                                        title="Copy Logic"
                                     >
                                       <i className="fas fa-copy text-xs"></i>
                                     </button>
                                   </div>
                                 </div>
                               </div>
                             </section>
                          </div>
                        );
                      }
                      
                      if (selectedItem.type === 'Trigger' && selectedItem.content) {
                        return (
                          <div className="space-y-6 animate-slideUp">
                            <section className="bg-white p-6 sm:p-8 rounded-[32px] border border-slate-100 shadow-xl shadow-slate-200/50">
                              <div className="flex items-center space-x-3 mb-8">
                                <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600 shadow-sm border border-amber-100/50">
                                  <i className="fas fa-code text-sm"></i>
                                </div>
                                <h3 className="text-xl font-black text-slate-800 tracking-tight">Technical Implementation</h3>
                              </div>
                              <div className="relative group/code">
                                <pre className="text-xs sm:text-sm font-mono text-amber-50 bg-[#2E2E38] p-8 rounded-[32px] overflow-x-auto custom-scrollbar leading-relaxed border border-slate-800 shadow-2xl">
                                  {selectedItem.content}
                                </pre>
                                <button 
                                  onClick={() => navigator.clipboard.writeText(selectedItem.content || '')}
                                  className="absolute top-4 right-4 p-3 bg-white/5 text-white/20 hover:bg-amber-500 hover:text-white rounded-xl transition-all border border-white/5 opacity-0 group-hover/code:opacity-100 shadow-lg"
                                  title="Copy Code"
                                >
                                  <i className="fas fa-copy text-xs"></i>
                                </button>
                              </div>
                            </section>
                          </div>
                        );
                      }

                      return null;
                    })()}

                    {/* AI Analysis Section */}
                    {summaries[selectedItem.id] && !isManaged(selectedItem) && (
                      <section className="bg-white p-6 sm:p-8 rounded-[32px] border border-slate-100 shadow-xl shadow-slate-200/50 animate-slideUp" style={{ animationDelay: '0.1s' }}>
                        <div className="flex items-center space-x-3 mb-8">
                          <div className="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 shadow-sm border border-indigo-100/50">
                            <i className="fas fa-brain-circuit text-sm"></i>
                          </div>
                          <h3 className="text-xl font-black text-slate-800 tracking-tight">
                            {selectedItem.type === 'Validation Rule' ? 'Formula Explanation' : 'Intelligence Audit'}
                          </h3>
                        </div>
                        <div className="markdown-body prose max-w-none text-slate-600 font-medium leading-relaxed prose-slate prose-p:text-slate-600 prose-strong:text-slate-900 prose-headings:text-slate-900 prose-headings:font-black">
                          <ReactMarkdown>
                            {(() => {
                              let text = summaries[selectedItem.id];
                              
                              // Uniform cleaning for all types in the detail view
                              text = text
                                .replace(/###?\s*High-Level Summary/gi, '')
                                .replace(/##\s*Conclusion[\s\S]*?(?=##|$)/gi, '')
                                .replace(/Not Applicable\.?/gi, '');

                              if (selectedItem.type === 'Validation Rule') {
                                // Strictly strip unwanted technical headers for Validation Rules
                                text = text
                                  .replace(/##\s*Code Analysis[\s\S]*?(?=##|$)/gi, '')
                                  .replace(/##\s*Flow Logic[\s\S]*?(?=##|$)/gi, '')
                                  .replace(/##\s*Permission Set Analysis[\s\S]*?(?=##|$)/gi, '');
                              }

                              return text.trim();
                            })()}
                          </ReactMarkdown>
                        </div>
                      </section>
                    )}

                    {isManaged(selectedItem) && (
                      <section className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
                        <div className="p-8 bg-amber-50/50 rounded-[28px] border border-amber-100 flex items-start space-x-5">
                          <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center text-amber-600 shadow-inner">
                            <i className="fas fa-lock text-lg"></i>
                          </div>
                          <div>
                            <p className="text-lg font-black text-amber-900">Encapsulated Component</p>
                            <p className="text-sm text-amber-800 mt-2 leading-relaxed font-medium">
                              This component is part of a <strong>Managed Package</strong>. The internal logic and source code are protected by Salesforce IP encapsulation policies and cannot be introspected.
                            </p>
                          </div>
                        </div>
                      </section>
                    )}

                    {!isManaged(selectedItem) && selectedItem.mermaidCode && (
                       <section className="bg-white p-6 sm:p-8 rounded-[32px] border border-slate-100 shadow-xl shadow-slate-200/50 animate-slideUp" style={{ animationDelay: '0.2s' }}>
                        <div className="flex items-center space-x-3 mb-8">
                          <div className="w-10 h-10 rounded-2xl bg-sky-50 flex items-center justify-center text-sky-600 shadow-sm border border-sky-100/50">
                            <i className="fas fa-project-diagram text-sm"></i>
                          </div>
                          <h3 className="text-xl font-black text-slate-800 tracking-tight">Logic Flow Architecture</h3>
                        </div>
                        <div className="bg-slate-50/80 rounded-[32px] p-8 border border-slate-100 shadow-inner overflow-hidden">
                          <MermaidRenderer chart={selectedItem.mermaidCode} />
                        </div>
                      </section>
                    )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OrderOfExecution;
