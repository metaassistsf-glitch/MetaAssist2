
import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import MermaidRenderer from './MermaidRenderer';
import CodeEditor from './CodeEditor';
import FullScreenEditor from './FullScreenEditor';

import { SalesforceOrgData, MetadataCategory, SalesforceObject } from '../types';
import { auth } from '../firebase';
import { SalesforceService } from '../services/salesforceService';
import { explainMetadata, getCodeSuggestions } from '../services/geminiService';
import { getFieldsFromContent } from '../src/utils/metadataUtils';

interface Props {
  category: MetadataCategory;
  orgData: SalesforceOrgData;
  searchTerm: string;
  sfService: SalesforceService | null;
  onOrgDataUpdate: (data: SalesforceOrgData | ((prev: SalesforceOrgData | null) => SalesforceOrgData | null)) => void;
  onSyncAll: () => void;
  toast: { success: (msg: string) => void; error: (msg: string) => void; info: (msg: string) => void }; // Add toast prop
}

const MetadataExplorer: React.FC<Props> = ({ category, orgData, searchTerm, sfService, onOrgDataUpdate, onSyncAll, toast }) => {
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [isRetrievingIndividual, setIsRetrievingIndividual] = useState(false);

  const [activeTab, setActiveTab] = useState<'explanation' | 'content' | 'xml' | 'diagram' | 'permissions' | 'users' | 'assignments'>('explanation');
  const [activeLwcTab, setActiveLwcTab] = useState<'html' | 'js' | 'css'>('js');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const diagramRef = useRef<HTMLDivElement>(null);
  const [editedContent, setEditedContent] = useState<string>('');
  const [editedLwcFiles, setEditedLwcFiles] = useState<{ html?: string; js?: string; css?: string }>({});
  const [isDeploying, setIsDeploying] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string | null>(null);

  const canEdit = ['classes', 'triggers', 'vfPages', 'lwcs', 'permissionSets', 'profiles', 'validationRules', 'flexiPages'].includes(category);

  const handleDownloadDiagram = () => {
    const svgElement = diagramRef.current?.querySelector('svg');
    if (!svgElement) {
      toast.error('Could not find diagram to download');
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
      downloadLink.download = `${selectedItem.name || 'diagram'}_logic_flow.svg`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      
      toast.success('Diagram downloaded as SVG');
    } catch (err) {
      console.error('Download failed', err);
      toast.error('Failed to download diagram');
    }
  };

  const dataList: any[] = (orgData as any)[category] || [];
  const filteredList = dataList.filter(item => {
    const label = (item.label || item.name || '').toLowerCase();
    const name = (item.name || '').toLowerCase();
    const matchesSearch = label.includes((searchTerm || '').toLowerCase()) || name.includes((searchTerm || '').toLowerCase());
    const isMissingLabel = label.includes('missing label') || name.includes('missing label');
    return matchesSearch && !isMissingLabel;
  });

  const isProcessingRef = useRef<string | null>(null);

  const handleSelect = async (item: any) => {
    setSelectedItem(item);
    setActiveTab(item.mermaidCode ? 'diagram' : 'content');
    setAiSuggestions(null);
    
    const itemKey = `${category}-${item.id}`;
    if (isProcessingRef.current === itemKey) return;

    // If we have content but no explanation, or if we need to fetch everything
    if (!item.content || !item.explanation) {
      setLoadingDetails(true);
      isProcessingRef.current = itemKey;
      try {
        let content = item.content;
        let explanation = item.explanation;
        let mermaidCode = item.mermaidCode;
        let lwcFiles = item.lwcFiles;

        // 1. Try to fetch from local DB first if content is missing
        if (!content) {
          console.log(`DEBUG: Fetching from /api/metadata/${orgData.orgId}/${category}/${item.name || item.id}`);
          const res = await fetch(`/api/metadata/${orgData.orgId}/${category}/${item.name || item.id}`);
          if (res.ok) {
            const dbData = await res.json();
            content = dbData.content;
            explanation = dbData.explanation;
            mermaidCode = dbData.mermaidCode;
            lwcFiles = dbData.lwcFiles;
          }
        }

        // 2. If still no content, fetch from Salesforce
        if (!content && sfService) {
          const sfRes = await sfService.fetchMetadataContent(category, item.id);
          content = sfRes.content;
          lwcFiles = sfRes.lwcFiles;
          
          // Preserve extra fields for profiles/permissionSets
          if (category === 'profiles' || category === 'permissionSets') {
            (item as any).ObjectPermissions = sfRes.objectPermissions;
            (item as any).FieldPermissions = sfRes.fieldPermissions;
            (item as any).AssignedUsers = sfRes.assignedUsers;
          }

          // Preserve extra fields for validation rules
          if (category === 'validationRules') {
            (item as any).ErrorConditionFormula = sfRes.ErrorConditionFormula;
            (item as any).ErrorMessage = sfRes.ErrorMessage;
            (item as any).Active = sfRes.Active;
            (item as any).Metadata = sfRes.Metadata;
          }
        }

        // 3. If we have content but no explanation or mermaidCode, generate them
        if (content && (!explanation || !mermaidCode)) {
          const aiRes = await explainMetadata(category, item.name || item.id, content);
          explanation = aiRes.explanation;
          mermaidCode = aiRes.mermaidCode;

          // Save the new explanation to the DB
          const saveRes = await fetch('/api/metadata/update-explanation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orgId: orgData.orgId,
              category,
              name: item.name || item.id,
              explanation: aiRes
            })
          });

          if (!saveRes.ok) {
            const errorData = await saveRes.json();
            if (errorData.isQuotaExceeded) {
              toast.error(errorData.message);
            }
          }
        }

        // 4. Update state
        if (content) {
          if (category === 'objects') {
            const { fields, related } = getFieldsFromContent(content);
            const updatedObjects = orgData.objects.map(o => o.id === item.id ? { ...o, fields, relatedMetadata: related, content, explanation, mermaidCode } : o);
            onOrgDataUpdate({ ...orgData, objects: updatedObjects });
            setSelectedItem({ ...item, fields, relatedMetadata: related, content, explanation, mermaidCode });
          } else {
            const updatedList = (orgData as any)[category].map((o: any) => o.id === item.id ? { 
              ...o, 
              content, 
              explanation, 
              mermaidCode, 
              lwcFiles,
              ObjectPermissions: (item as any).ObjectPermissions,
              FieldPermissions: (item as any).FieldPermissions,
              AssignedUsers: (item as any).AssignedUsers
            } : o);
            onOrgDataUpdate({ ...orgData, [category]: updatedList });
            setSelectedItem({ 
              ...item, 
              content, 
              explanation, 
              mermaidCode, 
              lwcFiles,
              ObjectPermissions: (item as any).ObjectPermissions,
              FieldPermissions: (item as any).FieldPermissions,
              AssignedUsers: (item as any).AssignedUsers
            });
          }
          
          if (mermaidCode) setActiveTab('diagram');
          setEditedContent(content);
          if (lwcFiles) setEditedLwcFiles(lwcFiles);
        }
      } catch (e) {
        console.error("Detail pull failed", e);
      } finally {
        setLoadingDetails(false);
        isProcessingRef.current = null;
      }
    } else {
      setEditedContent(item.content);
      if (item.lwcFiles) setEditedLwcFiles(item.lwcFiles);
    }
  };

  const handleDeploy = async (contentToDeploy: string, lwcFilesToDeploy?: { html?: string, js?: string, css?: string }) => {
    if (!selectedItem) {
      console.error("No item selected for deployment");
      return;
    }
    if (!sfService) {
      console.error("Salesforce service not initialized");
      toast.error("Salesforce service not initialized. Please reconnect.");
      return;
    }
    
    console.log(`Initiating deployment for ${selectedItem.name} (${category})`);
    toast.info(`Initiating deployment for ${selectedItem.name}...`);
    setIsDeploying(true);
    try {
      await sfService.deployMetadata(category, selectedItem.id, contentToDeploy, lwcFilesToDeploy);
      console.log("Deployment successful");
      toast.success(`Successfully deployed ${selectedItem.name} to Salesforce!`);
      
      // Update local state and DB
      const updatedItem = { ...selectedItem, content: contentToDeploy, lwcFiles: lwcFilesToDeploy };
      if (category === 'objects') {
        const updatedObjects = orgData.objects.map(o => o.id === selectedItem.id ? updatedItem : o);
        onOrgDataUpdate({ ...orgData, objects: updatedObjects });
      } else {
        const updatedList = (orgData as any)[category].map((o: any) => o.id === selectedItem.id ? updatedItem : o);
        onOrgDataUpdate({ ...orgData, [category]: updatedList });
      }
      setSelectedItem(updatedItem);
      
      // Also save to DB
      await handleSave(contentToDeploy, lwcFilesToDeploy);
    } catch (e: any) {
      console.error("Deployment failed:", e);
      toast.error(`Deployment failed: ${e.message || "Unknown error"}`);
    } finally {
      setIsDeploying(false);
    }
  };

  const handleSave = async (contentToSave: string, lwcFilesToSave?: { html?: string, js?: string, css?: string }) => {
    if (!selectedItem || !orgData) return;
    try {
      await fetch('/api/metadata/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...selectedItem,
          orgId: orgData.orgId,
          category,
          metadataId: selectedItem.id,
          content: contentToSave,
          lwcFiles: lwcFilesToSave,
          name: selectedItem.name || selectedItem.label || selectedItem.id,
          explanation: selectedItem.explanation,
          mermaidCode: selectedItem.mermaidCode
        })
      });
      toast.success("Saved to local database.");
      
      // Update local state
      const updatedItem = { ...selectedItem, content: contentToSave, lwcFiles: lwcFilesToSave };
      if (category === 'objects') {
        const updatedObjects = orgData.objects.map(o => o.id === selectedItem.id ? updatedItem : o);
        onOrgDataUpdate({ ...orgData, objects: updatedObjects });
      } else {
        const updatedList = (orgData as any)[category].map((o: any) => o.id === selectedItem.id ? updatedItem : o);
        onOrgDataUpdate({ ...orgData, [category]: updatedList });
      }
      setSelectedItem(updatedItem);
    } catch (e: any) {
      toast.error("Failed to save to database.");
    }
  };

  const handleGetSuggestions = async (contentToReview: string, lwcFilesToReview?: { html?: string, js?: string, css?: string }, prompt?: string) => {
    if (!selectedItem) return "";
    setIsSuggesting(true);
    try {
      const finalContent = category === 'lwcs' ? JSON.stringify(lwcFilesToReview) : contentToReview;
      const suggestions = await getCodeSuggestions(category, selectedItem.name, finalContent, prompt);
      return suggestions;
    } catch (e: any) {
      console.error("Suggestions failed", e);
      toast.error("Failed to get AI suggestions.");
      return "Failed to get suggestions.";
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleRetrieveIndividual = async () => {
    if (!selectedItem || !sfService || !orgData) return;

    setIsRetrievingIndividual(true);
    try {
      const sfRes = await sfService.fetchMetadataContent(category, selectedItem.id);
      const content = sfRes.content;
      const lwcFiles = sfRes.lwcFiles;
      const metaXml = sfRes.metaXml;

      let fetchedAssignments: any[] = [];
      const objName = selectedItem.type || selectedItem.objectName || selectedItem.EntityDefinitionId;

      if (category === 'layouts' && objName) {
        try {
          const asgRes = await sfService.request(`/query?q=${encodeURIComponent(`SELECT Profile.Name, LayoutId, Layout.Name, RecordTypeId FROM ProfileLayout WHERE Layout.TableEnumOrId = '${objName}'`)}`, true);
          if (asgRes && asgRes.records) {
            fetchedAssignments = asgRes.records;
            // Update object in DB
            await fetch('/api/metadata/update-assignments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orgId: orgData.orgId,
                name: objName,
                type: 'layouts',
                assignments: fetchedAssignments,
                ownerUid: auth.currentUser?.uid
              })
            });
          }
        } catch (e) {
          console.warn("Layout assignments fetch failed", e);
        }
      } else if (category === 'flexiPages' && objName) {
        try {
          const fpAsgRes = await sfService.request(`/query?q=${encodeURIComponent(`SELECT Profile.Name, FlexiPageId, FlexiPage.DeveloperName, RecordType.DeveloperName FROM RecordTypeFlexiPageAssignment WHERE FlexiPage.EntityDefinitionId = '${objName}'`)}`, true);
          if (fpAsgRes && fpAsgRes.records) {
            fetchedAssignments = fpAsgRes.records.map((asg: any) => ({
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
            // Update object in DB
            await fetch('/api/metadata/update-assignments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orgId: orgData.orgId,
                name: objName,
                type: 'flexiPages',
                assignments: fetchedAssignments,
                ownerUid: auth.currentUser?.uid
              })
            });
          }
        } catch (e) {
          console.warn("FlexiPage assignments fetch failed", e);
        }
      }

      // Generate AI Explanation
      const { explanation, mermaidCode } = await explainMetadata(category, selectedItem.name || selectedItem.label || selectedItem.id, content);

      // Store in DB
      await fetch('/api/metadata/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: orgData.orgId,
          category,
          metadataId: selectedItem.id,
          content,
          lwcFiles,
          metaXml,
          explanation,
          mermaidCode,
          name: selectedItem.name || selectedItem.label || selectedItem.id,
          objectPermissions: sfRes.objectPermissions,
          fieldPermissions: sfRes.fieldPermissions,
          assignedUsers: sfRes.assignedUsers
        })
      });

      // Update local state
      if (category === 'objects') {
        const { fields, related } = getFieldsFromContent(content);
        const updatedObjects = orgData.objects.map(o => o.id === selectedItem.id ? { ...o, fields, relatedMetadata: related, content, explanation, mermaidCode, metaXml } : o);
        onOrgDataUpdate({ ...orgData, objects: updatedObjects });
        setSelectedItem({ ...selectedItem, fields, relatedMetadata: related, content, explanation, mermaidCode, metaXml });
      } else {
        // If we fetched assignments, update the object in local state too
        let updatedObjects = orgData.objects;
        if (fetchedAssignments.length > 0 && objName) {
          updatedObjects = orgData.objects.map(o => {
            if (o.name === objName || o.id === objName) {
              return category === 'layouts' 
                ? { ...o, allAssignments: fetchedAssignments }
                : { ...o, allFlexiPageAssignments: fetchedAssignments };
            }
            return o;
          });
        }

        const updatedList = (orgData as any)[category].map((o: any) => o.id === selectedItem.id ? { 
          ...o, 
          content, 
          explanation, 
          mermaidCode, 
          lwcFiles, 
          metaXml,
          ObjectPermissions: sfRes.objectPermissions,
          FieldPermissions: sfRes.fieldPermissions,
          AssignedUsers: sfRes.assignedUsers
        } : o);
        onOrgDataUpdate({ ...orgData, [category]: updatedList, objects: updatedObjects });
        setSelectedItem({ 
          ...selectedItem, 
          content, 
          explanation, 
          mermaidCode, 
          lwcFiles, 
          metaXml,
          ObjectPermissions: sfRes.objectPermissions,
          FieldPermissions: sfRes.fieldPermissions,
          AssignedUsers: sfRes.assignedUsers
        });
      }
      toast.success(`'${selectedItem.name || selectedItem.label || selectedItem.id}' retrieved from the source org!`);
    } catch (e: any) {
      console.error("Individual retrieval failed", e);
      toast.error(`Failed to retrieve '${selectedItem.name || selectedItem.label || selectedItem.id}': ${e.message}`);
    } finally {
      setIsRetrievingIndividual(false);
    }
  };

  const renderContent = () => {
    if (!selectedItem) return null;

    const commonHeader = (
      <div className="flex flex-col space-y-4">
        {category === 'layouts' && selectedItem && (() => {
          const isStandardLayout = (name: string) => {
            // Standard layouts usually follow the pattern "Object Name-Object Name Layout" or just "Object Name Layout"
            // The user said: "The object name will be followed by the layout word in it."
            const objName = selectedItem.type || ''; // type often stores TableEnumOrId
            const lowerName = name.toLowerCase();
            const lowerObj = objName.toLowerCase();
            return lowerName.includes('layout') && lowerName.includes(lowerObj) && !lowerName.includes('corporate') && !lowerName.includes('custom');
          };

          const currentIsStandard = isStandardLayout(selectedItem.name || '');
          
          // Only show optimization message on custom layouts
          if (!currentIsStandard) {
            const match = orgData.layouts.find(l => 
              l.id !== selectedItem.id && 
              l.content && 
              l.content === selectedItem.content &&
              isStandardLayout(l.name || '')
            );

            if (match) {
              return (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start space-x-3 animate-pulse">
                  <i className="fas fa-exclamation-triangle text-amber-500 mt-1"></i>
                  <div className="text-xs text-amber-800">
                    <p className="font-bold uppercase tracking-widest mb-1">Optimization Suggestion</p>
                    <p>This layout is an exact match with the existing one, which is the <strong>{match.name}</strong> layout.</p>
                    <p className="mt-1">Therefore, you can consider this one for removal to reduce technical debt.</p>
                  </div>
                </div>
              );
            }
          }
          return null;
        })()}
        <div className="flex items-center justify-between">
          <div className="flex space-x-1 p-1 bg-slate-100 rounded-lg w-fit">
          {['explanation', 'content', 'xml', 'diagram', 'assignments'].map((tab) => {
            if (tab === 'xml' && category !== 'objects') return null;
            if (tab === 'diagram' && !selectedItem.mermaidCode) return null;
            if (tab === 'assignments' && !['layouts', 'flexiPages'].includes(category)) return null;
            
            return (
              <button 
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest rounded-md transition-all ${activeTab === tab ? 'bg-white text-[#2E2E38] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {tab === 'explanation' ? 'AI Documentation' : 
                 tab === 'content' ? (category === 'objects' ? 'Fields' : 'Raw Content') :
                 tab === 'xml' ? 'XML Content' :
                 tab === 'diagram' ? 'Diagram' : 'Assignments'}
              </button>
            );
          })}
        </div>
        <div className="flex items-center space-x-2">
          {canEdit && (
            <button 
              onClick={() => setIsEditorOpen(true)}
              className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest rounded-md bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 transition-all flex items-center space-x-2"
            >
              <i className="fas fa-code"></i>
              <span>Open Editor</span>
            </button>
          )}
          {selectedItem.mermaidCode && activeTab === 'diagram' && (
            <button
              onClick={handleDownloadDiagram}
              className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest rounded-md bg-purple-600 text-white shadow-sm hover:bg-purple-700 transition-all"
            >
              Download Diagram
            </button>
          )}
          <button
            onClick={handleRetrieveIndividual}
            disabled={isRetrievingIndividual || loadingDetails}
            className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest rounded-md bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isRetrievingIndividual ? 'Retrieving...' : 'Retrieve Component'}
          </button>
        </div>
      </div>
    </div>
    );

    if (category === 'sharingSettings') {
      return (
        <div className="space-y-6">
          <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-800 mb-4 uppercase tracking-widest">Organization Sharing Settings</h3>
            <div className="grid grid-cols-2 gap-6">
              <div className="p-4 bg-slate-50 rounded-xl">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Account Access</p>
                <p className="text-sm font-semibold text-slate-700">{selectedItem.DefaultAccountAccess}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Contact Access</p>
                <p className="text-sm font-semibold text-slate-700">{selectedItem.DefaultContactAccess}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Lead Access</p>
                <p className="text-sm font-semibold text-slate-700">{selectedItem.DefaultLeadAccess}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Opportunity Access</p>
                <p className="text-sm font-semibold text-slate-700">{selectedItem.DefaultOpportunityAccess}</p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (category === 'licenses') {
      return (
        <div className="space-y-6">
          <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-800 mb-4 uppercase tracking-widest">User License Details</h3>
            <div className="grid grid-cols-3 gap-6">
              <div className="p-4 bg-[#FFE600]/10 rounded-xl">
                <p className="text-[10px] font-semibold text-[#FFE600] uppercase tracking-widest mb-1">Total Licenses</p>
                <p className="text-2xl font-semibold text-[#2E2E38]">{selectedItem.TotalLicenses}</p>
              </div>
              <div className="p-4 bg-emerald-50 rounded-xl">
                <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-widest mb-1">Used Licenses</p>
                <p className="text-2xl font-semibold text-emerald-600">{selectedItem.UsedLicenses}</p>
              </div>
              <div className="p-4 bg-orange-50 rounded-xl">
                <p className="text-[10px] font-semibold text-orange-400 uppercase tracking-widest mb-1">Remaining</p>
                <p className="text-2xl font-semibold text-orange-600">{selectedItem.TotalLicenses - selectedItem.UsedLicenses}</p>
              </div>
            </div>
            <div className="mt-6 p-4 bg-slate-50 rounded-xl flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">License Status</p>
                <p className="text-sm font-semibold text-slate-700">{selectedItem.Status}</p>
              </div>
              <i className="fas fa-id-card text-slate-200 text-2xl"></i>
            </div>
          </div>
        </div>
      );
    }

    if (category === 'profiles' || category === 'permissionSets') {
      return (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex space-x-1 p-1 bg-slate-100 rounded-lg w-fit">
              {['explanation', 'content', 'permissions', 'users'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab as any)}
                  className={`px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest rounded-md transition-all ${activeTab === tab ? 'bg-white text-[#2E2E38] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {tab === 'content' ? 'Raw XML' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleRetrieveIndividual}
                disabled={isRetrievingIndividual || loadingDetails}
                className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest rounded-md bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isRetrievingIndividual ? 'Retrieving...' : 'Retrieve Component'}
              </button>
            </div>
          </div>

          {/* Summary Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">User License</p>
              <p className="text-sm font-black text-slate-700 truncate">{selectedItem.UserLicense?.Name || selectedItem.UserLicenseId || 'Standard'}</p>
            </div>
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">User Type</p>
              <p className="text-sm font-black text-slate-700">{selectedItem.UserType || 'Standard'}</p>
            </div>
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Assigned Users</p>
              <p className="text-sm font-black text-slate-700">{selectedItem.AssignedUsers?.length || 0} Users</p>
            </div>
          </div>

          {activeTab === 'explanation' ? (
            <div className="prose prose-slate max-w-none">
              <div className="p-8 bg-[#FFE600]/10/30 rounded-[32px] border border-[#FFE600]/30/50">
                <div className="text-sm text-slate-700 leading-relaxed">
                  <ReactMarkdown>
                    {selectedItem.explanation || "No AI documentation generated yet. Click 'Retrieve Component' to generate."}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ) : activeTab === 'content' ? (
            <div className="space-y-4">
              <div className="p-6 bg-[#2E2E38] text-white rounded-[32px] font-mono text-[11px] leading-relaxed overflow-x-auto shadow-xl">
                <pre className="whitespace-pre-wrap">{selectedItem.content}</pre>
              </div>
            </div>
          ) : activeTab === 'permissions' ? (
            <div className="space-y-6">
              <div className="bg-white rounded-[32px] border border-slate-200 overflow-hidden shadow-sm">
                <div className="p-5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Object Permissions Matrix</h4>
                  <span className="text-[10px] font-bold text-slate-400 bg-white px-3 py-1 rounded-full border border-slate-100">
                    {selectedItem.ObjectPermissions?.length || 0} Objects
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50/50 border-b border-slate-100">
                      <tr>
                        <th className="px-6 py-3 font-black text-slate-400 uppercase tracking-tighter">Object</th>
                        <th className="px-4 py-3 font-black text-slate-400 uppercase tracking-tighter text-center">Read</th>
                        <th className="px-4 py-3 font-black text-slate-400 uppercase tracking-tighter text-center">Create</th>
                        <th className="px-4 py-3 font-black text-slate-400 uppercase tracking-tighter text-center">Edit</th>
                        <th className="px-4 py-3 font-black text-slate-400 uppercase tracking-tighter text-center">Delete</th>
                        <th className="px-4 py-3 font-black text-slate-400 uppercase tracking-tighter text-center">View All</th>
                        <th className="px-4 py-3 font-black text-slate-400 uppercase tracking-tighter text-center">Modify All</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {selectedItem.ObjectPermissions?.length > 0 ? selectedItem.ObjectPermissions.map((p: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-3 font-bold text-slate-700">{p.SobjectType}</td>
                          <td className="px-4 py-3 text-center">{p.PermissionsRead ? <i className="fas fa-check-circle text-green-500 text-sm"></i> : <i className="fas fa-times-circle text-slate-200 text-sm"></i>}</td>
                          <td className="px-4 py-3 text-center">{p.PermissionsCreate ? <i className="fas fa-check-circle text-green-500 text-sm"></i> : <i className="fas fa-times-circle text-slate-200 text-sm"></i>}</td>
                          <td className="px-4 py-3 text-center">{p.PermissionsEdit ? <i className="fas fa-check-circle text-green-500 text-sm"></i> : <i className="fas fa-times-circle text-slate-200 text-sm"></i>}</td>
                          <td className="px-4 py-3 text-center">{p.PermissionsDelete ? <i className="fas fa-check-circle text-green-500 text-sm"></i> : <i className="fas fa-times-circle text-slate-200 text-sm"></i>}</td>
                          <td className="px-4 py-3 text-center">{p.PermissionsViewAllRecords ? <i className="fas fa-check-circle text-green-500 text-sm"></i> : <i className="fas fa-times-circle text-slate-200 text-sm"></i>}</td>
                          <td className="px-4 py-3 text-center">{p.PermissionsModifyAllRecords ? <i className="fas fa-check-circle text-green-500 text-sm"></i> : <i className="fas fa-times-circle text-slate-200 text-sm"></i>}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={7} className="px-6 py-10 text-center text-slate-400 italic">No object permissions found or data not retrieved.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-[32px] border border-slate-200 overflow-hidden shadow-sm">
              <div className="p-5 bg-slate-50 border-b border-slate-100">
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Assigned Users</h4>
              </div>
              <div className="divide-y divide-slate-50">
                {selectedItem.AssignedUsers?.length > 0 ? selectedItem.AssignedUsers.map((u: any, i: number) => (
                  <div key={i} className="px-6 py-4 hover:bg-slate-50 transition-colors flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400">
                        <i className="fas fa-user"></i>
                      </div>
                      <div>
                        <p className="text-sm font-black text-slate-800">{u.Assignee?.Name || 'Unknown'}</p>
                        <p className="text-[10px] text-slate-400 font-mono tracking-tight">{u.Assignee?.Username || 'N/A'}</p>
                      </div>
                    </div>
                    <div className="px-3 py-1 bg-[#FFE600]/10 text-[#2E2E38] rounded-lg text-[10px] font-black uppercase tracking-widest border border-[#FFE600]/30">
                      Active
                    </div>
                  </div>
                )) : (
                  <div className="p-12 text-center text-slate-400 italic text-sm">
                    <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-200">
                      <i className="fas fa-users-slash text-xl"></i>
                    </div>
                    No users assigned or data not retrieved.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    if (category === 'validationRules') {
      return (
        <div className="space-y-6">
          {commonHeader}
          <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-slate-800 uppercase tracking-widest">Validation Rule Details</h3>
              <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${selectedItem.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {selectedItem.active ? 'Active' : 'Inactive'}
              </span>
            </div>
            
            <div className="space-y-6">
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Error Message</p>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-sm text-slate-700 italic">
                  "{selectedItem.errormessage || selectedItem.ErrorMessage || 'No error message defined'}"
                </div>
              </div>

              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Validation Formula</p>
                <div className="p-4 bg-[#2E2E38] text-blue-300 rounded-xl font-mono text-xs overflow-x-auto">
                  <pre className="whitespace-pre-wrap">{selectedItem.validationformula || selectedItem.ErrorConditionFormula || 'No formula defined'}</pre>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Error Location</p>
                  <p className="text-sm font-semibold text-slate-700">{selectedItem.ErrorDisplayField || 'Top of Page'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Object</p>
                  <p className="text-sm font-semibold text-slate-700">{selectedItem.objectName || selectedItem.EntityDefinitionId}</p>
                </div>
              </div>

              {selectedItem.Description && (
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Description</p>
                  <p className="text-sm text-slate-600">{selectedItem.Description}</p>
                </div>
              )}
            </div>
          </div>

          {activeTab === 'explanation' && (
            <div className="prose prose-slate max-w-none">
              <div className="p-6 bg-[#FFE600]/10/50 rounded-2xl border border-[#FFE600]/30/50">
                <div className="text-sm text-slate-700 leading-relaxed">
                  <ReactMarkdown>
                    {selectedItem.explanation || "No AI documentation generated yet. Click 'Retrieve Component' to generate."}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (category === 'objects') {
      return (
        <div className="space-y-6">
          {commonHeader}
          {activeTab === 'explanation' ? (
            <div className="prose prose-slate max-w-none">
              <div className="p-6 bg-[#FFE600]/10/50 rounded-2xl border border-[#FFE600]/30/50">
                <div className="text-sm text-slate-700 leading-relaxed">
                  <ReactMarkdown>
                    {selectedItem.explanation || "No AI documentation generated yet. Click 'Retrieve Component' to generate."}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ) : activeTab === 'xml' ? (
            <div className="p-4 bg-[#2E2E38] text-white rounded-xl font-mono text-[11px] leading-relaxed overflow-x-auto">
              <p className="text-[#FFE600] mb-2">// Object XML Content</p>
              <pre className="whitespace-pre-wrap">{selectedItem.content}</pre>
            </div>
          ) : activeTab === 'diagram' && selectedItem.mermaidCode ? (
            <div ref={diagramRef}>
              <MermaidRenderer chart={selectedItem.mermaidCode} />
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest border-b border-slate-100">
                  <th className="pb-3 px-2">Label</th>
                  <th className="pb-3 px-2">API Name</th>
                  <th className="pb-3 px-2">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {selectedItem.fields?.map((f: any) => (
                  <tr key={f.name} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-2 text-sm font-semibold text-slate-700">{f.label}</td>
                    <td className="py-2.5 px-2 text-[10px] font-mono text-slate-500">{f.name}</td>
                    <td className="py-2.5 px-2 text-[10px] font-semibold text-slate-400 uppercase">{f.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {commonHeader}
        <div className="grid grid-cols-2 gap-4 flex-1">
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Status</p>
            <p className="text-sm font-semibold text-slate-700">{selectedItem.status || 'N/A'}</p>
          </div>
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Type/Context</p>
            <p className="text-sm font-semibold text-slate-700">{selectedItem.type || 'System'}</p>
          </div>
        </div>

        {activeTab === 'explanation' ? (
          <div className="prose prose-slate max-w-none">
            <div className="p-6 bg-[#FFE600]/10/50 rounded-2xl border border-[#FFE600]/30/50">
              <div className="text-sm text-slate-700 leading-relaxed">
                <ReactMarkdown>
                  {selectedItem.explanation || "No AI documentation generated yet. Click 'Retrieve Component' to generate."}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        ) : activeTab === 'diagram' && selectedItem.mermaidCode ? (
          <div ref={diagramRef}>
            <MermaidRenderer chart={selectedItem.mermaidCode} />
          </div>
        ) : activeTab === 'assignments' ? (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="p-3 bg-slate-50 border-b border-slate-100">
                <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                  {category === 'layouts' ? 'Profile Layout Assignments' : 'FlexiPage Assignments'}
                </h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/50 border-b border-slate-100">
                    <tr>
                      <th className="px-4 py-2 font-semibold text-slate-400 uppercase tracking-tighter">Profile</th>
                      {category === 'layouts' ? (
                        <th className="px-4 py-2 font-semibold text-slate-400 uppercase tracking-tighter">Record Type</th>
                      ) : (
                        <>
                          <th className="px-4 py-2 font-semibold text-slate-400 uppercase tracking-tighter">App</th>
                          <th className="px-4 py-2 font-semibold text-slate-400 uppercase tracking-tighter">Record Type</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {(() => {
                      // Find the object this layout/flexipage belongs to
                      const objName = selectedItem.type || selectedItem.objectName || selectedItem.EntityDefinitionId;
                      const object = orgData.objects.find(o => o.name === objName || o.id === objName);
                      
                      if (!object) return <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400 italic">Object data not found. Please sync the object first.</td></tr>;

                      if (category === 'layouts') {
                        const assignments = (object as any).allAssignments?.filter((a: any) => {
                          const layoutId = a.LayoutId || '';
                          const selectedId = selectedItem.id || '';
                          return layoutId === selectedId || 
                                 (layoutId.length === 15 && selectedId.startsWith(layoutId)) ||
                                 (selectedId.length === 15 && layoutId.startsWith(selectedId)) ||
                                 a.Layout?.Name === selectedItem.name;
                        }) || [];
                        if (assignments.length === 0) return <tr><td colSpan={2} className="px-4 py-8 text-center text-slate-400 italic">No assignments found for this layout.</td></tr>;
                        
                        return assignments.map((a: any, i: number) => (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-2 font-semibold text-slate-700">{a.Profile?.Name || 'System Administrator'}</td>
                            <td className="px-4 py-2 text-slate-500 font-mono">{a.RecordTypeId || 'Master'}</td>
                          </tr>
                        ));
                      } else {
                        const assignments = (object as any).allFlexiPageAssignments?.filter((a: any) => {
                          const fpId = a.FlexiPageId || '';
                          const selectedId = selectedItem.id || '';
                          return fpId === selectedId || 
                                 (fpId.length === 15 && selectedId.startsWith(fpId)) ||
                                 (selectedId.length === 15 && fpId.startsWith(selectedId)) ||
                                 a.FlexiPage?.DeveloperName === selectedItem.name;
                        }) || [];
                        if (assignments.length === 0) return <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400 italic">No assignments found for this FlexiPage.</td></tr>;

                        return assignments.map((a: any, i: number) => (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-2 font-semibold text-slate-700">{a.Profile?.Name || 'All Profiles'}</td>
                            <td className="px-4 py-2 text-slate-500">{a.appName || 'All Apps'}</td>
                            <td className="px-4 py-2 text-slate-500 font-mono">{a.recordType || 'Master'}</td>
                          </tr>
                        ));
                      }
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {category === 'lwcs' && selectedItem.lwcFiles && (
              <div className="flex space-x-1 p-1 bg-slate-800 rounded-lg w-fit">
                <button 
                  onClick={() => setActiveLwcTab('js')}
                  className={`px-3 py-1 text-[9px] font-semibold uppercase tracking-widest rounded-md transition-all ${activeLwcTab === 'js' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  JS
                </button>
                <button 
                  onClick={() => setActiveLwcTab('html')}
                  className={`px-3 py-1 text-[9px] font-semibold uppercase tracking-widest rounded-md transition-all ${activeLwcTab === 'html' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  HTML
                </button>
                {selectedItem.lwcFiles.css && (
                  <button 
                    onClick={() => setActiveLwcTab('css')}
                    className={`px-3 py-1 text-[9px] font-semibold uppercase tracking-widest rounded-md transition-all ${activeLwcTab === 'css' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    CSS
                  </button>
                )}
              </div>
            )}
            {selectedItem.content ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[#FFE600] text-[11px] font-mono">// {category === 'lwcs' ? activeLwcTab.toUpperCase() : 'Raw Metadata'} Content</p>
                  {canEdit && (
                    <div className="flex space-x-2">
                      <button
                        onClick={() => {
                          setEditedContent(selectedItem.content || '');
                          if (category === 'lwcs') setEditedLwcFiles(selectedItem.lwcFiles || {});
                          setIsEditorOpen(true);
                        }}
                        className="px-4 py-1.5 bg-slate-800 text-white text-[10px] font-semibold uppercase tracking-widest rounded-lg hover:bg-[#2E2E38] transition-all shadow-sm"
                      >
                        <i className="fas fa-edit mr-2"></i>
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          const contentToDeploy = category === 'lwcs' ? (selectedItem.lwcFiles?.[activeLwcTab] || '') : selectedItem.content;
                          const lwcFilesToDeploy = category === 'lwcs' ? selectedItem.lwcFiles : undefined;
                          if (window.confirm(`Are you sure you want to deploy ${selectedItem.name} to the Salesforce Org? This will overwrite the existing version.`)) {
                            handleDeploy(contentToDeploy, lwcFilesToDeploy);
                          }
                        }}
                        disabled={isDeploying}
                        className="px-4 py-1.5 bg-[#FFE600] text-[#2E2E38] text-[10px] font-semibold uppercase tracking-widest rounded-lg hover:bg-[#E5CF00] transition-all shadow-sm disabled:opacity-50 flex items-center space-x-2"
                      >
                        {isDeploying ? (
                          <>
                            <i className="fas fa-circle-notch animate-spin"></i>
                            <span>Deploying...</span>
                          </>
                        ) : (
                          <>
                            <i className="fas fa-cloud-upload-alt"></i>
                            <span>Deploy to Org</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
                <div className="p-4 bg-[#2E2E38] text-white rounded-xl font-mono text-[11px] leading-relaxed overflow-x-auto">
                  <pre className="whitespace-pre-wrap">
                    {category === 'lwcs' && selectedItem.lwcFiles ? (selectedItem.lwcFiles[activeLwcTab] || '// File not available') : selectedItem.content}
                  </pre>
                </div>
              </div>
            ) : selectedItem.details && (
              <div className="p-4 bg-[#2E2E38] text-white rounded-xl font-mono text-[11px] leading-relaxed">
                <p className="text-[#FFE600] mb-2">// Metadata Details</p>
                <p>{selectedItem.details}</p>
              </div>
            )}
          </div>
        )} 
      </div>
    );
  };

  return (
    <div className="flex h-full space-x-6 animate-fadeIn">
      <div className="w-1/3 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">{category} ({filteredList.length})</span>
          <button 
            onClick={onSyncAll}
            className="px-3 py-1 bg-[#FFE600] text-[#2E2E38] text-[9px] font-semibold uppercase tracking-widest rounded-lg hover:bg-[#E5CF00] transition-all shadow-sm flex items-center space-x-1"
          >
            <i className="fas fa-sync-alt text-[8px]"></i>
            <span>Retrieve All</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {filteredList.map((item) => (
            <button
              key={item.id || item.name}
              onClick={() => handleSelect(item)}
              className={`w-full text-left px-5 py-3.5 border-b border-slate-50 transition-all ${
                selectedItem?.id === item.id ? 'bg-[#FFE600]/10 border-l-4 border-l-blue-600' : 'hover:bg-slate-50'
              }`}
            >
              {category === 'validationRules' ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-800 text-sm truncate">{item.name || item.ValidationName}</p>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${item.Active || item.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {item.Active || item.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 line-clamp-2 italic">"{item.errormessage || item.ErrorMessage || item.errorMessage || 'No error message defined'}"</p>
                </div>
              ) : (
                <>
                  <p className="font-semibold text-slate-800 text-sm truncate">{item.label || item.name}</p>
                  <p className="text-[10px] text-slate-400 font-mono truncate">{item.name}</p>
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
        {selectedItem ? (
          <div className="flex flex-col h-full">
            <div className="p-6 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-slate-800">{selectedItem.label || selectedItem.name}</h2>
                <span className="px-2 py-1 bg-slate-100 rounded text-[9px] font-semibold text-slate-500 uppercase tracking-tighter">
                  {selectedItem.status || selectedItem.type || 'Standard'}
                </span>
              </div>
              <p className="text-xs text-slate-500 font-mono mt-1">{selectedItem.name}</p>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {loadingDetails ? (
                <div className="flex flex-col items-center justify-center h-full space-y-4">
                  <div className="w-8 h-8 border-2 border-[#FFE600]/30 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-xs text-slate-500 font-semibold uppercase tracking-widest">{isRetrievingIndividual ? 'Retrieving component...' : 'Loading metadata from database...'}</p>
                </div>
              ) : renderContent()}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 space-y-2 opacity-50">
            <i className="fas fa-layer-group text-5xl mb-4"></i>
            <p className="font-semibold text-slate-800">Select an item to inspect</p>
            <p className="text-xs">Explore {category} metadata details on-demand.</p>
          </div>
        )}
      </div>
      
      {isEditorOpen && selectedItem && (
        <FullScreenEditor 
          isOpen={isEditorOpen}
          onClose={() => setIsEditorOpen(false)}
          category={category}
          name={selectedItem.name}
          initialContent={selectedItem.content || ''}
          initialLwcFiles={selectedItem.lwcFiles}
          onSave={handleSave}
          onDeploy={handleDeploy}
          getSuggestions={handleGetSuggestions}
        />
      )}
    </div>
  );
};

export default MetadataExplorer;
