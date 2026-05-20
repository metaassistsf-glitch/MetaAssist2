
import React, { useState, useEffect, useMemo } from 'react';
import { SalesforceOrgData, SalesforceObject, SalesforceField } from '../types';
import { SalesforceService } from '../services/salesforceService';
import { useToast } from './Toast';
import { motion, AnimatePresence } from 'motion/react';

interface QueryEditorProps {
  orgData: SalesforceOrgData;
  sfService: SalesforceService | null;
}

interface FilterRow {
  id: string;
  field: string;
  operator: string;
  value: string;
}

const OPERATORS = [
  { label: 'Equals', value: '=' },
  { label: 'Not Equals', value: '!=' },
  { label: 'Contains', value: 'LIKE' },
  { label: 'Starts With', value: 'STARTS' },
  { label: 'Ends With', value: 'ENDS' },
  { label: 'Greater Than', value: '>' },
  { label: 'Less Than', value: '<' },
  { label: 'In', value: 'IN' },
  { label: 'Not In', value: 'NOT IN' },
];

const QueryEditor: React.FC<QueryEditorProps> = ({ orgData, sfService }) => {
  const { toast } = useToast();
  const [objects, setObjects] = useState<any[]>([]);
  const [isLoadingObjects, setIsLoadingObjects] = useState(false);
  const [objectSearch, setObjectSearch] = useState('');
  
  const [selectedObject, setSelectedObject] = useState<string | null>(null);
  const [objectMetadata, setObjectMetadata] = useState<any>(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  
  const [selectedFields, setSelectedFields] = useState<string[]>(['Id']);
  const [filters, setFilters] = useState<FilterRow[]>([]);
  
  const [queryResults, setQueryResults] = useState<any[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'builder' | 'results'>('builder');

  useEffect(() => {
    fetchObjects();
  }, []);

  const fetchObjects = async () => {
    if (!sfService) return;
    setIsLoadingObjects(true);
    try {
      const result = await sfService.fetchCategory('objects');
      setObjects(result);
    } catch (e: any) {
      toast({ title: 'Error', message: 'Failed to fetch objects: ' + e.message, type: 'error' });
    } finally {
      setIsLoadingObjects(false);
    }
  };

  const handleObjectSelect = async (objName: string) => {
    if (!sfService) return;
    setSelectedObject(objName);
    setIsLoadingMetadata(true);
    setSelectedFields(['Id']);
    setFilters([]);
    setQueryResults([]);
    setQueryError(null);
    
    try {
      const metadata = await sfService.fetchMetadataContent('objects', objName);
      setObjectMetadata(metadata);
    } catch (e: any) {
      toast({ title: 'Error', message: 'Failed to fetch object metadata: ' + e.message, type: 'error' });
    } finally {
      setIsLoadingMetadata(false);
    }
  };

  const filteredObjects = useMemo(() => {
    return objects.filter(obj => 
      obj.label.toLowerCase().includes(objectSearch.toLowerCase()) || 
      obj.name.toLowerCase().includes(objectSearch.toLowerCase())
    );
  }, [objects, objectSearch]);

  const toggleField = (fieldName: string) => {
    setSelectedFields(prev => 
      prev.includes(fieldName) 
        ? prev.filter(f => f !== fieldName) 
        : [...prev, fieldName]
    );
  };

  const addFilter = () => {
    setFilters(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), field: '', operator: '=', value: '' }]);
  };

  const removeFilter = (id: string) => {
    setFilters(prev => prev.filter(f => f.id !== id));
  };

  const updateFilter = (id: string, updates: Partial<FilterRow>) => {
    setFilters(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const generatedSOQL = useMemo(() => {
    if (!selectedObject) return '';
    
    const fields = selectedFields.length > 0 ? selectedFields.join(', ') : 'Id';
    let soql = `SELECT ${fields} FROM ${selectedObject}`;
    
    if (filters.length > 0) {
      const filterClauses = filters
        .filter(f => f.field && f.value !== '')
        .map(f => {
          const fieldMeta = objectMetadata?.fields?.find((fm: any) => fm.name === f.field);
          const isNumeric = ['double', 'int', 'currency', 'percent'].includes(fieldMeta?.type?.toLowerCase());
          const isBoolean = fieldMeta?.type?.toLowerCase() === 'boolean';
          
          let val = f.value;
          if (f.operator === 'STARTS') return `${f.field} LIKE '${val}%'`;
          if (f.operator === 'ENDS') return `${f.field} LIKE '%${val}'`;
          if (f.operator === 'LIKE') return `${f.field} LIKE '%${val}%'`;
          
          if (!isNumeric && !isBoolean && f.operator !== 'IN' && f.operator !== 'NOT IN') {
            val = `'${val}'`;
          }
          
          return `${f.field} ${f.operator} ${val}`;
        });
        
      if (filterClauses.length > 0) {
        soql += ` WHERE ${filterClauses.join(' AND ')}`;
      }
    }
    
    soql += ' LIMIT 100';
    return soql;
  }, [selectedObject, selectedFields, filters, objectMetadata]);

  const runQuery = async () => {
    if (!sfService || !generatedSOQL) return;
    setIsQuerying(true);
    setQueryError(null);
    setActiveTab('results');
    
    try {
      const res = await sfService.query(generatedSOQL);
      setQueryResults(res.records || []);
      if (res.records.length === 0) {
        toast({ title: 'No Results', message: 'The query returned no records.', type: 'info' });
      }
    } catch (e: any) {
      setQueryError(e.message);
      toast({ title: 'Query Failed', message: e.message, type: 'error' });
    } finally {
      setIsQuerying(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 rounded-3xl overflow-hidden border border-slate-200">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Query Editor</h1>
          <p className="text-slate-500 text-sm">Build and execute SOQL queries without code</p>
        </div>
        <div className="flex items-center space-x-3">
          <button 
            onClick={() => setActiveTab('builder')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${activeTab === 'builder' ? 'bg-[#FFE600] text-[#2E2E38] shadow-lg shadow-blue-200' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Query Builder
          </button>
          <button 
            onClick={() => setActiveTab('results')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${activeTab === 'results' ? 'bg-[#FFE600] text-[#2E2E38] shadow-lg shadow-blue-200' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Results {queryResults.length > 0 && `(${queryResults.length})`}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Object Selection */}
        <div className="w-80 border-r border-slate-200 bg-white flex flex-col">
          <div className="p-4 border-b border-slate-100">
            <div className="relative">
              <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
              <input 
                type="text" 
                placeholder="Search objects..."
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                value={objectSearch}
                onChange={(e) => setObjectSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
            {isLoadingObjects ? (
              <div className="flex flex-col items-center justify-center py-10 space-y-3">
                <div className="w-6 h-6 border-2 border-[#FFE600]/30 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-xs text-slate-400 font-medium uppercase tracking-widest">Loading Objects...</span>
              </div>
            ) : (
              filteredObjects.map(obj => (
                <button
                  key={obj.name}
                  onClick={() => handleObjectSelect(obj.name)}
                  className={`w-full text-left px-4 py-3 rounded-xl transition-all mb-1 group ${selectedObject === obj.name ? 'bg-[#FFE600]/10 text-blue-700' : 'hover:bg-slate-50 text-slate-600'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm truncate">{obj.label}</span>
                    {obj.isCustom && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase font-bold">Custom</span>}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">{obj.name}</div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto bg-slate-50/50 p-8 custom-scrollbar">
          <AnimatePresence mode="wait">
            {activeTab === 'builder' ? (
              <motion.div 
                key="builder"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-4xl mx-auto space-y-8"
              >
                {!selectedObject ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-20 h-20 bg-[#FFE600]/10 text-[#2E2E38] rounded-3xl flex items-center justify-center mb-6">
                      <i className="fas fa-database text-3xl"></i>
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 mb-2">Select an Object to Start</h2>
                    <p className="text-slate-500 max-w-xs">Choose a Salesforce object from the sidebar to begin building your query.</p>
                  </div>
                ) : (
                  <>
                    {/* Field Selection */}
                    <section className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-[#FFE600]/10 text-[#2E2E38] rounded-xl flex items-center justify-center">
                            <i className="fas fa-list-ul"></i>
                          </div>
                          <div>
                            <h3 className="font-bold text-slate-900">Select Fields</h3>
                            <p className="text-xs text-slate-500">Choose the columns you want to retrieve</p>
                          </div>
                        </div>
                        <div className="text-xs font-bold text-[#2E2E38] bg-[#FFE600]/10 px-3 py-1 rounded-full">
                          {selectedFields.length} Fields Selected
                        </div>
                      </div>

                      {isLoadingMetadata ? (
                        <div className="flex items-center space-y-2 flex-col py-10">
                          <div className="w-8 h-8 border-3 border-[#FFE600]/30 border-t-transparent rounded-full animate-spin"></div>
                          <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Fetching Fields...</span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {objectMetadata?.fields?.map((field: any) => (
                            <button
                              key={field.name}
                              onClick={() => toggleField(field.name)}
                              className={`flex items-center space-x-3 p-3 rounded-xl border transition-all text-left ${selectedFields.includes(field.name) ? 'bg-[#FFE600]/10 border-[#FFE600]/30 ring-1 ring-blue-200' : 'bg-white border-slate-100 hover:border-slate-200'}`}
                            >
                              <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${selectedFields.includes(field.name) ? 'bg-[#FFE600] border-[#FFE600] text-white' : 'border-slate-300 bg-white'}`}>
                                {selectedFields.includes(field.name) && <i className="fas fa-check text-[10px]"></i>}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-800 truncate">{field.label}</div>
                                <div className="text-[10px] text-slate-400 font-mono truncate">{field.name}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>

                    {/* Filter Section */}
                    <section className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center">
                            <i className="fas fa-filter"></i>
                          </div>
                          <div>
                            <h3 className="font-bold text-slate-900">Add Filters</h3>
                            <p className="text-xs text-slate-500">Narrow down your results with criteria</p>
                          </div>
                        </div>
                        <button 
                          onClick={addFilter}
                          className="flex items-center space-x-2 px-4 py-2 bg-[#2E2E38] text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all"
                        >
                          <i className="fas fa-plus"></i>
                          <span>Add Filter</span>
                        </button>
                      </div>

                      {filters.length === 0 ? (
                        <div className="py-10 border-2 border-dashed border-slate-100 rounded-2xl flex flex-col items-center justify-center text-slate-400">
                          <i className="fas fa-filter text-2xl mb-2 opacity-20"></i>
                          <p className="text-sm font-medium">No filters added yet</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {filters.map((filter, index) => {
                            const fieldMeta = objectMetadata?.fields?.find((f: any) => f.name === filter.field);
                            const isPicklist = fieldMeta?.type === 'picklist';
                            
                            return (
                              <div key={filter.id} className="flex items-center space-x-3 animate-fadeIn">
                                <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                                  <select 
                                    className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                    value={filter.field}
                                    onChange={(e) => updateFilter(filter.id, { field: e.target.value, value: '' })}
                                  >
                                    <option value="">Select Field...</option>
                                    {objectMetadata?.fields?.map((f: any) => (
                                      <option key={f.name} value={f.name}>{f.label} ({f.name})</option>
                                    ))}
                                  </select>
                                  
                                  <select 
                                    className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                    value={filter.operator}
                                    onChange={(e) => updateFilter(filter.id, { operator: e.target.value })}
                                  >
                                    {OPERATORS.map(op => (
                                      <option key={op.value} value={op.value}>{op.label}</option>
                                    ))}
                                  </select>

                                  {isPicklist ? (
                                    <select 
                                      className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                      value={filter.value}
                                      onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                                    >
                                      <option value="">Select Value...</option>
                                      {fieldMeta.picklistValues?.map((pv: any) => (
                                        <option key={pv.value} value={pv.value}>{pv.label}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input 
                                      type="text" 
                                      placeholder="Value..."
                                      className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                      value={filter.value}
                                      onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                                    />
                                  )}
                                </div>
                                <button 
                                  onClick={() => removeFilter(filter.id)}
                                  className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                >
                                  <i className="fas fa-trash-alt"></i>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>

                    {/* SOQL Preview & Run */}
                    <section className="bg-[#2E2E38] rounded-3xl p-8 text-white shadow-2xl">
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-white/10 text-[#FFE600] rounded-xl flex items-center justify-center">
                            <i className="fas fa-code"></i>
                          </div>
                          <div>
                            <h3 className="font-bold">SOQL Preview</h3>
                            <p className="text-xs text-white/50">Generated query based on your selections</p>
                          </div>
                        </div>
                        <button 
                          onClick={runQuery}
                          disabled={isQuerying || !selectedObject}
                          className="flex items-center space-x-2 px-6 py-3 bg-[#FFE600] text-[#2E2E38] rounded-2xl font-bold hover:bg-[#E5CF00] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-[#FFE600]/30"
                        >
                          {isQuerying ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          ) : (
                            <i className="fas fa-play"></i>
                          )}
                          <span>Execute Query</span>
                        </button>
                      </div>
                      <div className="bg-black/30 rounded-2xl p-6 font-mono text-sm text-blue-300 break-all border border-white/5">
                        {generatedSOQL || '-- Select an object to generate query --'}
                      </div>
                    </section>
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div 
                key="results"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="h-full flex flex-col"
              >
                {isQuerying ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-20">
                    <div className="w-12 h-12 border-4 border-[#FFE600]/30 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <h3 className="text-lg font-bold text-slate-900">Executing Query...</h3>
                    <p className="text-slate-500 text-sm">Fetching records from Salesforce</p>
                  </div>
                ) : queryError ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mb-4">
                      <i className="fas fa-exclamation-triangle text-2xl"></i>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">Query Error</h3>
                    <p className="text-red-600 text-sm max-w-md mt-2 bg-red-50 p-4 rounded-xl border border-red-100">{queryError}</p>
                    <button 
                      onClick={() => setActiveTab('builder')}
                      className="mt-6 px-6 py-2 bg-[#2E2E38] text-white rounded-xl font-bold hover:bg-slate-800 transition-all"
                    >
                      Back to Builder
                    </button>
                  </div>
                ) : queryResults.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center mb-4">
                      <i className="fas fa-table text-2xl"></i>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">No Results Found</h3>
                    <p className="text-slate-500 text-sm">Try adjusting your filters or selecting different fields.</p>
                    <button 
                      onClick={() => setActiveTab('builder')}
                      className="mt-6 px-6 py-2 bg-[#2E2E38] text-white rounded-xl font-bold hover:bg-slate-800 transition-all"
                    >
                      Back to Builder
                    </button>
                  </div>
                ) : (
                  <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm flex flex-col h-full">
                    <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                        Showing {queryResults.length} Records
                      </span>
                      <button 
                        onClick={() => {
                          const headers = selectedFields.join(',');
                          const rows = queryResults.map(r => selectedFields.map(f => `"${String(r[f] || '').replace(/"/g, '""')}"`).join(','));
                          const csv = [headers, ...rows].join('\n');
                          const blob = new Blob([csv], { type: 'text/csv' });
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.setAttribute('hidden', '');
                          a.setAttribute('href', url);
                          a.setAttribute('download', `${selectedObject}_results.csv`);
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                        }}
                        className="text-xs font-bold text-[#2E2E38] hover:text-blue-700 flex items-center space-x-1"
                      >
                        <i className="fas fa-download"></i>
                        <span>Export CSV</span>
                      </button>
                    </div>
                    <div className="overflow-auto flex-1 custom-scrollbar">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-white z-10">
                          <tr>
                            {selectedFields.map(field => (
                              <th key={field} className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-100 bg-white">
                                {field}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {queryResults.map((record, i) => (
                            <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                              {selectedFields.map(field => (
                                <td key={field} className="px-6 py-4 text-sm text-slate-700 font-medium">
                                  {typeof record[field] === 'object' ? JSON.stringify(record[field]) : String(record[field] ?? '')}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default QueryEditor;
