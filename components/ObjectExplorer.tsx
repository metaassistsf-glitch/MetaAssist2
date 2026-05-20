import React, { useState, useMemo, useEffect, useRef } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { auth } from '../firebase';
import { useNotifications } from '../src/contexts/NotificationContext';
import { SalesforceOrgData, SalesforceObject, MetadataCategory } from '../types';
import { SalesforceService } from '../services/salesforceService';
import { explainMetadata, getFieldUsageSummary, getAutomationSummary, analyzeValidationRuleMerge } from '../services/geminiService';
import { getFieldsFromContent, findUsageSnippets, calculateMatchPercentage, getFormulaFromContent, getValidationRuleDetails } from '../src/utils/metadataUtils';
import MermaidRenderer from './MermaidRenderer';
import ReactMarkdown from 'react-markdown';
import OrderOfExecution from './OrderOfExecution';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

// Object Explorer Component
interface ObjectExplorerProps {
  orgData: SalesforceOrgData;
  searchTerm: string;
  sfService: SalesforceService | null;
  onOrgDataUpdate: (data: SalesforceOrgData | ((prev: SalesforceOrgData | null) => SalesforceOrgData | null)) => void;
  onSyncCategory: () => void;
  onNavigateToMetadata?: (category: MetadataCategory, name: string) => void;
}

type ViewMode = 'list' | 'tiles' | 'tileDetail' | 'fieldDetail' | 'dependencies' | 'assignments' | 'actionDetail' | 'layoutDetail' | 'flexiPageDetail';

const ObjectExplorer: React.FC<ObjectExplorerProps> = ({ 
  orgData, 
  searchTerm, 
  sfService, 
  onOrgDataUpdate, 
  onSyncCategory,
  onNavigateToMetadata
}) => {
  const [selectedObjectName, setSelectedObjectName] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedTile, setSelectedTile] = useState<string | null>(null);
  const [selectedField, setSelectedField] = useState<any | null>(null);
  const [selectedAction, setSelectedAction] = useState<any | null>(null);
  const [actionActiveTab, setActionActiveTab] = useState<'summary' | 'diagram'>('summary');
  const [selectedLayout, setSelectedLayout] = useState<any | null>(null);
  const [selectedFlexiPage, setSelectedFlexiPage] = useState<any | null>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const [isFetchingFields, setIsFetchingFields] = useState(false);
  const [isRetrievingMetadata, setIsRetrievingMetadata] = useState(false);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isLoadingObject, setIsLoadingObject] = useState(false);
  const [mergeAnalyses, setMergeAnalyses] = useState<Record<string, { canMerge: boolean, mergedFormula: string | null, mergedErrorMessage: string | null, reasoning: string, loading: boolean }>>({});
  const [scanResults, setScanResults] = useState<any[]>([]);
  const [fieldUsageSummary, setFieldUsageSummary] = useState<string | null>(null);
  const [automationSummaries, setAutomationSummaries] = useState<Record<string, string>>({});
  const [persistedSimilarities, setPersistedSimilarities] = useState<any[]>([]);
  const [isFetchingSimilarities, setIsFetchingSimilarities] = useState(false);
  const [failedMetadata, setFailedMetadata] = useState<Set<string>>(new Set());
  const [fieldRecordCount, setFieldRecordCount] = useState<number | null>(null);
  const [totalRecordCount, setTotalRecordCount] = useState<number | null>(null);
  const [createdDate, setCreatedDate] = useState<string | null>(null);
  const [similarFields, setSimilarFields] = useState<any[]>([]);
  const [fieldSearchTerm, setFieldSearchTerm] = useState('');
  const [permissionsSearchTerm, setPermissionsSearchTerm] = useState('');
  const { addNotification } = useNotifications();

  useEffect(() => {
    setActionActiveTab('summary');
  }, [selectedAction]);

  const filteredObjects = orgData.objects.filter(obj => 
    (obj.label || '').toLowerCase().includes((searchTerm || '').toLowerCase()) || 
    (obj.name || '').toLowerCase().includes((searchTerm || '').toLowerCase())
  );

  const selectedObject = orgData.objects.find(o => o.name === selectedObjectName) || null;

  useEffect(() => {
    if (selectedTile === 'automation' && selectedObject?.relatedMetadata?.automation) {
      const itemsToProcess = selectedObject.relatedMetadata.automation.filter(
        (item: any) => !automationSummaries[item.id] && !item.explanation
      );

      // Always load existing explanations into state immediately
      const existing: Record<string, string> = {};
      selectedObject.relatedMetadata.automation.forEach((item: any) => {
        if (item.explanation && !automationSummaries[item.id]) {
          existing[item.id] = item.explanation;
        }
      });
      if (Object.keys(existing).length > 0) {
        setAutomationSummaries(prev => ({ ...prev, ...existing }));
      }

      if (itemsToProcess.length > 0) {
        const processItems = async () => {
          const newSummaries: Record<string, string> = {};
          const updatedItems: any[] = [];

          for (const item of itemsToProcess) {
            try {
              let content = item.content;
              let cat: MetadataCategory = 'workflowRules';
              if (item.type === 'Trigger') cat = 'triggers';
              else if (item.type === 'Approval Process') cat = 'approvalProcesses';
              else if (item.type === 'Flow' || item.type === 'Process Builder' || item.type === 'Record-Triggered Flow') cat = 'flows';
              else if (item.type === 'Validation Rule') cat = 'validationRules';

              if (!content && sfService) {
                const res = await sfService.fetchMetadataContent(cat, item.id);
                content = res.content;
              }
              const apiRes = await explainMetadata(cat, item.name, content || '');
              
              // Incrementally update UI
              setAutomationSummaries(prev => ({ ...prev, [item.id]: apiRes.explanation }));
              
              newSummaries[item.id] = apiRes.explanation;
              updatedItems.push({ ...item, explanation: apiRes.explanation, mermaidCode: apiRes.mermaidCode, content });
            } catch (e) {
              console.warn("Failed to get automation summary", e);
              // Set missing summary so it stops spinning
              setAutomationSummaries(prev => ({ ...prev, [item.id]: "Failed to generate summary." }));
              newSummaries[item.id] = "Failed to generate summary.";
            }
          }

          if (Object.keys(newSummaries).length > 0) {
            // UI already updated incrementally, just do the DB side and org data
            
            const finalAutomations = selectedObject.relatedMetadata.automation.map((item: any) => {
               const updated = updatedItems.find(u => u.id === item.id);
               return updated ? updated : item;
            });
            
            // Store all updated items in one call
            await fetch(`/api/metadata/store`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orgId: orgData.orgId,
                category: 'objects',
                name: selectedObject.name,
                automation: finalAutomations
              })
            });
            
            onOrgDataUpdate((prev: any) => {
              if (!prev) return prev;
              return {
                ...prev,
                objects: prev.objects.map((o: any) => {
                  if (o.name === selectedObject.name) {
                    return {
                      ...o,
                      relatedMetadata: {
                        ...o.relatedMetadata,
                        automation: finalAutomations
                      }
                    };
                  }
                  return o;
                })
              };
            });
          }
        };
        processItems();
      }
    }
  }, [selectedTile, selectedObject, sfService]);

  useEffect(() => {
    if (viewMode === 'fieldDetail' && selectedField && selectedObjectName) {
      const fetchFieldData = async () => {
        try {
          const category = selectedTile === 'validationRules' ? 'validationRules' : 'fields';
          const res = await fetch(`/api/metadata/${orgData.orgId}/objects/${selectedObjectName}/${category}/${selectedField.name}`);
          if (res.ok) {
            const data = await res.json();
            if (data.usageSummary) setFieldUsageSummary(data.usageSummary);
            if (data.scanResults) setScanResults(data.scanResults);
          }
        } catch (e) {
          console.warn("Failed to fetch field data from DB", e);
        }
      };
      fetchFieldData();
    }
  }, [viewMode, selectedField, selectedObjectName, orgData.orgId, selectedTile]);

  useEffect(() => {
    if ((viewMode === 'fieldDetail' || viewMode === 'dependencies') && selectedField && scanResults.length > 0 && !fieldUsageSummary) {
       const usages = scanResults.map(r => ({ componentName: r.name, snippet: r.snippet || '', type: r.category }));
       getFieldUsageSummary(selectedField.name, usages).then(summary => {
         setFieldUsageSummary(summary);
         // Store in DB
         if (selectedObjectName) {
           fetch(`/api/metadata/${orgData.orgId}/objects/${selectedObjectName}/fields/${selectedField.name}/data`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ usageSummary: summary, scanResults })
           });
         }
       }).catch(e => {
         console.warn("Failed to get field usage summary", e);
         setFieldUsageSummary("Failed to generate summary.");
       });
    } else if (viewMode !== 'fieldDetail' && viewMode !== 'dependencies') {
       if (fieldUsageSummary !== null) setFieldUsageSummary(null);
       if (scanResults.length > 0) setScanResults([]);
       if (createdDate !== null) setCreatedDate(null);
       if (similarFields.length > 0) setSimilarFields([]);
    }
  }, [viewMode, selectedField, scanResults, selectedObjectName, orgData.orgId, fieldUsageSummary]);

  useEffect(() => {
    if (viewMode === 'fieldDetail' && selectedField && selectedObjectName && selectedObject?.fields) {
      const similar = selectedObject.fields.filter((f: any) => 
        f.name !== selectedField.name && 
        (calculateMatchPercentage(f.label, selectedField.label) > 80 || calculateMatchPercentage(f.name, selectedField.name) > 80)
      );
      setSimilarFields(similar);
    }
  }, [viewMode, selectedField, selectedObjectName, selectedObject?.fields]);

  const lastFetchRef = useRef<{ field: string, time: number } | null>(null);

  useEffect(() => {
    if (viewMode === 'fieldDetail' && selectedField && selectedObjectName && sfService && selectedTile === 'fields') {
      // Prevent rapid re-fetching for the same field
      const now = Date.now();
      if (lastFetchRef.current && lastFetchRef.current.field === selectedField.name && (now - lastFetchRef.current.time < 2000)) {
        return;
      }
      
      const fetchCounts = async () => {
        try {
          lastFetchRef.current = { field: selectedField.name, time: Date.now() };
          
          // Fetch total count if not already set
          if (totalRecordCount === null) {
            const totalQuery = `/query?q=${encodeURIComponent(`SELECT count(Id) cnt FROM ${selectedObjectName}`)}`;
            const totalRes = await sfService.request(totalQuery);
            if (totalRes && totalRes.records && totalRes.records.length > 0) {
              setTotalRecordCount(totalRes.records[0].cnt);
            }
          }

          // Fetch field count
          const fieldQuery = `/query?q=${encodeURIComponent(`SELECT count(Id) cnt FROM ${selectedObjectName} WHERE ${selectedField.name} != null`)}`;
          const fieldRes = await sfService.request(fieldQuery);
          if (fieldRes && fieldRes.records && fieldRes.records.length > 0) {
            setFieldRecordCount(fieldRes.records[0].cnt);
          }
        } catch (e) {
          console.warn("Failed to fetch record counts", e);
          // Don't reset counts on error to prevent UI flicker or loops
        }
      };
      
      // Debounce the fetch
      const timer = setTimeout(() => {
        fetchCounts();
      }, 500);
      
      return () => clearTimeout(timer);
    } else {
      setFieldRecordCount(null);
      // Don't reset totalRecordCount as it's per object, not per field
    }
  }, [viewMode, selectedField?.name, selectedObjectName, sfService, selectedTile]);

  // Helper to find related metadata for the selected object
  const relatedMetadata = useMemo(() => {
    if (!selectedObject) return {};
    const name = selectedObject.name || '';
    const nameLower = name.toLowerCase();
    
    const layouts = (selectedObject.relatedMetadata?.layouts && selectedObject.relatedMetadata.layouts.length > 0)
      ? selectedObject.relatedMetadata.layouts
      : (orgData.layouts || []).filter(l => 
          (l.name || '').toLowerCase().includes(nameLower) || 
          l.type?.toLowerCase() === nameLower
        );

    const flexiPages = (selectedObject.relatedMetadata?.flexiPages && selectedObject.relatedMetadata.flexiPages.length > 0)
      ? selectedObject.relatedMetadata.flexiPages
      : (orgData.flexiPages || []).filter(p => 
          (p.name || '').toLowerCase().includes(nameLower) || 
          (p.label || '').toLowerCase().includes(nameLower)
        );

    const validationRules = [...(orgData.validationRules || []).filter(v => 
      (v.name || '').toLowerCase().startsWith(nameLower + '.') || 
      v.type?.toLowerCase() === nameLower
    ), ...(selectedObject.relatedMetadata?.validationRules || [])];

    const recordTypeMap = new Map<string, any>();
    
    // Add global record types for this object
    (orgData.recordTypes || []).filter(r => 
      r.type?.toLowerCase() === nameLower || 
      (r.name || '').toLowerCase().startsWith(nameLower + '.')
    ).forEach(rt => {
      recordTypeMap.set(rt.id, rt);
    });

    // Add/Merge object-specific usage data (which now includes labels from salesforceService)
    (selectedObject.recordTypeUsage || []).forEach((rt: any) => {
      const id = rt.id || rt.RecordTypeId;
      if (id) {
        const existing = recordTypeMap.get(id) || recordTypeMap.get(id.substring(0, 15));
        recordTypeMap.set(id, { ...existing, ...rt });
      }
    });

    const recordTypes = Array.from(recordTypeMap.values());

    const compactLayouts = [...(orgData.compactLayouts || []).filter(c => 
      c.type?.toLowerCase() === nameLower || 
      (c.name || '').toLowerCase().includes(nameLower)
    ), ...(selectedObject.relatedMetadata?.compactLayouts || [])];

    const buttons = [...(orgData.buttons || []).filter(b => 
      b.type?.toLowerCase() === nameLower || 
      (b.name || '').toLowerCase().startsWith(nameLower + '.')
    ), ...(selectedObject.relatedMetadata?.buttons || [])];

    const quickActions = [...(orgData.quickActions || []).filter(q => 
      q.type?.toLowerCase() === nameLower || 
      (q.name || '').toLowerCase().startsWith(nameLower + '.')
    ), ...(selectedObject.relatedMetadata?.quickActions || [])];

    const automation = [...(orgData.workflowRules || []).filter(w => 
      (w.name || '').toLowerCase().startsWith(nameLower + '.')
    ), ...(selectedObject.relatedMetadata?.automation || [])].filter((item: any) => {
      const itemObject = (item.tableEnumOrId || item.TableEnumOrId || item.object || item.EntityDefinitionId || item.type || '').toLowerCase();
      const itemName = (item.name || item.DeveloperName || item.MasterLabel || '').toLowerCase();
      
      // High-confidence match: object field matches name
      if (itemObject === nameLower) return true;
      
      // Pattern match: item name starts with object name (e.g. Account.MyRule)
      if (itemName.startsWith(nameLower + '.') || itemName.startsWith(nameLower.replace('__c', '') + '_')) return true;
      
      // Fallback: If no object info is available, preserve it if it was already in selectedObject's relatedMetadata
      // but only if it's not clearly belonging to another object
      const otherObjects = orgData.objects.map(o => (o.name || '').toLowerCase()).filter(n => n !== nameLower);
      if (otherObjects.some(on => itemName.startsWith(on + '.') || (itemObject && itemObject === on))) return false;

      return true;
    });

    return {
      layouts: Array.from(new Map(layouts.map(item => [item.id || item.Id || item.name, item])).values()),
      flexiPages: Array.from(new Map(flexiPages.map(item => [item.id || item.Id || item.name, item])).values()),
      validationRules: Array.from(new Map(validationRules.map(item => [item.id || item.Id || item.ValidationName || item.name, item])).values()),
      recordTypes,
      compactLayouts: Array.from(new Map(compactLayouts.map(item => [item.id || item.Id || item.name, item])).values()),
      buttons: Array.from(new Map(buttons.map(item => [item.id || item.Id || item.name, item])).values()),
      quickActions: Array.from(new Map(quickActions.map(item => [item.id || item.Id || item.name, item])).values()),
      automation: Array.from(new Map(automation.map(item => [item.id || item.Id || item.name, item])).values()),
    };
  }, [selectedObject, orgData]);

  useEffect(() => {
    if (selectedTile === 'layouts' && selectedObject && !selectedObject.allAssignments && sfService) {
      const fetchAssignments = async () => {
        try {
          const asgRes = await sfService.request(`/query?q=${encodeURIComponent(`SELECT Profile.Name, LayoutId, Layout.Name, RecordTypeId FROM ProfileLayout WHERE Layout.TableEnumOrId = '${selectedObject.name}'`)}`, true).catch((e) => { 
            console.warn(`ProfileLayout fetch failed for ${selectedObject.name}`, e);
            return sfService.request(`/query?q=${encodeURIComponent(`SELECT ProfileId, LayoutId FROM ProfileLayout WHERE Layout.TableEnumOrId = '${selectedObject.name}'`)}`, true).catch(() => ({ records: [] }));
          });
          
          if (asgRes && asgRes.records) {
            onOrgDataUpdate((prev: any) => {
              if (!prev) return prev;
              return {
                ...prev,
                objects: prev.objects.map((o: any) => 
                  o.name === selectedObject.name ? { ...o, allAssignments: asgRes.records } : o
                )
              };
            });

            // Save to DB so it's available for "retrieve from database"
            fetch('/api/metadata/update-assignments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orgId: orgData.orgId,
                name: selectedObject.name,
                assignments: asgRes.records,
                type: 'layouts',
                ownerUid: auth.currentUser?.uid
              })
            }).catch(e => console.error("Failed to save layout assignments to DB", e));
          }
        } catch (e) {
          console.error("Failed to fetch layout assignments", e);
          // Set empty to prevent retry
          onOrgDataUpdate((prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              objects: prev.objects.map((o: any) => 
                o.name === selectedObject.name ? { ...o, allAssignments: [] } : o
              )
            };
          });
        }
      };
      fetchAssignments();
    }
  }, [selectedTile, selectedObject?.name, selectedObject?.allAssignments, sfService, orgData, onOrgDataUpdate]);

  useEffect(() => {
    if (selectedTile === 'flexiPages' && selectedObject && !selectedObject.allFlexiPageAssignments && sfService) {
      const fetchFlexiAssignments = async () => {
        try {
          // Instead of querying RecordTypeFlexiPageAssignment (which often fails with 400/403),
          // we use the Metadata parsing approach from the service
          const fpData = await sfService.request(`/query?q=${encodeURIComponent(`SELECT Id, MasterLabel, DeveloperName, Type, EntityDefinitionId FROM FlexiPage WHERE EntityDefinitionId = '${selectedObject.name}' AND Type = 'RecordPage' LIMIT 200`)}`, true).catch(() => ({ records: [] }));
          
          let assignments: any[] = [];
          
          // Try Tooling API query first for assignments
          try {
            const fpAsgRes = await sfService.request(`/query?q=${encodeURIComponent(`SELECT Profile.Name, FlexiPageId, FlexiPage.DeveloperName, RecordType.DeveloperName FROM RecordTypeFlexiPageAssignment WHERE FlexiPage.EntityDefinitionId = '${selectedObject.name}'`)}`, true);
            if (fpAsgRes && fpAsgRes.records && fpAsgRes.records.length > 0) {
              assignments = fpAsgRes.records.map((asg: any) => ({
                FlexiPageId: asg.FlexiPageId,
                FlexiPage: {
                  DeveloperName: asg.FlexiPage?.DeveloperName,
                  MasterLabel: asg.FlexiPage?.DeveloperName
                },
                Profile: {
                  Name: asg.Profile?.Name
                },
                recordType: asg.RecordType?.DeveloperName || 'Master',
                appName: 'All Apps'
              }));
            }
          } catch (e) {
            console.warn("RecordTypeFlexiPageAssignment query failed, falling back to metadata parsing", e);
          }

          // Fallback to metadata parsing if query returned nothing
          if (assignments.length === 0 && fpData && fpData.records) {
            // Fetch metadata for each FlexiPage individually to avoid MALFORMED_QUERY
            const recordsWithMetadata = await Promise.all(fpData.records.map(async (fp: any) => {
              try {
                const fullFp = await sfService.fetchFullMetadata('FlexiPage', fp.Id);
                return { ...fp, Metadata: fullFp.Metadata };
              } catch (e) {
                console.warn(`Failed to fetch metadata for FlexiPage ${fp.Id}`, e);
                return fp;
              }
            }));

            recordsWithMetadata.forEach((fp: any) => {
              if (fp.Metadata && fp.Metadata.pageTemplates) {
                fp.Metadata.pageTemplates.forEach((template: any) => {
                  if (template.pageTemplateAssignments) {
                    template.pageTemplateAssignments.forEach((assignment: any) => {
                      assignments.push({
                        FlexiPageId: fp.Id,
                        FlexiPage: {
                          DeveloperName: fp.DeveloperName,
                          MasterLabel: fp.MasterLabel
                        },
                        Profile: {
                          Name: assignment.profile
                        },
                        recordType: assignment.recordType,
                        appName: assignment.appName
                      });
                    });
                  }
                });
              }
            });
          }

          onOrgDataUpdate((prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              objects: prev.objects.map((o: any) => 
                o.name === selectedObject.name ? { ...o, allFlexiPageAssignments: assignments } : o
              )
            };
          });

          // Save to DB so it's available for "retrieve from database"
          if (assignments.length > 0) {
            fetch('/api/metadata/update-assignments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orgId: orgData.orgId,
                name: selectedObject.name,
                assignments: assignments,
                type: 'flexiPages',
                ownerUid: auth.currentUser?.uid
              })
            }).catch(e => console.error("Failed to save flexipage assignments to DB", e));
          }
        } catch (e) {
          console.error("Failed to fetch flexipage assignments", e);
          onOrgDataUpdate((prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              objects: prev.objects.map((o: any) => 
                o.name === selectedObject.name ? { ...o, allFlexiPageAssignments: [] } : o
              )
            };
          });
        }
      };
      fetchFlexiAssignments();
    }
  }, [selectedTile, selectedObject?.name, selectedObject?.allFlexiPageAssignments, sfService, orgData, onOrgDataUpdate]);

  useEffect(() => {
    if (viewMode === 'actionDetail' && selectedAction && !selectedAction.explanation) {
      const fetchActionExplanation = async () => {
        try {
          let content = selectedAction.content;
          const isQuickAction = relatedMetadata.quickActions?.some(q => q.id === selectedAction.id);
          const cat: MetadataCategory = isQuickAction ? 'quickActions' : 'buttons';
          
          if (!content && sfService) {
            const res = await sfService.fetchMetadataContent(cat, selectedAction.id);
            content = res.content;
          }
          
          const aiRes = await explainMetadata(cat, selectedAction.name, content || '').catch(e => {
            console.warn("Failed to explain action", e);
            return { explanation: "Failed to generate explanation.", mermaidCode: "" };
          });
          setSelectedAction(prev => prev ? ({ ...prev, explanation: aiRes.explanation, mermaidCode: aiRes.mermaidCode, content: content }) : null);
          
          // Save to DB
          if (orgData?.orgId && selectedObject?.name) {
            fetch(`/api/metadata/${orgData.orgId}/objects/${selectedObject.name}/${cat}/${selectedAction.name}/data`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                explanation: aiRes.explanation,
                mermaidCode: aiRes.mermaidCode,
                content: content
              })
            }).catch(e => console.error("Failed to save action explanation to DB", e));
          }
          
          // Update the object in state to persist the explanation during session
          if (selectedObject) {
            onOrgDataUpdate((prev: any) => {
              if (!prev) return prev;
              return {
                ...prev,
                objects: prev.objects.map((o: any) => {
                  if (o.name === selectedObject.name) {
                    const updatedRelated = { ...o.relatedMetadata };
                    if (updatedRelated.buttons) {
                      updatedRelated.buttons = updatedRelated.buttons.map((b: any) => 
                        b.id === selectedAction.id ? { ...b, explanation: aiRes.explanation, mermaidCode: aiRes.mermaidCode, content } : b
                      );
                    }
                    if (updatedRelated.quickActions) {
                      updatedRelated.quickActions = updatedRelated.quickActions.map((q: any) => 
                        q.id === selectedAction.id ? { ...q, explanation: aiRes.explanation, mermaidCode: aiRes.mermaidCode, content } : q
                      );
                    }
                    return { ...o, relatedMetadata: updatedRelated };
                  }
                  return o;
                })
              };
            });
          }
        } catch (e) {
          console.error("Failed to fetch action explanation", e);
          setSelectedAction(prev => prev ? ({ ...prev, explanation: "Error fetching explanation." }) : null);
        }
      };
      fetchActionExplanation();
    }
  }, [viewMode, selectedAction?.id, sfService, selectedObject?.name, onOrgDataUpdate]);

  useEffect(() => {
    const activeItem = viewMode === 'layoutDetail' ? selectedLayout : 
                      viewMode === 'flexiPageDetail' ? selectedFlexiPage : 
                      (viewMode === 'fieldDetail' && selectedTile === 'validationRules') ? selectedField : null;
    
    const category: MetadataCategory | null = viewMode === 'layoutDetail' ? 'layouts' : 
                                             viewMode === 'flexiPageDetail' ? 'flexiPages' : 
                                             (viewMode === 'fieldDetail' && selectedTile === 'validationRules') ? 'validationRules' : null;

    if (activeItem && category && selectedObjectName) {
      const fetchMetadataData = async () => {
        setIsFetchingSimilarities(true);
        try {
          const safeName = (activeItem.name || activeItem.id || '').replace(/[^a-zA-Z0-9]/g, '_');
          console.log(`Fetching similarities for ${category} ${safeName} in object ${selectedObjectName}`);
          if (!safeName) {
            setPersistedSimilarities([]);
            return;
          }

          const res = await fetch(`/api/metadata/${orgData.orgId}/objects/${selectedObjectName}/${category}/${safeName}`);
          if (res.ok) {
            const data = await res.json();
            console.log(`Fetched similarities:`, data.similarities);
            const similarities = Array.isArray(data.similarities) ? data.similarities : [];
            setPersistedSimilarities(similarities);
          } else {
            console.log(`Failed to fetch similarities, status: ${res.status}`);
            setPersistedSimilarities([]);
          }
        } catch (e) {
          console.warn(`Failed to fetch ${category} data from DB`, e);
          setPersistedSimilarities([]);
        } finally {
          setIsFetchingSimilarities(false);
        }
      };
      fetchMetadataData();
    }
  }, [viewMode, selectedLayout, selectedFlexiPage, selectedField, selectedTile, selectedObjectName, orgData.orgId]);

  useEffect(() => {
    const category: MetadataCategory | null = viewMode === 'layoutDetail' ? 'layouts' : 
                                             viewMode === 'flexiPageDetail' ? 'flexiPages' : 
                                             (viewMode === 'fieldDetail' && selectedTile === 'validationRules') ? 'validationRules' : null;
    
    const items = category ? selectedObject?.relatedMetadata?.[category] : null;

    if (category && items && sfService) {
      const missingItems = items.filter(l => !l.content && !failedMetadata.has(`${category}:${l.id}`));
      
      if (missingItems.length > 0) {
        const fetchMissing = async () => {
          for (const item of missingItems) {
            if (failedMetadata.has(`${category}:${item.id}`)) continue;

            try {
              // Try DB first to avoid unnecessary Salesforce API calls
              const dbRes = await fetch(`/api/metadata/${orgData.orgId}/${category}/${(item.name || item.DeveloperName || item.ValidationName || '').replace(/[^a-zA-Z0-9]/g, '_')}`);
              if (dbRes.ok) {
                const dbData = await dbRes.json();
                if (dbData.content) {
                  onOrgDataUpdate((prev: any) => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      objects: prev.objects.map((obj: any) => 
                        obj.name === selectedObjectName 
                          ? {
                              ...obj,
                              relatedMetadata: {
                                ...obj.relatedMetadata,
                                [category]: (obj.relatedMetadata?.[category] || []).map((l: any) => 
                                  (l.id === item.id || (l.id && item.id && l.id.substring(0, 15) === item.id.substring(0, 15))) ? { ...l, content: dbData.content } : l
                                )
                              }
                            }
                          : obj
                      )
                    };
                  });
                  continue;
                }
              }

              await new Promise(resolve => setTimeout(resolve, 500));
              const result = await sfService.fetchMetadataContent(category, item.id);
              if (result && result.content) {
                const content = result.content;
                onOrgDataUpdate((prev: any) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    objects: prev.objects.map((obj: any) => 
                      obj.name === selectedObjectName 
                        ? {
                            ...obj,
                            relatedMetadata: {
                              ...obj.relatedMetadata,
                              [category]: (obj.relatedMetadata?.[category] || []).map((l: any) => 
                                (l.id === item.id || (l.id && item.id && l.id.substring(0, 15) === item.id.substring(0, 15))) ? { ...l, content } : l
                              )
                            }
                          }
                        : obj
                    )
                  };
                });
              } else {
                setFailedMetadata(prev => new Set(prev).add(`${category}:${item.id}`));
              }
            } catch (e: any) {
              console.warn(`Failed to fetch content for ${category} ${item.name}`, e);
              setFailedMetadata(prev => new Set(prev).add(`${category}:${item.id}`));
            }
          }
        };
        fetchMissing();
      }
    }
  }, [viewMode, selectedLayout, selectedFlexiPage, selectedField, selectedTile, selectedObject, sfService, selectedObjectName, orgData, onOrgDataUpdate, failedMetadata]);

  const metadataSimilarities = useMemo(() => {
    if (persistedSimilarities.length > 0) return persistedSimilarities;

    const category: MetadataCategory | null = viewMode === 'layoutDetail' ? 'layouts' : 
                                             viewMode === 'flexiPageDetail' ? 'flexiPages' : 
                                             (viewMode === 'fieldDetail' && selectedTile === 'validationRules') ? 'validationRules' : null;
    
    const activeItem = viewMode === 'layoutDetail' ? selectedLayout : 
                      viewMode === 'flexiPageDetail' ? selectedFlexiPage : 
                      (viewMode === 'fieldDetail' && selectedTile === 'validationRules') ? selectedField : null;

    if (!category || !activeItem || !selectedObject?.relatedMetadata?.[category]) return [];
    
    const items = selectedObject.relatedMetadata[category] as any[];
    return items
      .filter(l => l.id !== activeItem.id)
      .map(other => ({
        name: other.name,
        id: other.id,
        percent: calculateMatchPercentage(activeItem.content || '', other.content || '')
      }))
      .filter(s => s.percent > 0)
      .sort((a, b) => b.percent - a.percent);
  }, [viewMode, selectedLayout, selectedFlexiPage, selectedField, selectedTile, selectedObject, persistedSimilarities]);

  useEffect(() => {
    if (viewMode === 'fieldDetail' && selectedTile === 'validationRules' && selectedField && metadataSimilarities.length > 0) {
      const analyzeRules = async () => {
        for (const sim of metadataSimilarities) {
          const key = `${selectedField.id}-${sim.id}`;
          if (mergeAnalyses[key]) continue;

          // Find the actual rule object to get formula and error message
          const otherRule = (selectedObject?.relatedMetadata?.validationRules || []).find((r: any) => r.id === sim.id);
          if (!otherRule) continue;

          setMergeAnalyses(prev => ({ ...prev, [key]: { canMerge: false, mergedFormula: null, mergedErrorMessage: null, reasoning: '', loading: true } }));

          try {
            const result = await analyzeValidationRuleMerge(
              { 
                name: selectedField.ValidationName || selectedField.name, 
                formula: selectedField.validationformula || selectedField.ErrorConditionFormula || getFormulaFromContent(selectedField.content) || '', 
                errorMessage: selectedField.errormessage || selectedField.ErrorMessage || selectedField.errorMessage || '' 
              },
              { 
                name: otherRule.ValidationName || otherRule.name, 
                formula: otherRule.validationformula || otherRule.ErrorConditionFormula || getFormulaFromContent(otherRule.content) || '', 
                errorMessage: otherRule.errormessage || otherRule.ErrorMessage || otherRule.errorMessage || '' 
              }
            );
            setMergeAnalyses(prev => ({ ...prev, [key]: { ...result, loading: false } }));
          } catch (e) {
            console.error("Merge analysis failed", e);
            setMergeAnalyses(prev => ({ ...prev, [key]: { canMerge: false, mergedFormula: null, mergedErrorMessage: null, reasoning: 'Analysis failed', loading: false } }));
          }
        }
      };
      analyzeRules();
    }
  }, [viewMode, selectedTile, selectedField, metadataSimilarities, selectedObject]);

  const recordTypeChartData = useMemo(() => {
    if (selectedTile !== 'recordTypes' || !selectedObject?.recordTypeUsage || !relatedMetadata.recordTypes) return [];
    
    const usage = selectedObject.recordTypeUsage;
    const rtList = relatedMetadata.recordTypes;
    
    const data = rtList.map(rt => {
      const u = usage.find((u: any) => 
        u.RecordTypeId === rt.id || 
        (u.RecordTypeId && rt.id && u.RecordTypeId.substring(0, 15) === rt.id.substring(0, 15))
      );
      return {
        name: rt.label || rt.name,
        value: u ? u.cnt : 0
      };
    });
    
    // Add Master
    const masterUsage = usage.find((u: any) => !u.RecordTypeId || u.RecordTypeId === '012000000000000AAA');
    if (masterUsage) {
      data.push({
        name: 'Master (No Record Type)',
        value: masterUsage.cnt
      });
    }
    
    return data.filter(d => d.value > 0);
  }, [selectedTile, selectedObject, relatedMetadata.recordTypes]);

  // Persist calculated similarities
  useEffect(() => {
    const category: MetadataCategory | null = viewMode === 'layoutDetail' ? 'layouts' : 
                                             viewMode === 'flexiPageDetail' ? 'flexiPages' : 
                                             (viewMode === 'fieldDetail' && selectedTile === 'validationRules') ? 'validationRules' : null;
    
    const activeItem = viewMode === 'layoutDetail' ? selectedLayout : 
                      viewMode === 'flexiPageDetail' ? selectedFlexiPage : 
                      (viewMode === 'fieldDetail' && selectedTile === 'validationRules') ? selectedField : null;

    if (category && activeItem && metadataSimilarities.length > 0 && persistedSimilarities.length === 0 && selectedObjectName) {
      const saveSimilarities = async () => {
        try {
          const safeName = (activeItem.name || activeItem.id || '').replace(/[^a-zA-Z0-9]/g, '_');
          if (!safeName) return;

          await fetch(`/api/metadata/${orgData.orgId}/objects/${selectedObjectName}/${category}/${safeName}/data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ similarities: metadataSimilarities })
          });
        } catch (e) {
          console.warn(`Failed to store ${category} similarities`, e);
        }
      };
      saveSimilarities();
    }
  }, [viewMode, selectedLayout, selectedFlexiPage, selectedField, selectedTile, metadataSimilarities, persistedSimilarities, selectedObjectName, orgData.orgId]);

  const tiles = [
    { id: 'automation', label: 'Automation', icon: 'fa-robot', count: relatedMetadata.automation?.length || 0, color: 'bg-cyan-500' },
    { id: 'buttons', label: 'Buttons & Actions', icon: 'fa-mouse-pointer', count: (relatedMetadata.buttons?.length || 0) + (relatedMetadata.quickActions?.length || 0), color: 'bg-orange-500' },
    { id: 'compactLayouts', label: 'Compact Layouts', icon: 'fa-compress', count: relatedMetadata.compactLayouts?.length || 0, color: 'bg-teal-500' },
    { id: 'fields', label: 'Fields', icon: 'fa-table-list', count: selectedObject?.fields?.length || 0, color: 'bg-[#FFE600]/100' },
    { id: 'flexiPages', label: 'Lightning Pages', icon: 'fa-window-maximize', count: relatedMetadata.flexiPages?.length || 0, color: 'bg-indigo-500' },
    { id: 'layouts', label: 'Page Layouts', icon: 'fa-columns', count: relatedMetadata.layouts?.length || 0, color: 'bg-purple-500' },
    { id: 'limits', label: 'Object Limits', icon: 'fa-gauge-high', count: selectedObject?.objectLimits?.length || 0, color: 'bg-amber-500' },
    { id: 'permissions', label: 'Object Access', icon: 'fa-user-shield', count: selectedObject?.objectPermissions?.length || 0, color: 'bg-rose-600' },
    { id: 'recordTypes', label: 'Record Types', icon: 'fa-tags', count: relatedMetadata.recordTypes?.length || 0, color: 'bg-emerald-500' },
    { id: 'validationRules', label: 'Validation Rules', icon: 'fa-shield-halved', count: relatedMetadata.validationRules?.length || 0, color: 'bg-red-500' },
  ];

  const handleRetrieveObjectMetadata = async (obj: SalesforceObject) => {
    if (!sfService) return;

    setIsRetrievingMetadata(true);
    try {
      // 1. Fetch from Salesforce first to ensure we have the content
      const sfRes = await sfService.fetchMetadataContent('objects', obj.name);
      const { 
        content, 
        objectPermissions, 
        objectLimits, 
        recordTypeUsage, 
        automation: sfAutomation, 
        quickActions: sfQuickActions,
        buttons: sfButtons,
        validationRules: sfValidationRules,
        layouts: sfLayouts,
        flexiPages: sfFlexiPages,
        compactLayouts: sfCompactLayouts,
        allAssignments: sfAssignments,
        allFlexiPageAssignments: sfFpAssignments
      } = sfRes as any;
      
      // Fetch ALL fields via describe to be complete
      const allFields = await sfService.getObjectFields(obj.name);
      
      const { fields: xmlFields, related: initialRelated } = getFieldsFromContent(content || '');
      
      // Merge fields: prioritize describe fields but keep anything unique from XML if any
      const mergedFields = [...allFields];
      xmlFields.forEach(xf => {
        if (!mergedFields.some(mf => mf.name === xf.name)) {
          mergedFields.push(xf);
        }
      });

      const filteredPermissions = (objectPermissions || []).filter((p: any) => {
        const label = (p.label || p.name || (p.Parent?.IsOwnedByProfile ? p.Parent?.Profile?.Name : (p.Parent?.Label || p.Parent?.Name)) || '').toLowerCase(); return label && !label.startsWith('00e') && !label.startsWith('x00e');
      });

      // 2. Store in DB
      await fetch('/api/metadata/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: orgData.orgId,
          category: 'objects',
          name: obj.name,
          label: obj.label,
          content,
          hasFullMetadata: true, // Mark as fully fetched
          objectPermissions: filteredPermissions,
          objectLimits: objectLimits || [],
          recordTypeUsage: recordTypeUsage || [],
          automation: sfAutomation || initialRelated.automation || [],
          quickActions: sfQuickActions || initialRelated.quickActions || [],
          buttons: sfButtons || initialRelated.buttons || [],
          fields: mergedFields,
          validationRules: sfValidationRules || initialRelated.validationRules || [],
          layouts: sfLayouts || initialRelated.layouts || [],
          flexiPages: sfFlexiPages || initialRelated.flexiPages || [],
          compactLayouts: sfCompactLayouts || initialRelated.compactLayouts || [],
          allAssignments: sfAssignments || [],
          allFlexiPageAssignments: sfFpAssignments || []
        })
      });

      // 3. Fetch from backend to get generated explanation and mermaid
      console.log(`Fetching updated metadata from DB for ${obj.name}...`);
      const response = await fetch(`/api/metadata/${orgData.orgId}/objects/${obj.name}`);
      if (!response.ok) {
        throw new Error(`Failed to retrieve metadata for ${obj.name}`);
      }
      const dbData = await response.json();
      console.log(`Retrieved DB data for ${obj.name}:`, {
        hasAutomation: !!dbData.automation?.length,
        hasValidationRules: !!dbData.validationRules?.length,
        hasQuickActions: !!dbData.quickActions?.length,
        hasButtons: !!dbData.buttons?.length,
        hasFields: !!dbData.fields?.length
      });

      const { fields: dbFields, related: dbRelated } = getFieldsFromContent(dbData.content);

      const dbFilteredPermissions = (dbData.objectPermissions || []).filter((p: any) => {
        const label = (p.label || p.name || (p.Parent?.IsOwnedByProfile ? p.Parent?.Profile?.Name : (p.Parent?.Label || p.Parent?.Name)) || '').toLowerCase(); return label && !label.startsWith('00e') && !label.startsWith('x00e');
      });

      const updatedObjects = orgData.objects.map(o =>
        o.name === obj.name ? { 
          ...o, 
          hasFullMetadata: true,
          fields: dbData.fields || dbFields, 
          objectPermissions: dbFilteredPermissions,
          objectLimits: dbData.objectLimits || [],
          recordTypeUsage: dbData.recordTypeUsage || [],
          relatedMetadata: {
            ...dbRelated,
            automation: dbData.automation || dbRelated.automation || [],
            quickActions: dbData.quickActions || dbRelated.quickActions || [],
            buttons: dbData.buttons || dbRelated.buttons || [],
            layouts: dbData.layouts || dbRelated.layouts || [],
            flexiPages: dbData.flexiPages || dbRelated.flexiPages || [],
            validationRules: dbData.validationRules || dbRelated.validationRules || [],
            compactLayouts: dbData.compactLayouts || dbRelated.compactLayouts || [],
          },
          content: dbData.content, 
          explanation: dbData.explanation, 
          mermaidCode: dbData.mermaidCode || null,
          allAssignments: dbData.allAssignments || sfAssignments,
          allFlexiPageAssignments: dbData.allFlexiPageAssignments || sfFpAssignments
        } : o
      );
      onOrgDataUpdate({ ...orgData, objects: updatedObjects });
      addNotification('Metadata Retrieved', `Successfully retrieved metadata for ${obj.label}.`, 'success');
    } catch (err: any) {
      console.error('Failed to retrieve object metadata:', err);
      addNotification('Retrieval Failed', err.message || `Failed to retrieve metadata for ${obj.label}.`, 'error');
    } finally {
      setIsRetrievingMetadata(false);
    }
  };

  const handleDownloadDiagram = (name: string) => {
    const svgElement = diagramRef.current?.querySelector('svg');
    if (!svgElement) {
      addNotification('Error', 'Could not find diagram to download', 'error');
      return;
    }

    try {
      // Clone the SVG to avoid modifying the displayed one
      const clonedSvg = svgElement.cloneNode(true) as SVGElement;
      
      // Ensure it has the correct XML namespace
      clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      
      const svgData = new XMLSerializer().serializeToString(clonedSvg);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);
      
      const downloadLink = document.createElement('a');
      downloadLink.href = svgUrl;
      downloadLink.download = `${name}_diagram.svg`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      
      addNotification('Success', 'Diagram downloaded as SVG', 'success');
    } catch (err) {
      console.error('Download failed', err);
      addNotification('Error', 'Failed to download diagram', 'error');
    }
  };

  const handleSelectObject = async (initialObj: SalesforceObject) => {
    setIsLoadingObject(true);
    setSelectedObjectName(initialObj.name);
    setViewMode('tiles');
    setSelectedTile(null);
    setSelectedField(null);
    setCreatedDate(null);
    
    let currentObj = { ...initialObj };

    try {
      // If we don't have full metadata or related metadata is missing, fetch from DB or Salesforce
      const hasRelatedMetadata = currentObj.relatedMetadata && (
        (currentObj.relatedMetadata.automation || []).length > 0 ||
        (currentObj.relatedMetadata.buttons || []).length > 0 ||
        (currentObj.relatedMetadata.layouts || []).length > 0 ||
        (currentObj.relatedMetadata.validationRules || []).length > 0 ||
        (currentObj.relatedMetadata.flexiPages || []).length > 0
      );

      if (!currentObj.hasFullMetadata || (currentObj.fields || []).length === 0 || !hasRelatedMetadata) {
        setIsFetchingFields(true);
        try {
          const res = await fetch(`/api/metadata/${orgData.orgId}/objects/${currentObj.name}`);
          if (res.ok) {
            const dbData = await res.json();
            
            if (dbData.hasFullMetadata) {
              // Use DB data if it's complete
              let { fields: dbFields, related: dbRelated } = getFieldsFromContent(dbData.content);
              const filteredPermissions = (dbData.objectPermissions || []).filter((p: any) => {
                const label = (p.label || p.name || (p.Parent?.IsOwnedByProfile ? p.Parent?.Profile?.Name : (p.Parent?.Label || p.Parent?.Name)) || '').toLowerCase(); return label && !label.startsWith('00e') && !label.startsWith('x00e');
              });

              currentObj = { 
                ...currentObj, 
                hasFullMetadata: true,
                fields: dbData.fields || dbFields, 
                objectPermissions: filteredPermissions,
                objectLimits: dbData.objectLimits || [],
                recordTypeUsage: dbData.recordTypeUsage || [],
                relatedMetadata: {
                  ...dbRelated,
                  automation: dbData.automation || dbRelated.automation || [],
                  quickActions: dbData.quickActions || dbRelated.quickActions || [],
                  buttons: dbData.buttons || dbRelated.buttons || [],
                  layouts: dbData.layouts || dbRelated.layouts || [],
                  flexiPages: dbData.flexiPages || dbRelated.flexiPages || [],
                  validationRules: dbData.validationRules || dbRelated.validationRules || [],
                  compactLayouts: dbData.compactLayouts || dbRelated.compactLayouts || [],
                },
                content: dbData.content, 
                explanation: dbData.explanation, 
                mermaidCode: dbData.mermaidCode || null,
                allAssignments: dbData.allAssignments,
                allFlexiPageAssignments: dbData.allFlexiPageAssignments
              };
              
              onOrgDataUpdate((prev: any) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  objects: prev.objects.map((o: any) => o.name === currentObj.name ? currentObj : o)
                };
              });
            } else if (sfService) {
              // If DB data is incomplete, fetch from Salesforce
              await handleRetrieveObjectMetadata(currentObj);
            }
          } else if (sfService) {
            // If not in DB at all, fetch from Salesforce
            await handleRetrieveObjectMetadata(currentObj);
          }
        } catch (err) {
          console.error('Error fetching object data:', err);
          if (sfService) {
            await handleRetrieveObjectMetadata(currentObj);
          }
        } finally {
          setIsFetchingFields(false);
        }
      }

      // If we have content but no fields, parse it
      if (currentObj.content && (!currentObj.fields || currentObj.fields.length === 0)) {
         const parsed = getFieldsFromContent(currentObj.content);
         currentObj = { ...currentObj, fields: parsed.fields, relatedMetadata: parsed.related };
         onOrgDataUpdate((prev: any) => {
           if (!prev) return prev;
           return { ...prev, objects: prev.objects.map((o: any) => o.name === currentObj.name ? currentObj : o) };
         });
      }

      // If we have content but no explanation, generate it on-demand
      if (currentObj.content && !currentObj.explanation) {
         setIsFetchingFields(true);
         try {
           const aiRes = await explainMetadata('objects', currentObj.name, currentObj.content);
           
           // Save to DB
           const saveRes = await fetch('/api/metadata/update-explanation', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({
               orgId: orgData.orgId,
               category: 'objects',
               name: currentObj.name,
               explanation: aiRes.explanation,
               mermaidCode: aiRes.mermaidCode
             })
           });

           if (saveRes.ok) {
            currentObj = { ...currentObj, explanation: aiRes.explanation, mermaidCode: aiRes.mermaidCode };
            onOrgDataUpdate((prev: any) => {
              if (!prev) return prev;
              return { ...prev, objects: prev.objects.map((o: any) => o.name === currentObj.name ? currentObj : o) };
            });
           }
         } catch (e) {
           console.error("On-demand explanation failed", e);
         } finally {
           setIsFetchingFields(false);
         }
      }

      if (currentObj.fields && currentObj.fields.length > 0) {
        // Already have fields
      } else if (sfService) {
        setIsFetchingFields(true);
        try {
          const fields = await sfService.getObjectFields(currentObj.name);
          currentObj = { ...currentObj, fields };
          onOrgDataUpdate((prev: any) => {
            if (!prev) return prev;
            return { ...prev, objects: prev.objects.map((o: any) => o.name === currentObj.name ? currentObj : o) };
          });
        } catch (err) {
          console.error("Failed to fetch fields:", err);
        } finally {
          setIsFetchingFields(false);
        }
      }
    } catch (error) {
      console.error("Object selection failed", error);
    } finally {
      setTimeout(() => setIsLoadingObject(false), 800);
    }
  };

  const findDependencies = (fieldName: string) => {
    if (!selectedObject || !fieldName) return [];
    const dependencies: { category: string, name: string, type: string }[] = [];
    const fieldSearch = fieldName.toLowerCase();

    // Helper to search in a category
    const searchInCategory = (category: MetadataCategory, label: string) => {
      const items = (orgData as any)[category] || [];
      items.forEach((item: any) => {
        if (item.content?.toLowerCase().includes(fieldSearch)) {
          dependencies.push({ category, name: item.name || item.label, type: label });
        }
      });
    };

    searchInCategory('classes', 'Apex Class');
    searchInCategory('triggers', 'Apex Trigger');
    searchInCategory('vfPages', 'Visualforce Page');
    searchInCategory('lwcs', 'LWC');

    return dependencies;
  };

  const handleViewAssignments = async (item: any) => {
    if (!sfService || !selectedObject) return;

    // If we already have allAssignments for the object, use them
    if (selectedObject.allAssignments && selectedObject.allAssignments.length > 0 && selectedTile === 'layouts') {
      const filtered = selectedObject.allAssignments.filter((asg: any) => 
        asg.LayoutId === item.id || asg.LayoutId?.substring(0, 15) === item.id?.substring(0, 15) || asg.Layout?.Name === item.name
      );
      setAssignments(filtered);
      setViewMode('assignments');
      return;
    }

    if (selectedObject.allFlexiPageAssignments && selectedObject.allFlexiPageAssignments.length > 0 && selectedTile === 'flexiPages') {
      const filtered = selectedObject.allFlexiPageAssignments.filter((asg: any) => 
        asg.FlexiPageId === item.id || asg.FlexiPageId?.substring(0, 15) === item.id?.substring(0, 15) || asg.FlexiPage?.DeveloperName === item.name
      );
      setAssignments(filtered);
      setViewMode('assignments');
      return;
    }

    setIsRetrievingMetadata(true);
    try {
      if (selectedTile === 'layouts') {
        // Fetch ALL assignments for the object to populate badges and the specific view
        const query = `SELECT Profile.Name, LayoutId, Layout.Name, RecordTypeId FROM ProfileLayout WHERE Layout.TableEnumOrId = '${selectedObject.name}'`;
        const res = await sfService.request(`/query?q=${encodeURIComponent(query)}`, true);
        const allFetchedAssignments = res.records || [];
        
        // Update local state for badges
        onOrgDataUpdate((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            objects: prev.objects.map((o: any) => 
              o.name === selectedObject.name ? { ...o, allAssignments: allFetchedAssignments } : o
            )
          };
        });

        // Store in DB
        fetch('/api/metadata/update-assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId: orgData.orgId,
            name: selectedObject.name,
            assignments: allFetchedAssignments,
            type: 'layouts',
            ownerUid: auth.currentUser?.uid
          })
        }).catch(e => console.warn("Failed to update assignments in DB", e));

        // Filter for the current item
        const filtered = allFetchedAssignments.filter((asg: any) => 
          asg.LayoutId === item.id || asg.LayoutId?.substring(0, 15) === item.id?.substring(0, 15) || asg.Layout?.Name === item.name
        );
        setAssignments(filtered);
        setViewMode('assignments');
      } else if (selectedTile === 'flexiPages') {
        // Fetch ALL FlexiPage assignments for the object
        const fpData = await sfService.request(`/query?q=${encodeURIComponent(`SELECT Id, MasterLabel, DeveloperName, Type, EntityDefinitionId FROM FlexiPage WHERE (EntityDefinitionId = '${selectedObject.name}' OR Type = '${selectedObject.name}') AND Type = 'RecordPage' LIMIT 200`)}`, true).catch(() => ({ records: [] }));
        
        const allFetchedAssignments: any[] = [];
        if (fpData && fpData.records) {
          const recordsWithMetadata = await Promise.all(fpData.records.map(async (fp: any) => {
            try {
              const fullFp = await sfService.fetchFullMetadata('FlexiPage', fp.Id);
              return { ...fp, Metadata: fullFp.Metadata };
            } catch (e) {
              console.warn(`Failed to fetch metadata for FlexiPage ${fp.Id}`, e);
              return fp;
            }
          }));

          recordsWithMetadata.forEach((fp: any) => {
            if (fp.Metadata && fp.Metadata.pageTemplates) {
              fp.Metadata.pageTemplates.forEach((template: any) => {
                if (template.pageTemplateAssignments) {
                  template.pageTemplateAssignments.forEach((assignment: any) => {
                    allFetchedAssignments.push({
                      FlexiPageId: fp.Id,
                      FlexiPage: {
                        DeveloperName: fp.DeveloperName,
                        MasterLabel: fp.MasterLabel
                      },
                      Profile: {
                        Name: assignment.profile
                      },
                      recordType: assignment.recordType,
                      appName: assignment.appName
                    });
                  });
                }
              });
            }
          });
        }

        // Update local state for badges
        onOrgDataUpdate((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            objects: prev.objects.map((o: any) => 
              o.name === selectedObject.name ? { ...o, allFlexiPageAssignments: allFetchedAssignments } : o
            )
          };
        });

        // Store in DB
        fetch('/api/metadata/update-assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId: orgData.orgId,
            name: selectedObject.name,
            assignments: allFetchedAssignments,
            type: 'flexiPages',
            ownerUid: auth.currentUser?.uid
          })
        }).catch(e => console.warn("Failed to update flexipage assignments in DB", e));

        // Filter for the current item
        const filtered = allFetchedAssignments.filter((asg: any) => 
          asg.FlexiPageId === item.id || asg.FlexiPageId?.substring(0, 15) === item.id?.substring(0, 15) || asg.FlexiPage?.DeveloperName === item.name
        );
        setAssignments(filtered);
        setViewMode('assignments');
      }
    } catch (e) {
      console.error("Failed to fetch assignments", e);
      addNotification('Error', 'Failed to fetch assignments', 'error');
    } finally {
      setIsRetrievingMetadata(false);
    }
  };

  const handleDeepScan = async () => {
    if (isScanning) {
      addNotification('Scan in Progress', 'A dependency scan is already running. Please wait for it to complete.', 'info');
      return;
    }
    if (!selectedField || !selectedField.name || !sfService) return;
    setIsScanning(true);
    setScanResults([]);
    
    // Clear previous scan results in DB before starting new scan
    if (selectedObjectName && selectedField) {
      try {
        const category = selectedTile === 'validationRules' ? 'validationRules' : 'fields';
        await fetch(`/api/metadata/${orgData.orgId}/objects/${selectedObjectName}/${category}/${selectedField.name}/data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scanResults: [] })
        });
      } catch (e) { console.warn("Failed to clear previous scan results", e); }
    }

    try {
      const fieldName = selectedField.name;
      const searchStr = fieldName.toLowerCase();
      // Use word boundary for more accurate matching
      const regex = new RegExp(`\\b${fieldName}\\b`, 'i');
      const results: any[] = [];
      
      // Categories to scan
      const categories: MetadataCategory[] = ['classes', 'triggers', 'flows', 'vfPages', 'lwcs', 'validationRules', 'flexiPages', 'layouts', 'compactLayouts', 'buttons'];
      const unsyncedCategories: string[] = [];
      
      for (const cat of categories) {
        if (!orgData.syncedCategories?.[cat]) {
          unsyncedCategories.push(cat);
          continue;
        }

        const items = (orgData as any)[cat] || [];
        for (const item of items) {
          let content = item.content;
          if (!content) {
             // Fetch content if missing
             try {
               const res = await sfService.fetchMetadataContent(cat, item.id);
               content = res.content;
             } catch (e) { console.warn(`Scan fetch failed for ${item.name}`, e); }
          }
          
          if (content && regex.test(content)) {
            const lines = content.split('\n');
            const matchIndex = lines.findIndex(l => regex.test(l));
            const snippet = lines.slice(Math.max(0, matchIndex - 1), matchIndex + 2).join('\n');
            results.push({ 
              category: cat, 
              name: item.name || item.label, 
              type: cat,
              snippet,
              line: matchIndex + 1
            });
          }
        }
      }
      setScanResults(results);
      
      // Store scan results in DB
      if (selectedObjectName && selectedField) {
        await fetch(`/api/metadata/${orgData.orgId}/objects/${selectedObjectName}/fields/${selectedField.name}/data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scanResults: results })
        });
      }

      if (results.length === 0 && unsyncedCategories.length > 0) {
        addNotification('Scan Incomplete', `No dependencies found in synced metadata. Sync these categories for better results: ${unsyncedCategories.slice(0, 3).join(', ')}${unsyncedCategories.length > 3 ? '...' : ''}`, 'warning');
      } else {
        addNotification('Scan Complete', `Found ${results.length} dependencies.`, 'success');
      }
    } catch (e) {
      console.error("Deep scan failed", e);
      addNotification('Scan Failed', 'Failed to complete deep scan.', 'error');
    } finally {
      setIsScanning(false);
    }
  };

  if (!orgData.syncedCategories.objects) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-white rounded-[32px] border border-slate-200 p-12 text-center animate-fadeIn shadow-sm">
        <div className="w-24 h-24 bg-[#FFE600]/10 rounded-[40px] flex items-center justify-center mb-8 text-[#2E2E38] shadow-inner">
          <i className="fas fa-cube text-5xl"></i>
        </div>
        <h3 className="text-2xl font-semibold text-slate-800 tracking-tight">Schema Explorer Ready</h3>
        <p className="text-slate-500 max-w-sm mt-3 mb-10 font-medium">Connect to your Org schema to audit standard and custom object field distributions.</p>
        <button 
          onClick={onSyncCategory}
          className="px-10 py-4 bg-[#FFE600] text-[#2E2E38] font-semibold rounded-2xl shadow-2xl shadow-[#FFE600]/30 hover:bg-[#E5CF00] transition-all uppercase tracking-widest text-xs"
        >
          Begin Schema Sync
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full space-x-6 animate-fadeIn">
      {/* Left Sidebar - Object List */}
      <div className="w-1/3 bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest">Objects ({filteredObjects.length})</h4>
          <button
            onClick={onSyncCategory}
            className="px-4 py-2 bg-[#FFE600]/10 text-[#2E2E38] rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-blue-100 transition-colors"
          >
            Sync All Objects
          </button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {filteredObjects.length > 0 ? filteredObjects.map((obj) => (
            <button
              key={obj.name}
              onClick={() => handleSelectObject(obj)}
              className={`w-full text-left px-6 py-5 border-b border-slate-50 transition-all flex items-center justify-between group ${
                selectedObjectName === obj.name ? 'bg-[#FFE600]/10 border-l-4 border-l-blue-600' : 'hover:bg-slate-50'
              }`}
            >
              <div className="min-w-0">
                <p className="font-bold text-slate-900 text-base truncate">{obj.label}</p>
                <p className="text-xs text-slate-500 font-mono truncate tracking-tight mt-1">{obj.name}</p>
              </div>
              <div className="flex items-center space-x-3">
                {(obj.fields || []).length > 0 && <i className="fas fa-check-circle text-xs text-green-500"></i>}
                <i className={`fas fa-chevron-right text-xs transition-all group-hover:translate-x-1 ${selectedObjectName === obj.name ? 'text-[#2E2E38]' : 'text-slate-300'}`}></i>
              </div>
            </button>
          )) : (
            <div className="p-12 text-center text-slate-500">
               <p className="text-sm font-bold">No results found.</p>
            </div>
          )}
        </div>
      </div>

      {/* Right Content Area */}
      <div className="flex-1 bg-white rounded-[32px] border border-slate-200 shadow-sm flex flex-col min-w-0 overflow-hidden">
        {selectedObject ? (
          isLoadingObject ? (
            <div className="flex-1 flex flex-col items-center justify-center p-20 text-center animate-fadeIn bg-white/50 backdrop-blur-sm rounded-[40px]">
               <div className="relative w-24 h-24 mb-8">
                 <div className="absolute inset-0 border-4 border-[#FFE600]/30 rounded-full"></div>
                 <div className="absolute inset-0 border-4 border-[#FFE600] border-t-transparent rounded-full animate-spin"></div>
                 <div className="absolute inset-0 flex items-center justify-center text-[#2E2E38]">
                   <i className="fas fa-database text-2xl animate-pulse"></i>
                 </div>
               </div>
               <div className="space-y-3">
                 <h4 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Syncing {selectedObject.label}</h4>
                 <p className="text-slate-500 font-medium max-w-sm mx-auto leading-relaxed">Retrieving object definitions, record type distributions, and cross-component dependencies...</p>
               </div>
               <div className="mt-10 flex items-center justify-center space-x-3 text-[10px] font-black text-[#2E2E38] bg-[#FFE600]/10 px-4 py-2 rounded-full border border-[#FFE600]/30 uppercase tracking-widest">
                 <div className="w-1.5 h-1.5 bg-[#FFE600]/100 rounded-full animate-pulse"></div>
                 <span>Syncing Metadata via Tooling API</span>
               </div>
            </div>
          ) : (
            <>
            {/* Object Header */}
            <div className="p-8 border-b border-slate-100 bg-slate-50/30">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-4">
                  {viewMode !== 'tiles' && (
                    <button 
                      onClick={() => {
                        if (viewMode === 'fieldDetail') {
                          setViewMode('tileDetail');
                        } else if (viewMode === 'actionDetail') {
                          setViewMode('tileDetail');
                        } else if (viewMode === 'layoutDetail') {
                          setViewMode('tileDetail');
                        } else if (viewMode === 'dependencies') {
                          setViewMode('fieldDetail');
                        } else if (viewMode === 'assignments') {
                          setViewMode('tileDetail');
                        } else {
                          setViewMode('tiles');
                        }
                      }}
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all"
                    >
                      <i className="fas fa-arrow-left text-xs"></i>
                    </button>
                  )}
                  <h2 className="text-2xl font-semibold text-slate-800 tracking-tight">{selectedObject.label}</h2>
                </div>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => handleRetrieveObjectMetadata(selectedObject)}
                    disabled={isRetrievingMetadata}
                    className="px-4 py-2 bg-purple-50 text-purple-600 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-purple-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isRetrievingMetadata ? 'Retrieving...' : 'Retrieve Full Metadata'}
                  </button>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest ${selectedObject.isCustom ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-[#2E2E38]'}`}>
                    {selectedObject.isCustom ? 'Custom Object' : 'Standard Object'}
                  </span>
                </div>
              </div>
              <p className="text-sm text-slate-500 font-mono tracking-wider">{selectedObject.name}</p>
            </div>

            {/* Dynamic Content Based on ViewMode */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {viewMode === 'tiles' && (
                <div className="p-8">
                  <div className="grid grid-cols-4 gap-6">
                    {tiles.map(tile => (
                      <button
                        key={tile.id}
                        onClick={() => { setSelectedTile(tile.id); setViewMode('tileDetail'); }}
                        className="group p-6 bg-white border border-slate-100 rounded-3xl shadow-sm hover:shadow-xl hover:border-[#FFE600]/30 transition-all text-left flex flex-col justify-between h-40 relative overflow-hidden w-full"
                      >
                        <div className={`absolute top-0 right-0 w-24 h-24 ${tile.color} opacity-5 rounded-bl-full transform translate-x-8 -translate-y-8 group-hover:scale-110 transition-transform`}></div>
                        <div className={`w-10 h-10 ${tile.color} text-white rounded-xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform`}>
                          <i className={`fas ${tile.icon}`}></i>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{tile.label}</p>
                          <p className="text-2xl font-bold text-slate-800">{tile.count}</p>
                        </div>
                      </button>
                    ))}
                    
                    {/* Schema Diagram Tile */}
                    <button
                      onClick={() => { setSelectedTile(null); setViewMode('tileDetail'); }}
                      className="group p-6 bg-[#2E2E38] border border-slate-800 rounded-3xl shadow-sm hover:shadow-xl transition-all text-left flex flex-col justify-between h-40"
                    >
                      <div className="w-10 h-10 bg-white/10 text-white rounded-xl flex items-center justify-center mb-4">
                        <i className="fas fa-project-diagram"></i>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Schema Diagram</p>
                        <p className="text-sm font-semibold text-white/80">Visualize Relationships</p>
                      </div>
                    </button>
                  </div>

                  {selectedObject.explanation && (
                    <div className="mt-12 p-8 bg-[#FFE600]/10/50 rounded-[32px] border border-[#FFE600]/30">
                      <h4 className="text-sm font-bold text-blue-700 uppercase tracking-widest mb-4">AI Business Context</h4>
                      <div className="markdown-body text-base text-slate-800 leading-relaxed font-medium">
                        <ReactMarkdown>
                          {selectedObject.explanation.split('##')[0] || selectedObject.explanation}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {viewMode === 'tileDetail' && (
                <div className="p-0">
                  {selectedTile === 'automation' && (
                    <div className="animate-fadeIn p-8">
                      <div className="flex items-center justify-between mb-8">
                        <div>
                          <h3 className="text-lg font-semibold text-slate-800 tracking-tight">Order of Execution</h3>
                          <p className="text-sm font-medium text-slate-500 mt-1">Lifecycle of a record transaction</p>
                        </div>
                        <div className="text-xs font-semibold px-3 py-1.5 bg-[#FFE600]/10 text-[#2E2E38] rounded-lg border border-[#FFE600]/30">{relatedMetadata.automation?.length || 0} Components</div>
                      </div>
                      
                      <OrderOfExecution 
                        automations={relatedMetadata.automation?.filter((item: any) => item.name || item.label || item.MasterLabel) || []} 
                        summaries={automationSummaries} 
                      />
                    </div>
                  )}

                  {selectedTile === 'fields' && (
                    <div className="animate-fadeIn">
                      <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                        <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-widest">Field Definitions</h3>
                        <input 
                          type="text" 
                          placeholder="Search fields..." 
                          className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                          value={fieldSearchTerm}
                          onChange={(e) => setFieldSearchTerm(e.target.value)}
                        />
                        <div className="text-xs font-semibold text-slate-400">{(selectedObject.fields || []).length} Total Fields</div>
                      </div>
                      <table className="w-full text-left">
                        <thead className="bg-white sticky top-0 z-10 border-b border-slate-100">
                          <tr>
                            <th className="px-8 py-4 text-xs font-semibold text-slate-400 uppercase tracking-widest">Label</th>
                            <th className="px-8 py-4 text-xs font-semibold text-slate-400 uppercase tracking-widest">API Name</th>
                            <th className="px-8 py-4 text-xs font-semibold text-slate-400 uppercase tracking-widest">Type</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {(selectedObject.fields || [])
                            .filter((f: any) => (f.label || '').toLowerCase().includes((fieldSearchTerm || '').toLowerCase()) || (f.name || '').toLowerCase().includes((fieldSearchTerm || '').toLowerCase()))
                            .sort((a: any, b: any) => (a.label || '').localeCompare(b.label || ''))
                            .map((field: any, idx: number) => (
                            <tr 
                              key={`${field.name}-${idx}`} 
                              onClick={() => { setSelectedField(field); setCreatedDate(field.createdDate || null); setViewMode('fieldDetail'); }}
                              className="hover:bg-[#FFE600]/10/50 cursor-pointer transition-colors group"
                            >
                              <td className="px-8 py-4 text-sm font-semibold text-slate-700 group-hover:text-[#2E2E38]">{field.label}</td>
                              <td className="px-8 py-4 text-sm font-mono text-slate-400">{field.name}</td>
                              <td className="px-8 py-4">
                                <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs font-semibold uppercase tracking-tighter">
                                  {field.type}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {(selectedTile === 'layouts' || selectedTile === 'flexiPages' || selectedTile === 'validationRules' || selectedTile === 'recordTypes' || selectedTile === 'compactLayouts' || selectedTile === 'buttons') && (
                    <div className="p-8 animate-fadeIn">
                      <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center space-x-4">
                          <h3 className="text-lg font-semibold text-slate-800 uppercase tracking-widest">
                            {selectedTile === 'recordTypes' ? 'Record Type Usage' : 
                             selectedTile === 'validationRules' ? 'Validation Rules' : 
                             selectedTile.replace(/([A-Z])/g, ' $1')}
                          </h3>
                          {selectedTile === 'recordTypes' && (
                            <button
                              onClick={() => handleRetrieveObjectMetadata(selectedObject)}
                              className="p-2 text-[#2E2E38] hover:bg-[#FFE600]/10 rounded-lg transition-colors flex items-center space-x-2 text-xs font-bold uppercase tracking-widest"
                              title="Refresh counts from Salesforce"
                            >
                              <i className="fas fa-sync-alt"></i>
                              <span>Refresh Counts</span>
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        {(selectedTile === 'buttons' 
                          ? [...(relatedMetadata.buttons || []), ...(relatedMetadata.quickActions || [])].filter(item => item.name || item.label || item.MasterLabel)
                          : (relatedMetadata as any)[selectedTile] || []
                        ).map((item: any, idx: number) => {
                           const itemId = item.id || item.Id;
                           const isUnassigned = (selectedTile === 'layouts' && selectedObject.allAssignments && !selectedObject.allAssignments.some((asg: any) => 
                             asg.LayoutId === itemId || 
                             asg.LayoutId?.substring(0, 15) === itemId?.substring(0, 15) || 
                             asg.Layout?.Name === item.name ||
                             asg.Layout?.Name === (item.name ? item.name.substring(item.name.indexOf('-') + 1) : item.name)
                           )) || (selectedTile === 'flexiPages' && selectedObject.allFlexiPageAssignments && !selectedObject.allFlexiPageAssignments.some((asg: any) => 
                             asg.FlexiPageId === itemId || 
                             asg.FlexiPageId?.substring(0, 15) === itemId?.substring(0, 15) || 
                             asg.FlexiPage?.DeveloperName === item.name
                           ));

                           let similarRules: any[] = [];
                           if (selectedTile === 'validationRules') {
                              similarRules = (relatedMetadata.validationRules || []).filter((r: any) => 
                                r.id !== item.id && calculateMatchPercentage(item.content || '', r.content || '') > 70
                              );
                           }

                           let maxLayoutSimilarity = 0;
                           let similarityColorClass = 'text-slate-400 bg-slate-50 border-slate-100';
                           if ((selectedTile === 'layouts' || selectedTile === 'flexiPages') && (relatedMetadata as any)[selectedTile]) {
                             (relatedMetadata as any)[selectedTile].forEach((other: any) => {
                               if (other.id !== item.id) {
                                 const sim = calculateMatchPercentage(item.content || '', other.content || '');
                                 if (sim > maxLayoutSimilarity) maxLayoutSimilarity = sim;
                               }
                             });
                             if (maxLayoutSimilarity > 80) similarityColorClass = 'text-red-600 bg-red-50 border-red-100';
                             else if (maxLayoutSimilarity >= 50) similarityColorClass = 'text-amber-600 bg-amber-50 border-amber-100';
                             else similarityColorClass = 'text-emerald-600 bg-emerald-50 border-emerald-100';
                           }

                           let rtUsageInfo = null;
                           if (selectedTile === 'recordTypes' && selectedObject.recordTypeUsage) {
                              const usage = selectedObject.recordTypeUsage.find((u: any) => 
                                u.RecordTypeId === item.id || 
                                (u.RecordTypeId && item.id && u.RecordTypeId.substring(0, 15) === item.id.substring(0, 15))
                              );
                              if (usage) {
                                 const total = selectedObject.recordTypeUsage.reduce((acc: number, curr: any) => acc + curr.cnt, 0);
                                 rtUsageInfo = { count: usage.cnt, percent: (usage.cnt / total) * 100 };
                              }
                           }

                           return (
                            <div 
                              key={item.id || item.Id || `${selectedTile}-${idx}`} 
                              onClick={() => {
                                if (selectedTile === 'buttons') {
                                  setSelectedAction(item);
                                  setViewMode('actionDetail');
                                } else if (selectedTile === 'validationRules') {
                                  setSelectedField(item);
                                  setViewMode('fieldDetail');
                                  
                                  // Fetch full metadata at runtime if not already present
                                  if (sfService && (!item.ErrorConditionFormula || !item.ErrorMessage)) {
                                    sfService.fetchFullMetadata('ValidationRule', item.id || item.Id).then(async (fullRule) => {
                                      const updatedItem = {
                                        ...item,
                                        ...fullRule,
                                        ErrorConditionFormula: fullRule.ErrorConditionFormula || fullRule.Metadata?.errorConditionFormula,
                                        ErrorMessage: fullRule.ErrorMessage || fullRule.Metadata?.errorMessage,
                                        active: fullRule.Active !== undefined ? fullRule.Active : item.active
                                      };
                                      setSelectedField(updatedItem);
                                      
                                      // Persist to Firestore subcollection
                                      try {
                                        await fetch('/api/metadata/store', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({
                                            orgId: orgData?.orgId,
                                            category: 'objects',
                                            name: selectedObject.name,
                                            validationRules: [updatedItem]
                                          })
                                        });
                                      } catch (e) {
                                        console.error("Failed to persist full validation rule metadata", e);
                                      }
                                    }).catch(err => {
                                      console.error("Failed to fetch full validation rule metadata", err);
                                    });
                                  }
                                } else if (selectedTile === 'layouts') {
                                  setSelectedLayout(item);
                                  setViewMode('layoutDetail');
                                } else if (selectedTile === 'flexiPages') {
                                  setSelectedFlexiPage(item);
                                  setViewMode('flexiPageDetail');
                                }
                              }}
                              className={`p-6 bg-white border rounded-2xl shadow-sm hover:border-[#FFE600]/30 transition-all flex flex-col space-y-4 ${isUnassigned && selectedTile === 'layouts' ? 'bg-red-50 border-red-200' : (similarRules.length > 0 || isUnassigned ? 'bg-slate-50 border-slate-200' : 'border-slate-100')} ${['buttons', 'validationRules', 'layouts', 'flexiPages'].includes(selectedTile) ? 'cursor-pointer hover:shadow-md' : ''}`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-4">
                                  <div>
                                    <div className="flex items-center space-x-2">
                                      <p className="font-bold text-slate-900 text-lg">{item.label || item.name || item.MasterLabel || item.ValidationName || item.description || 'Unnamed Item'}</p>
                                      {selectedTile === 'validationRules' && (
                                        <div className="flex flex-col space-y-2 mt-1">
                                          <div className="flex items-center space-x-2">
                                            {(item.Active === false || item.active === false || item.Status === 'Inactive' || item.status === 'Inactive' || item.active === 'false' || item.Active === 'false') ? (
                                              <span className="px-2 py-0.5 bg-red-50 text-red-600 text-[10px] font-black uppercase tracking-widest rounded-lg border border-red-100 flex items-center shadow-sm">
                                                <i className="fas fa-exclamation-triangle mr-1.5"></i> Inactive
                                              </span>
                                            ) : (
                                              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest rounded-lg border border-emerald-100 flex items-center shadow-sm">
                                                <i className="fas fa-check-circle mr-1.5"></i> Active
                                              </span>
                                            )}
                                          </div>
                                          <p className="text-xs font-medium text-slate-600 line-clamp-2 bg-slate-50 p-2 rounded-lg border border-slate-100 italic">
                                            {item.errormessage || item.ErrorMessage || item.errorMessage || 'No error message defined'}
                                          </p>
                                        </div>
                                      )}
                                      {isUnassigned && (
                                        <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs font-semibold uppercase rounded flex items-center">
                                          <i className="fas fa-user-slash mr-1"></i> Unassigned
                                        </span>
                                      )}
                                      {similarRules.length > 0 && selectedTile !== 'validationRules' && (
                                        <span className="px-2 py-0.5 bg-amber-100 text-amber-600 text-xs font-semibold uppercase rounded">
                                          {similarRules.length} Similar Rules Found
                                        </span>
                                      )}
                                      {rtUsageInfo && (
                                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-600 text-xs font-semibold uppercase rounded">
                                          {rtUsageInfo.percent.toFixed(1)}% Data ({rtUsageInfo.count} records)
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (selectedTile === 'layouts' || selectedTile === 'flexiPages') {
                                      handleViewAssignments(item);
                                    } else if (selectedTile === 'buttons') {
                                      setSelectedAction(item);
                                      setViewMode('actionDetail');
                                    } else if (selectedTile === 'validationRules') {
                                      setSelectedField(item);
                                      setViewMode('fieldDetail');
                                    }
                                  }}
                                  className={`${selectedTile === 'recordTypes' || selectedTile === 'compactLayouts' ? 'hidden' : ''} text-[#2E2E38] text-sm font-bold uppercase tracking-widest hover:underline`}
                                >
                                  {selectedTile === 'layouts' || selectedTile === 'flexiPages' ? 'View Assignments' : 'View Details'}
                                </button>
                              </div>

                              {rtUsageInfo && rtUsageInfo.count > 50000 && (
                                <div className="p-3 bg-amber-50 rounded-xl border border-amber-100 flex items-center space-x-3">
                                  <i className="fas fa-database text-amber-500 text-xs"></i>
                                  <p className="text-xs text-amber-700 font-medium">Large record volume detected. Use indexed fields for queries.</p>
                                </div>
                              )}

                              {(isUnassigned && (selectedTile === 'layouts' || selectedTile === 'flexiPages')) && (
                                <div className="p-3 bg-red-50 rounded-xl border border-red-100 flex items-center space-x-3">
                                  <i className="fas fa-trash-alt text-red-500 text-sm"></i>
                                  <p className="text-xs text-red-700 font-bold uppercase tracking-widest">
                                    Note: This {selectedTile === 'layouts' ? 'layout' : 'lightning page'} is not used by any of the profiles. You can consider for deprecation.
                                  </p>
                                </div>
                              )}

                              {selectedTile === 'layouts' && maxLayoutSimilarity === 100 && (
                                <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start space-x-3">
                                  <i className="fas fa-trash-alt text-red-500 mt-0.5"></i>
                                  <div>
                                    <p className="text-[10px] font-bold text-red-700 uppercase tracking-widest">Optimization Suggestion</p>
                                    <p className="text-xs text-red-600 font-medium leading-relaxed">
                                      This layout is an exact match with the existing one. Therefore, you can consider this one for removal.
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                           );
                        })}
                        
                        {selectedTile === 'recordTypes' && recordTypeChartData.length > 0 && (
                          <div className="mt-12 p-8 bg-white border border-slate-100 rounded-[32px] shadow-sm">
                            <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-widest mb-6 text-center">Record Type Distribution</h3>
                            <div className="h-[400px] w-full">
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie
                                    data={recordTypeChartData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={80}
                                    outerRadius={120}
                                    paddingAngle={5}
                                    dataKey="value"
                                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(1)}%)`}
                                  >
                                    {recordTypeChartData.map((entry, index) => (
                                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                  </Pie>
                                  <Tooltip 
                                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                  />
                                  <Legend verticalAlign="bottom" height={36}/>
                                </PieChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        )}

                        {(!(relatedMetadata as any)[selectedTile] && selectedTile !== 'buttons') && (
                          <div className="p-20 text-center bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                            <p className="text-slate-400 text-sm font-medium">No {selectedTile} found for this object.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedTile === 'permissions' && (
                    <div className="p-8 animate-fadeIn">
                      <div className="flex items-center justify-between mb-8">
                        <h3 className="text-lg font-semibold text-slate-800 uppercase tracking-widest">Object Access Permissions</h3>
                        <div className="flex items-center space-x-4">
                          <div className="relative">
                            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                            <input
                              type="text"
                              placeholder="Search Profiles / Permission Sets..."
                              value={permissionsSearchTerm}
                              onChange={(e) => setPermissionsSearchTerm(e.target.value)}
                              className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 w-64"
                            />
                          </div>
                          <div className="text-xs font-semibold text-slate-400">{selectedObject.objectPermissions?.length || 0} Profiles/Permission Sets</div>
                        </div>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left">
                            <thead className="bg-slate-50 border-b border-slate-100">
                              <tr>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Profile/Permission Set</th>
                                <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-center text-[#2E2E38]">Read</th>
                                <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-center text-green-600">Create</th>
                                <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-center text-orange-600">Edit</th>
                                <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-center text-red-600">Delete</th>
                                <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-center text-purple-600">View All</th>
                                <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-center text-indigo-600">Modify All</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {selectedObject.objectPermissions?.filter((p: any) => {
                                let label = p.label || p.name || p.Parent?.Profile?.Name || p.Parent?.Label || p.Parent?.Name;
                                if (typeof label !== 'string') label = String(label || '');
                                const matchesSearch = label.toLowerCase().includes(permissionsSearchTerm.toLowerCase());
                                return label && matchesSearch;
                              }).map((perm: any, idx: number) => {
                                const renderLabel = perm.label || perm.name || perm.Parent?.Profile?.Name || perm.Parent?.Label || perm.Parent?.Name || 'Unknown';
                                return (
                                <tr key={perm.Id || perm.id || perm.Parent?.Name || `perm-${idx}`} className="hover:bg-slate-50 transition-colors">
                                  <td className="px-6 py-4 text-sm font-semibold text-slate-700">
                                    {perm.Parent?.IsOwnedByProfile ? (
                                      <div className="flex flex-col">
                                        <span className="text-[#2E2E38]">Profile: {renderLabel}</span>
                                        <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mt-0.5">Standard Profile Access</span>
                                      </div>
                                    ) : (
                                      <div className="flex flex-col">
                                        <span>{renderLabel}</span>
                                        <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mt-0.5">Permission Set Access</span>
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-4 text-center">{perm.PermissionsRead ? <i className="fas fa-check-circle text-[#2E2E38]"></i> : <i className="fas fa-times-circle text-slate-200"></i>}</td>
                                  <td className="px-4 py-4 text-center">{perm.PermissionsCreate ? <i className="fas fa-check-circle text-green-500"></i> : <i className="fas fa-times-circle text-slate-200"></i>}</td>
                                  <td className="px-4 py-4 text-center">{perm.PermissionsEdit ? <i className="fas fa-check-circle text-orange-500"></i> : <i className="fas fa-times-circle text-slate-200"></i>}</td>
                                  <td className="px-4 py-4 text-center">{perm.PermissionsDelete ? <i className="fas fa-check-circle text-red-500"></i> : <i className="fas fa-times-circle text-slate-200"></i>}</td>
                                  <td className="px-4 py-4 text-center">{perm.PermissionsViewAllRecords ? <i className="fas fa-check-circle text-purple-500"></i> : <i className="fas fa-times-circle text-slate-200"></i>}</td>
                                  <td className="px-4 py-4 text-center">{perm.PermissionsModifyAllRecords ? <i className="fas fa-check-circle text-indigo-500"></i> : <i className="fas fa-times-circle text-slate-200"></i>}</td>
                                </tr>
                              )})}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {selectedTile === 'limits' && (
                    <div className="p-8 animate-fadeIn">
                      <div className="flex items-center justify-between mb-8">
                        <h3 className="text-lg font-semibold text-slate-800 uppercase tracking-widest">Object Limits</h3>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {selectedObject.objectLimits?.map((limit: any, idx: number) => {
                          const max = limit.Max || 0;
                          const remaining = limit.Remaining || 0;
                          const consumed = max - remaining;
                          const percent = max > 0 ? Math.round((consumed / max) * 100) : 0;
                          const colorClass = percent > 80 ? 'bg-red-500' : percent > 50 ? 'bg-amber-500' : 'bg-[#FFE600]/100';
                          return (
                            <div key={limit.Type || limit.DurableId || idx} className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm">
                              <div className="flex justify-between items-center mb-4">
                                <p className="text-sm font-bold text-slate-700 uppercase tracking-widest">{limit.label || limit.name || limit.Type || 'Unknown Limit'}</p>
                                <p className="text-xs font-bold text-slate-400">{consumed} / {max}</p>
                              </div>
                              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div className={`h-full ${colorClass} transition-all duration-1000`} style={{ width: `${percent}%` }}></div>
                              </div>
                              <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-widest text-right">{percent}% CONSUMED</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {!selectedTile && (
                    <div className="p-8 animate-fadeIn">
                      <h3 className="text-lg font-semibold text-slate-800 mb-6 uppercase tracking-widest text-center">Schema Visualization</h3>
                      {selectedObject.mermaidCode ? (
                        <div className="flex flex-col items-center">
                          <button
                            onClick={() => handleDownloadDiagram(selectedObject.name)}
                            className="mb-4 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest rounded-md bg-purple-600 text-white shadow-sm hover:bg-purple-700 transition-all"
                          >
                            Download Diagram
                          </button>
                          <div ref={diagramRef}>
                            <MermaidRenderer chart={selectedObject.mermaidCode} />
                          </div>
                        </div>
                      ) : (
                        <div className="p-20 bg-slate-50 rounded-[40px] border border-dashed border-slate-200 text-center">
                          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-6 text-slate-300 shadow-sm">
                            <i className="fas fa-project-diagram text-2xl"></i>
                          </div>
                          <h4 className="font-semibold text-slate-800 mb-2">Diagram not generated</h4>
                          <p className="text-xs text-slate-500 max-w-xs mx-auto mb-8">Run "Retrieve Full Metadata" to generate the Mermaid schema diagram for this object.</p>
                          <button
                            onClick={() => handleRetrieveObjectMetadata(selectedObject)}
                            className="px-6 py-3 bg-purple-600 text-white font-semibold rounded-xl shadow-lg shadow-purple-500/20 hover:bg-purple-700 transition-all uppercase tracking-widest text-xs"
                          >
                            Generate Now
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {viewMode === 'assignments' && (
                <div className="p-8 animate-fadeIn">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="text-xl font-bold text-slate-800 uppercase tracking-widest">Page Assignments</h3>
                    <div className="text-xs font-bold text-slate-500">{assignments.length} Profiles Assigned</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="px-8 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Profile Name</th>
                          <th className="px-8 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Assigned Component</th>
                          {selectedTile === 'flexiPages' && (
                            <>
                              <th className="px-8 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Record Type</th>
                              <th className="px-8 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">App Name</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {assignments.length > 0 ? assignments.map((asg, idx) => (
                          <tr key={`${asg.Profile?.Name || ''}-${asg.LayoutId || asg.FlexiPageId || ''}-${idx}`} className="hover:bg-slate-50 transition-colors">
                            <td className="px-8 py-4 text-base font-bold text-slate-800">{asg.Profile?.Name || 'Unknown'}</td>
                            <td className="px-8 py-4 text-base text-slate-600 font-medium">{asg.Layout?.Name || asg.FlexiPage?.DeveloperName || asg.LayoutId || asg.FlexiPageId || 'N/A'}</td>
                            {selectedTile === 'flexiPages' && (
                              <>
                                <td className="px-8 py-4 text-base text-slate-600 font-medium">{asg.recordType || 'Master'}</td>
                                <td className="px-8 py-4 text-base text-slate-600 font-medium">{asg.appName || 'N/A'}</td>
                              </>
                            )}
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={2} className="px-8 py-12 text-center">
                              <div className="inline-flex flex-col items-center p-6 bg-amber-50 border border-amber-200 rounded-2xl">
                                <i className="fas fa-exclamation-circle text-amber-500 text-2xl mb-3"></i>
                                <p className="text-amber-800 font-semibold text-sm uppercase tracking-widest mb-1">No Assignments Found</p>
                                <p className="text-amber-600 text-xs italic">No direct assignments found via Tooling API for this component.</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {viewMode === 'layoutDetail' && selectedLayout && (
                <div className="p-8 animate-fadeIn">
                  <div className="mb-8">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-2xl font-semibold text-slate-800 tracking-tight">{selectedLayout.name}</h3>
                      <span className="px-3 py-1 bg-purple-100 text-purple-600 rounded-full text-xs font-semibold uppercase tracking-widest">
                        Page Layout
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-8">
                    <div className="col-span-2 space-y-8">
                      <div className="bg-white border border-slate-200 rounded-[32px] overflow-hidden shadow-sm">
                        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                          <h4 className="text-xs font-semibold text-slate-800 uppercase tracking-widest">Layout Similarities</h4>
                        </div>
                        <div className="p-6">
                          {isFetchingSimilarities ? (
                            <div className="py-12 text-center">
                              <div className="w-10 h-10 border-4 border-[#FFE600]/30 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                              <p className="text-slate-400 text-sm font-medium">Fetching similarities...</p>
                            </div>
                          ) : metadataSimilarities.length > 0 ? (
                            <div className="space-y-4">
                              {metadataSimilarities.map((sim, idx) => (
                                <div key={sim.id || sim.name || idx} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 group hover:border-[#FFE600]/30 transition-all">
                                  <div className="flex items-center space-x-4">
                                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-400 shadow-sm group-hover:text-[#2E2E38] transition-colors">
                                      <i className="fas fa-copy"></i>
                                    </div>
                                    <div>
                                      <p className="text-sm font-semibold text-slate-700">{sim.name}</p>
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <p className={`text-lg font-semibold ${sim.percent > 80 ? 'text-red-600' : sim.percent >= 50 ? 'text-amber-500' : 'text-emerald-600'}`}>
                                      {sim.percent.toFixed(1)}%
                                    </p>
                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Similarity</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="py-12 text-center">
                              <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-slate-200">
                                <i className="fas fa-ghost text-2xl"></i>
                              </div>
                              <p className="text-slate-400 text-sm font-medium">No similarities found with other layouts.</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-8">
                      <div className="bg-[#2E2E38] rounded-[32px] p-8 text-white shadow-xl">
                        <h4 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-6">Quick Actions</h4>
                        <div className="space-y-4">
                          <button 
                            onClick={() => handleViewAssignments(selectedLayout)}
                            className="w-full py-4 bg-white/10 hover:bg-white/20 rounded-2xl text-xs font-semibold uppercase tracking-widest transition-all flex items-center justify-center space-x-3"
                          >
                            <i className="fas fa-user-tag"></i>
                            <span>View Assignments</span>
                          </button>
                          <button 
                            onClick={() => {
                              setSelectedAction(selectedLayout);
                              setViewMode('actionDetail');
                            }}
                            className="w-full py-4 bg-purple-600 hover:bg-purple-700 rounded-2xl text-xs font-semibold uppercase tracking-widest transition-all flex items-center justify-center space-x-3 shadow-lg shadow-purple-500/20"
                          >
                            <i className="fas fa-wand-magic-sparkles"></i>
                            <span>AI Analysis</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {viewMode === 'flexiPageDetail' && selectedFlexiPage && (
                <div className="p-8 animate-fadeIn">
                  <div className="mb-8">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-2xl font-semibold text-slate-800 tracking-tight">{selectedFlexiPage.name}</h3>
                      <span className="px-3 py-1 bg-blue-100 text-[#2E2E38] rounded-full text-xs font-semibold uppercase tracking-widest">
                        Lightning Page
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-8">
                    <div className="col-span-2 space-y-8">
                      <div className="bg-white border border-slate-200 rounded-[32px] overflow-hidden shadow-sm">
                        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                          <h4 className="text-xs font-semibold text-slate-800 uppercase tracking-widest">Page Similarities</h4>
                        </div>
                        <div className="p-6">
                          {isFetchingSimilarities ? (
                            <div className="py-12 text-center">
                              <div className="w-10 h-10 border-4 border-[#FFE600]/30 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                              <p className="text-slate-400 text-sm font-medium">Fetching similarities...</p>
                            </div>
                          ) : metadataSimilarities.length > 0 ? (
                            <div className="space-y-4">
                              {metadataSimilarities.map((sim, idx) => (
                                <div key={sim.id || sim.name || idx} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 group hover:border-[#FFE600]/30 transition-all">
                                  <div className="flex items-center space-x-4">
                                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-400 shadow-sm group-hover:text-[#2E2E38] transition-colors">
                                      <i className="fas fa-copy"></i>
                                    </div>
                                    <div>
                                      <p className="text-sm font-semibold text-slate-700">{sim.name}</p>
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <p className={`text-lg font-semibold ${sim.percent > 80 ? 'text-red-600' : sim.percent >= 50 ? 'text-amber-500' : 'text-emerald-600'}`}>
                                      {sim.percent.toFixed(1)}%
                                    </p>
                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Similarity</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="py-12 text-center">
                              <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-slate-200">
                                <i className="fas fa-ghost text-2xl"></i>
                              </div>
                              <p className="text-slate-400 text-sm font-medium">No similarities found with other pages.</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-8">
                      <div className="bg-[#2E2E38] rounded-[32px] p-8 text-white shadow-xl">
                        <h4 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-6">Quick Actions</h4>
                        <div className="space-y-4">
                          <button 
                            onClick={() => handleViewAssignments(selectedFlexiPage)}
                            className="w-full py-4 bg-white/10 hover:bg-white/20 rounded-2xl text-xs font-semibold uppercase tracking-widest transition-all flex items-center justify-center space-x-3"
                          >
                            <i className="fas fa-user-tag"></i>
                            <span>View Assignments</span>
                          </button>
                          <button 
                            onClick={() => {
                              setSelectedAction(selectedFlexiPage);
                              setViewMode('actionDetail');
                            }}
                            className="w-full py-4 bg-[#FFE600] hover:bg-[#E5CF00] rounded-2xl text-xs font-semibold uppercase tracking-widest transition-all flex items-center justify-center space-x-3 shadow-lg shadow-[#FFE600]/30"
                          >
                            <i className="fas fa-wand-magic-sparkles"></i>
                            <span>AI Analysis</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {viewMode === 'fieldDetail' && selectedField && (
                <div className="p-8 animate-fadeIn">
                  <div className="max-w-4xl mx-auto">
                    <div className="bg-white border border-slate-200 rounded-[32px] overflow-hidden shadow-sm mb-8">
                      <div className="p-8 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                        <div>
                          <h3 className="text-2xl font-semibold text-slate-800 tracking-tight mb-1">{selectedField.label}</h3>
                          <p className="text-xs text-slate-400 font-mono tracking-widest">{selectedField.name}</p>
                        </div>
                      </div>
                      {selectedTile === 'fields' && (
                        <div className="p-8 space-y-8">
                          <div className="grid grid-cols-4 gap-8">
                            <div>
                              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Data Type</p>
                              <p className="text-sm font-semibold text-slate-800">{selectedField.type}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Usage %</p>
                              <p className="text-sm font-semibold text-slate-800">
                                {totalRecordCount && fieldRecordCount ? ((fieldRecordCount / totalRecordCount) * 100).toFixed(1) : 0}%
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-purple-400 uppercase tracking-widest mb-2">Records Using Field</p>
                              <p className="text-sm font-semibold text-purple-600">{fieldRecordCount !== null ? fieldRecordCount.toLocaleString() : '...'}</p>
                            </div>
                          </div>

                          {/* Deprecation Warning */}
                          {(() => {
                            const sixMonthsAgo = new Date();
                            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
                            const isOld = createdDate ? new Date(createdDate) < sixMonthsAgo : false;
                            const isUnused = fieldRecordCount === 0 && totalRecordCount !== null && totalRecordCount > 0;
                            
                            if (similarFields.length > 0 || isUnused || isOld) {
                              return (
                                <div className="p-6 bg-amber-50 border border-amber-100 rounded-[32px] flex items-start space-x-4">
                                  <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center shrink-0">
                                    <i className="fas fa-exclamation-triangle"></i>
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-semibold text-amber-800 uppercase tracking-widest mb-1">Potential Deprecation Candidate</h4>
                                    <p className="text-xs text-amber-700 leading-relaxed">
                                      {isUnused
                                        ? "This field has 0 records using it despite the object having data. It may be obsolete."
                                        : isOld 
                                          ? `This field was created on ${new Date(createdDate!).toLocaleDateString()} (over 6 months ago). It looks like if we are not using this field, we can remove it.`
                                          : `Found ${similarFields.length} fields with similar labels or API names. Consider merging or deprecating if they serve the same purpose.`}
                                    </p>
                                    {similarFields.length > 0 && (
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        {similarFields.map(f => (
                                          <span key={f.name} className="px-2 py-1 bg-white/50 border border-amber-200 rounded text-xs font-mono text-amber-800">
                                            {f.label} ({f.name})
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      )}

                      {selectedTile === 'validationRules' ? (() => {
                        const vrDetails = getValidationRuleDetails(selectedField.content);
                        const active = selectedField.Active !== undefined ? selectedField.Active : (selectedField.active !== undefined ? selectedField.active : vrDetails?.active);
                        const errorDisplayField = selectedField.ErrorDisplayField || vrDetails?.errorDisplayField;
                        const errorMessage = selectedField.errormessage || selectedField.ErrorMessage || selectedField.errorMessage || vrDetails?.errorMessage;
                        const formula = selectedField.validationformula || selectedField.ErrorConditionFormula || vrDetails?.errorConditionFormula || getFormulaFromContent(selectedField.content);
                        const description = selectedField.Description || vrDetails?.description;

                        return (
                          <div className="p-8 space-y-8">
                            <div className="grid grid-cols-3 gap-8">
                              <div>
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Status</p>
                                <div className="flex items-center space-x-2">
                                  <span className={`w-2.5 h-2.5 rounded-full ${active ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`}></span>
                                  <p className={`text-sm font-semibold ${active ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {active ? 'ACTIVE' : 'INACTIVE'}
                                  </p>
                                </div>
                              </div>
                              {errorDisplayField && (
                                <div>
                                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Error Display Field</p>
                                  <p className="text-sm font-semibold text-slate-800">{errorDisplayField}</p>
                                </div>
                              )}
                            </div>

                            {description && (
                              <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 shadow-sm">
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Description</p>
                                <p className="text-sm text-slate-600 leading-relaxed font-medium">{description}</p>
                              </div>
                            )}

                            <div>
                              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Error Message</p>
                              <div className="p-5 bg-red-50/50 border border-red-100 rounded-2xl">
                                <p className="text-sm font-semibold text-red-900 leading-snug">{errorMessage || 'No error message defined.'}</p>
                              </div>
                            </div>

                            <div className="p-8 bg-[#2E2E38] rounded-[40px] shadow-2xl relative overflow-hidden group">
                              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                                <i className="fas fa-shield-halved text-8xl text-white"></i>
                              </div>
                              <div className="relative z-10">
                                <div className="flex justify-between items-center mb-6">
                                  <div className="flex items-center space-x-3">
                                    <div className="w-8 h-8 bg-purple-500/20 rounded-lg flex items-center justify-center">
                                      <i className="fas fa-code text-purple-400 text-xs"></i>
                                    </div>
                                    <h4 className="text-xs font-semibold text-white/60 uppercase tracking-widest">Error Condition Formula</h4>
                                  </div>
                                  <button 
                                    onClick={() => {
                                      navigator.clipboard.writeText(formula || '');
                                      addNotification('Copied', 'Formula copied to clipboard', 'success');
                                    }}
                                    className="px-3 py-1 bg-white/5 text-white/40 rounded-full text-[10px] font-semibold uppercase tracking-widest border border-white/10 hover:bg-white/10 transition-colors"
                                  >
                                    <i className="fas fa-copy mr-2"></i>
                                    Copy Formula
                                  </button>
                                </div>
                                <pre className="text-sm font-mono text-purple-100 whitespace-pre-wrap break-all bg-black/40 p-8 rounded-3xl border border-white/5 shadow-inner leading-relaxed">
                                  {formula || 'Formula metadata not available. Please ensure full metadata is retrieved.'}
                                </pre>
                              </div>
                            </div>
                          </div>
                        );
                      })() : (
                        <>
                          {getFormulaFromContent(selectedField.content) && (
                            <div className="p-8 border-t border-slate-100 bg-purple-50/30">
                              <h4 className="text-xs font-semibold text-purple-600 uppercase tracking-widest mb-3">Formula Logic</h4>
                              <pre className="text-xs font-mono text-slate-700 whitespace-pre-wrap">
                                {getFormulaFromContent(selectedField.content)}
                              </pre>
                            </div>
                          )}
                        </>
                      )}

                      {selectedTile === 'validationRules' && metadataSimilarities.length > 0 && (
                        <div className="p-8 border-t border-slate-100 bg-slate-50/50">
                          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-6">Similar Validation Rules</h4>
                          <div className="space-y-4">
                            {metadataSimilarities
                              .filter(sim => {
                                const key = `${selectedField.id}-${sim.id}`;
                                const analysis = mergeAnalyses[key];
                                // If not analyzed yet, show it (loading)
                                // If analyzed and canMerge is true, show it
                                // If analyzed and canMerge is false, hide it
                                return !analysis || analysis.loading || analysis.canMerge;
                              })
                              .slice(0, 5).map((sim, idx) => {
                                const key = `${selectedField.id}-${sim.id}`;
                                const analysis = mergeAnalyses[key];

                                return (
                                  <div key={sim.id || sim.name || idx} className="flex flex-col bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
                                    <div className="flex items-center justify-between p-4 border-b border-slate-50">
                                      <div className="flex items-center space-x-3">
                                        <div className="w-8 h-8 bg-slate-50 text-slate-400 rounded-lg flex items-center justify-center text-xs">
                                          <i className="fas fa-shield-halved"></i>
                                        </div>
                                        <div>
                                          <p className="text-xs font-semibold text-slate-700">{sim.name}</p>
                                          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">{sim.percent.toFixed(1)}% Text Similarity</p>
                                        </div>
                                      </div>
                                      {analysis?.loading && (
                                        <div className="flex items-center space-x-2">
                                          <div className="w-3 h-3 border-2 border-[#FFE600]/30 border-t-transparent rounded-full animate-spin"></div>
                                          <span className="text-[10px] font-bold text-[#2E2E38] uppercase tracking-widest">Analyzing Merge...</span>
                                        </div>
                                      )}
                                    </div>
                                    
                                    {analysis && !analysis.loading && analysis.canMerge && (
                                      <div className="p-5 bg-emerald-50/30 space-y-4">
                                        <div className="flex items-start space-x-3">
                                          <div className="w-6 h-6 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center flex-shrink-0">
                                            <i className="fas fa-magic text-[10px]"></i>
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <p className="text-[11px] font-bold text-emerald-800 uppercase tracking-widest mb-2">AI Merge Suggestion</p>
                                            <div className="space-y-3 mb-4">
                                              {analysis.reasoning.split('\n\n').map((para, pIdx) => (
                                                <p key={pIdx} className="text-xs text-emerald-700 leading-relaxed max-w-3xl whitespace-pre-wrap break-words">
                                                  {para}
                                                </p>
                                              ))}
                                            </div>
                                            
                                            <div className="space-y-3">
                                              <div>
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Merged Error Message</p>
                                                <p className="p-3 bg-white border border-emerald-100 rounded-xl text-xs text-slate-700 font-medium italic leading-relaxed whitespace-pre-wrap">
                                                  "{analysis.mergedErrorMessage}"
                                                </p>
                                              </div>
                                              
                                              <div>
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Merged Formula</p>
                                                <pre className="p-3 bg-[#2E2E38] text-purple-200 rounded-xl text-[11px] font-mono overflow-x-auto border border-white/5 whitespace-pre-wrap break-all">
                                                  {analysis.mergedFormula}
                                                </pre>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      )}

                      {selectedField.content && selectedTile !== 'validationRules' && (
                        <div className="p-8 border-t border-slate-100">
                          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Metadata Content</h4>
                          <pre className="text-xs font-mono bg-[#2E2E38] text-slate-300 p-6 rounded-2xl overflow-x-auto max-h-96">
                            <code>{selectedField.content}</code>
                          </pre>
                        </div>
                      )}

                      {selectedTile !== 'validationRules' && (
                        <div className="p-8 border-t border-slate-100 bg-[#FFE600]/10/30">
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="font-semibold text-slate-800 text-sm">Where is this used?</h4>
                              <p className="text-xs text-slate-500 mt-1">Impact analysis across your Salesforce Org.</p>
                            </div>
                            <button 
                              onClick={() => {
                                setViewMode('dependencies');
                                if (scanResults.length === 0) handleDeepScan();
                              }}
                              className="px-6 py-3 bg-[#FFE600] text-[#2E2E38] font-semibold rounded-xl shadow-lg shadow-[#FFE600]/30 hover:bg-[#E5CF00] transition-all uppercase tracking-widest text-xs"
                            >
                              View Dependency Tree
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {viewMode === 'actionDetail' && selectedAction && (
                <div className="p-8 animate-fadeIn">
                  <div className="max-w-4xl mx-auto">
                    <div className="bg-white border border-slate-200 rounded-[32px] overflow-hidden shadow-sm mb-8">
                      {/* Header with Label and Flow Name (if applicable) */}
                      <div className="p-8 bg-slate-50 border-b border-slate-100">
                        <h3 className="text-2xl font-semibold text-slate-800 tracking-tight mb-1">{selectedAction.label || selectedAction.name}</h3>
                        <p className="text-xs text-slate-400 font-mono tracking-widest">{selectedAction.name}</p>
                        {selectedAction.flowName && (
                          <p className="text-sm text-[#2E2E38] font-semibold mt-2">Flow: {selectedAction.flowName}</p>
                        )}
                      </div>

                      {/* Tabs */}
                      <div className="flex border-b border-slate-200">
                        <button 
                          className={`px-8 py-4 text-sm font-bold uppercase tracking-widest ${actionActiveTab === 'summary' ? 'text-[#2E2E38] border-b-2 border-[#FFE600]' : 'text-slate-500 hover:text-slate-800'}`}
                          onClick={() => setActionActiveTab('summary')}
                        >
                          Summary
                        </button>
                        <button 
                          className={`px-8 py-4 text-sm font-bold uppercase tracking-widest ${actionActiveTab === 'diagram' ? 'text-[#2E2E38] border-b-2 border-[#FFE600]' : 'text-slate-500 hover:text-slate-800'}`}
                          onClick={() => setActionActiveTab('diagram')}
                        >
                          Flow Diagram
                        </button>
                      </div>
                      
                      <div className="p-8">
                        {actionActiveTab === 'summary' ? (
                          selectedAction.explanation ? (
                            <div className="markdown-body text-sm text-slate-700 leading-relaxed">
                              <ReactMarkdown>{selectedAction.explanation}</ReactMarkdown>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                              <i className="fas fa-circle-notch animate-spin text-3xl mb-4"></i>
                              <p className="text-xs font-semibold uppercase tracking-widest">Analyzing Action Logic...</p>
                            </div>
                          )
                        ) : (
                          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                            {/* Mermaid Diagram goes here */}
                            {selectedAction.mermaidCode ? (
                              <div className="flex flex-col items-center w-full">
                                <button
                                  onClick={() => handleDownloadDiagram(selectedAction.name)}
                                  className="mb-4 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest rounded-md bg-purple-600 text-white shadow-sm hover:bg-purple-700 transition-all"
                                >
                                  Download Diagram
                                </button>
                                <div ref={diagramRef}>
                                  <MermaidRenderer chart={selectedAction.mermaidCode} />
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs font-semibold uppercase tracking-widest">Analyzing Flow Diagram...</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {viewMode === 'dependencies' && selectedField && (
                <div className="p-8 animate-fadeIn">
                  <div className="max-w-4xl mx-auto">
                    <div className="flex items-center justify-between mb-8">
                      <div>
                        <h3 className="text-xl font-semibold text-slate-800 tracking-tight">Dependency Tree</h3>
                        <p className="text-xs text-slate-500 mt-1">Impact analysis for <span className="font-semibold text-[#2E2E38]">{selectedField.name}</span></p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between mb-4">
                        <button 
                          onClick={handleDeepScan}
                          disabled={isScanning}
                          className="px-6 py-3 bg-[#FFE600] text-[#2E2E38] font-semibold rounded-xl shadow-lg shadow-[#FFE600]/30 hover:bg-[#E5CF00] transition-all uppercase tracking-widest text-xs flex items-center space-x-2"
                        >
                          {isScanning ? (
                            <>
                              <i className="fas fa-circle-notch animate-spin"></i>
                              <span>Scanning Metadata...</span>
                            </>
                          ) : (
                            <>
                              <i className="fas fa-search"></i>
                              <span>Run Deep Scan (Word-by-Word)</span>
                            </>
                          )}
                        </button>
                      </div>

                      {selectedField && (scanResults.length > 0 || findDependencies(selectedField.name).length > 0) ? (
                        <div className="bg-slate-50 rounded-3xl p-8 border border-slate-200">
                          <div className="flex items-start space-x-4">
                            <div className="w-8 h-8 bg-[#FFE600] text-[#2E2E38] rounded-lg flex items-center justify-center shrink-0">
                              <i className="fas fa-database text-xs"></i>
                            </div>
                            <div className="flex-1">
                              <p className="font-semibold text-slate-800 text-sm uppercase tracking-widest mb-4">{selectedObject.name}</p>
                              
                              <div className="pl-8 border-l-2 border-slate-200 space-y-6 relative">
                                <div className="absolute top-0 left-0 w-4 h-0.5 bg-slate-200 -translate-x-full mt-2"></div>
                                <div className="flex items-center space-x-3">
                                  <div className="w-6 h-6 bg-blue-100 text-[#2E2E38] rounded flex items-center justify-center text-xs">
                                    <i className="fas fa-tag"></i>
                                  </div>
                                  <p className="text-sm font-semibold text-slate-700">{selectedField.name}</p>
                                </div>

                                <div className="pl-8 border-l-2 border-slate-200 space-y-4">
                                  {[...new Map([...findDependencies(selectedField.name), ...scanResults].map(item => [item.name, item])).values()].map((dep, idx) => {
                                        let explanation = null;
                                    try {
                                      if (fieldUsageSummary) {
                                        const summaryObj = JSON.parse(fieldUsageSummary);
                                        const expRaw = summaryObj[dep.name];
                                        if (expRaw) {
                                          if (typeof expRaw === 'string') {
                                            explanation = expRaw;
                                          } else if (typeof expRaw === 'object') {
                                            explanation = Object.values(expRaw).filter(val => typeof val === 'string').join(' ');
                                          } else {
                                            explanation = String(expRaw);
                                          }
                                        }
                                      }
                                    } catch (e) {}
                                    
                                    const isCodeComponent = ['classes', 'triggers', 'lwcs', 'vfPages'].includes(dep.category);
                                    const scanResult = scanResults.find(r => r.name === dep.name && r.category === dep.category);

                                    return (
                                    <div key={`${dep.category}-${dep.name}-${idx}`} className="flex items-start space-x-4 group">
                                      <div className="w-4 h-0.5 bg-slate-200 mt-6 -translate-x-full"></div>
                                      <div className="flex-1 p-4 bg-white border border-slate-100 rounded-2xl shadow-sm group-hover:border-[#FFE600]/30 transition-all">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center space-x-3">
                                            <div className="w-8 h-8 bg-slate-50 text-slate-400 rounded-lg flex items-center justify-center text-xs">
                                              <i className={`fas ${dep.category === 'classes' ? 'fa-code' : (dep.category === 'triggers' ? 'fa-bolt' : 'fa-file-code')}`}></i>
                                            </div>
                                            <div>
                                              <p className="text-xs font-semibold text-slate-800">
                                                {dep.category === 'classes' ? 'ApexClass' : dep.category === 'triggers' ? 'ApexTrigger' : dep.category === 'vfPages' ? 'VisualforcePage' : dep.category}: {dep.name}
                                              </p>
                                              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{dep.type}</p>
                                            </div>
                                          </div>
                                          <button 
                                            onClick={() => onNavigateToMetadata?.(dep.category as MetadataCategory, dep.name)}
                                            className="text-xs font-semibold text-[#2E2E38] uppercase tracking-widest hover:underline"
                                          >
                                            Navigate
                                          </button>
                                        </div>

                                        {isCodeComponent && scanResult && (
                                          <div className="mt-4">
                                            <div className="flex items-center justify-between mb-2">
                                              <p className="text-xs font-semibold text-[#2E2E38] uppercase tracking-widest">Code Snippet</p>
                                              <p className="text-xs font-mono text-slate-400">Line {scanResult.line}</p>
                                            </div>
                                            <pre className="text-xs font-mono bg-[#2E2E38] text-slate-300 p-3 rounded-lg whitespace-pre-wrap break-words">
                                              <code>{scanResult.snippet}</code>
                                            </pre>
                                          </div>
                                        )}

                                        {explanation && (
                                          <div className="mt-4 p-4 bg-emerald-50/50 rounded-xl border border-emerald-100/50">
                                            <div className="flex items-center space-x-2 mb-2">
                                              <i className="fas fa-robot text-emerald-500 text-xs"></i>
                                              <p className="font-semibold text-xs text-emerald-700 uppercase tracking-widest">Usage Reason</p>
                                            </div>
                                            <p className="text-xs text-slate-600 leading-relaxed italic border-l-2 border-emerald-200 pl-3">{explanation}</p>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )})}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="p-20 text-center bg-slate-50 rounded-[40px] border border-dashed border-slate-200">
                          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-6 text-slate-300 shadow-sm">
                            <i className="fas fa-search text-2xl"></i>
                          </div>
                          <h4 className="font-semibold text-slate-800 mb-2">No Dependencies Found</h4>
                          <p className="text-xs text-slate-500 max-w-xs mx-auto">Run a "Deep Scan" to search through all synced metadata content for references to this field.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {isFetchingFields && (
                <div className="p-20 text-center">
                  <div className="w-12 h-12 border-4 border-[#FFE600]/30 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
                  <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest">Pulling Schema fields...</p>
                </div>
              )}
            </div>
          </>
          )
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-12 text-center">
             <i className="fas fa-mouse-pointer text-5xl opacity-10 mb-6"></i>
             <h4 className="font-semibold text-slate-800 text-lg">Select an Object</h4>
             <p className="text-xs max-w-xs mt-3 font-medium text-slate-500">Choose a metadata entity from the explorer list to view field level security and attributes.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ObjectExplorer;
