import React, { useState, useEffect } from 'react';
import { SalesforceOrgData } from '../types';
import { GoogleGenAI } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import { useToast } from './Toast';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { SalesforceService } from '../services/salesforceService';

import { getStep1Prompt, getStep2Prompt, getStep3Prompt, getStep4Prompt, getRefinementPrompt } from '../utils/jiraDebuggerRules';

interface JiraDebuggerProps {
  orgData: SalesforceOrgData;
  sfService: SalesforceService | null;
}

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: any;
    issuetype: { name: string; iconUrl: string };
    status: { name: string; statusCategory: { colorName: string } };
    updated: string;
    attachment?: any[];
  }
}

export const formatToMarkdown = (val: any): string => {
  if (!val) return '';
  let obj = val;
  if (typeof val === 'string') {
    try {
      obj = JSON.parse(val);
    } catch(e) {
      // not json, just use as string
      return val;
    }
  }
  
  if (typeof obj === 'object') {
    try {
      return Object.entries(obj).map(([k, v]) => {
        if (Array.isArray(v)) {
          return `**${k}**:\n${v.map((item: any) => `- ${item}`).join('\n')}`;
        }
        if (typeof v === 'object') {
            return `**${k}**:\n${JSON.stringify(v, null, 2)}`;
        }
        return `**${k}**: ${v}`;
      }).join('\n\n');
    } catch (e) {
      return JSON.stringify(obj, null, 2);
    }
  }
  return String(obj);
};

export const extractADFText = (desc: any): string => {
  if (!desc) return 'No content provided.';
  if (typeof desc === 'string') return desc;
  if (desc.type === 'doc' && Array.isArray(desc.content)) {
    const extractText = (nodes: any[]): string => {
      let text = '';
      for (const node of nodes) {
        if (node.type === 'text') text += (node.text || '');
        if (node.type === 'paragraph') text += '\n';
        if (node.content) text += extractText(node.content);
      }
      return text.trim();
    };
    return extractText(desc.content);
  }
  return JSON.stringify(desc, null, 2);
};

const JiraDebugger: React.FC<JiraDebuggerProps> = ({ orgData, sfService }) => {
  const { toast } = useToast();
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<JiraIssue | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [issueType, setIssueType] = useState('Story');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [designPlan, setDesignPlan] = useState<string | null>(null);
  const [designNotes, setDesignNotes] = useState<string>('');
  const [isDesigning, setIsDesigning] = useState(false);
  const [designingState, setDesigningState] = useState<string>('');
  const [isUpdatingJira, setIsUpdatingJira] = useState(false);
  const [fieldNames, setFieldNames] = useState<Record<string, string>>({});

  // Interaction State
  const [refinementInput, setRefinementInput] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'model', text: string }[]>([{ 
    role: 'model', 
    text: 'Hello Architect. I am your Salesforce Architecture Copilot. I have analyzed this Jira issue and drafted the initial design notes. How can we refine this further? I am here to ensure our solution remains scalable, secure, and follows a "Clicks before Code" philosophy.' 
  }]);

  useEffect(() => {
    fetchIssues();
  }, [issueType]);

  const fetchIssues = async (search = searchTerm) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/jira/stories?type=${encodeURIComponent(issueType)}&search=${encodeURIComponent(search)}&_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Failed to fetch Jira issues');
      }
      const data = await resp.json();
      if (data.names) {
        setFieldNames(data.names);
      }
      if (data.issues) {
        setIssues(data.issues);
      } else {
        setIssues([]);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchIssues(searchTerm);
  };

  const generateDesign = async (issue: JiraIssue) => {
    setIsDesigning(true);
    setDesignPlan(null);
    setDesignNotes('');
    setDesigningState('');
    try {
      // Setup Gemini call
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const descStr = extractADFText(issue.fields.description);
      const acStr = getAcceptanceCriteria(issue) || 'None provided.';
      
      const baseDetails = `I have a Jira ${issue.fields.issuetype.name} with the following details:\nKey: ${issue.key}\nSummary: ${issue.fields.summary}\nDescription: ${descStr}\nAcceptance Criteria: ${acStr}`;

      const attachments: any[] = [];
      setDesigningState('Fetching attachments...');
      if (issue.fields.attachment && issue.fields.attachment.length > 0) {
        for (const att of issue.fields.attachment) {
          try {
            if (att.mimeType?.startsWith('image/')) {
              const res = await fetch(`/api/jira/attachment?url=${encodeURIComponent(att.content)}`);
              if (res.ok) {
                const blob = await res.blob();
                const base64Url = await new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result as string);
                  reader.readAsDataURL(blob);
                });
                const base64 = base64Url.split(',')[1];
                attachments.push({
                  inlineData: {
                    data: base64,
                    mimeType: att.mimeType || blob.type
                  }
                });
              }
            } else if (att.mimeType?.startsWith('text/') || att.mimeType === 'application/json' || att.filename.endsWith('.txt') || att.filename.endsWith('.json') || att.filename.endsWith('.csv') || att.filename.endsWith('.js') || att.filename.endsWith('.html') || att.filename.endsWith('.css') || att.filename.endsWith('.xml') || att.filename.endsWith('.cls') || att.filename.endsWith('.trigger') || att.filename.endsWith('.page') || att.filename.endsWith('.cmp')) {
              const res = await fetch(`/api/jira/attachment?url=${encodeURIComponent(att.content)}`);
              if (res.ok) {
                const text = await res.text();
                attachments.push({ text: `\n\n--- Attachment: ${att.filename} ---\n${text}\n--- End of Attachment ---\n` });
              }
            }
          } catch(e) {
            console.error('Failed to process attachment', att.filename, e);
          }
        }
      }

      // Step 1: Entry Point Identification
      setDesigningState('Identifying entry points and evaluating requirements...');
      const step1Prompt = getStep1Prompt(baseDetails);

      const step1Contents = [{ text: step1Prompt }, ...attachments];
      const step1Response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: step1Contents
      });
      const entryPoints = step1Response.text || '';

      // --- NEW FEATURE: Try to dynamically pull component code if we identified it ---
      let resolvedCodeContext = '';
      if (sfService) {
        setDesigningState('Fetching associated Salesforce components...');
        try {
          const extractionPrompt = `Parse the following entry points and return a JSON array of the explicit Salesforce components identified. 
Only output valid JSON in this format: [{"type": "lwcs"|"classes"|"vfPages"|"triggers"|"flows", "name": "ExactComponentName"}]. 
Output ONLY the JSON and nothing else. If none, return [].\n\nEntry points:\n${entryPoints}`;
          const extRes = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ text: extractionPrompt }]
          });
          const extText = extRes.text?.replace(/```json/g, '').replace(/```/g, '').trim() || '[]';
          const identifiedComps = JSON.parse(extText);
          
          for (const comp of identifiedComps) {
            try {
              const result = await sfService.fetchMetadataContent(comp.type, comp.name);
              const code = result.content;
              resolvedCodeContext += `\n\n--- Source Code for ${comp.type}: ${comp.name} ---\n${code}\n`;
            } catch (err) {
              console.warn(`Could not fetch ${comp.name}`, err);
            }
          }
        } catch (err) {
          console.warn('Failed to extract and fetch components automatically', err);
        }
      }

      // Step 2: Backtracking to Backend Components
      setDesigningState('Backtracking from UI to Backend logic...');
      const step2Context = resolvedCodeContext ? `${baseDetails}\n\n${resolvedCodeContext}` : baseDetails;
      const step2Prompt = getStep2Prompt(step2Context, entryPoints);

      const step2Response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ text: step2Prompt }, ...attachments]
      });
      let backendComponents = step2Response.text || entryPoints;

      // --- TRY FETCHING BACKEND COMPONENTS TOO BEFORE STEP 3 ---
      if (sfService) {
        setDesigningState('Fetching backend Salesforce components...');
        try {
          const extractionPrompt2 = `Parse the following Backend Components and return a JSON array of the explicit Salesforce components identified. 
Only output valid JSON in this format: [{"type": "lwcs"|"classes"|"vfPages"|"triggers"|"flows", "name": "ExactComponentName"}]. 
Output ONLY the JSON and nothing else. If none, return [].\n\nBackend Components:\n${backendComponents}`;
          const extRes2 = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ text: extractionPrompt2 }]
          });
          const extText2 = extRes2.text?.replace(/```json/g, '').replace(/```/g, '').trim() || '[]';
          const identifiedComps2 = JSON.parse(extText2);
          
          for (const comp of identifiedComps2) {
             // Don't re-fetch if we already have it
            if (!resolvedCodeContext.includes(`Source Code for ${comp.type}: ${comp.name}`)) {
              try {
                const result = await sfService.fetchMetadataContent(comp.type, comp.name);
                const code = result.content;
                resolvedCodeContext += `\n\n--- Source Code for ${comp.type}: ${comp.name} ---\n${code}\n`;
              } catch (err) {
                console.warn(`Could not fetch backend component ${comp.name}`, err);
              }
            }
          }
        } catch (err) {
          console.warn('Failed to extract and fetch backend components automatically', err);
        }
      }

      // Step 3: Layer Analysis
      setDesigningState('Analyzing implementation layers...');
      const step3Context = resolvedCodeContext ? `${baseDetails}\n\n${resolvedCodeContext}` : baseDetails;
      const step3Prompt = getStep3Prompt(step3Context, entryPoints, backendComponents);

      const step3Response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ text: step3Prompt }, ...attachments]
      });
      const layerAnalysis = step3Response.text || '';

      // Step 4: Final Design Notes
      setDesigningState('Formulating final design notes...');
      const step4Prompt = getStep4Prompt(baseDetails, layerAnalysis);

      const step4Response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ text: step4Prompt }]
      });
      const finalNotes = step4Response.text || '';

      const finalAnalysisMarkdown = formatToMarkdown(layerAnalysis);
      const finalNotesMarkdown = formatToMarkdown(finalNotes);

      setDesignPlan(finalAnalysisMarkdown);
      setDesignNotes(finalNotesMarkdown);
      setChatHistory(prev => [
        ...prev, 
        { role: 'model', text: `Initial design drafted for **${issue.key}**. You can review the notes above and suggest any architectural refinements here.` }
      ]);

      // Save analysis to Firestore
      if (orgData?.orgId) {
        try {
          const docRef = doc(db, 'orgs', orgData.orgId, 'jira_analyses', issue.key);
          await setDoc(docRef, {
            issueKey: issue.key,
            designPlan: finalAnalysisMarkdown,
            designNotes: finalNotesMarkdown,
            ownerUid: auth.currentUser?.uid || '',
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `/orgs/${orgData.orgId}/jira_analyses/${issue.key}`);
        }
      }
    } catch (e: any) {
      toast({
        title: 'Design Generation Failed',
        message: e.message,
        type: 'error'
      });
    } finally {
      setIsDesigning(false);
      setDesigningState('');
    }
  };

  const updateJiraStory = async (issue: JiraIssue, plan: string) => {
    if (!plan || plan.trim() === '') {
      toast({
        title: 'Empty Design Notes',
        message: 'Please provide design notes before updating Jira.',
        type: 'error'
      });
      return;
    }
    
    setIsUpdatingJira(true);
    let designNotesFieldKey: string | null = null;
    
    // Find the custom field key for "Design Notes"
    for (const [key, name] of Object.entries(fieldNames)) {
      if (name.toLowerCase().includes('design notes')) {
        designNotesFieldKey = key;
        break;
      }
    }

    try {
      if (designNotesFieldKey) {
        // Prepare simple string assignment
        const payload: any = {};
        payload[designNotesFieldKey] = plan; 

        let resp = await fetch(`/api/jira/stories/${issue.key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: payload })
        });
        
        if (!resp.ok) {
           const errResp = await resp.json();
           const errorMsg = errResp.error || "Failed to edit Jira issue fields";
           
           // If error mentions ADF expected, retry with ADF format
           if (errorMsg.includes('Atlassian Document') || errorMsg.includes('String') || errorMsg.includes('expected')) {
               const adfPayload: any = {};
               const contentBlocks = plan.split('\n').filter(line => line.trim() !== '').map(line => {
                 const lineContent = [];
                 const parts = line.split(/(\*\*.*?\*\*)/g);
                 for (const part of parts) {
                   if (!part) continue;
                   if (part.startsWith('**') && part.endsWith('**')) {
                     lineContent.push({
                       type: 'text',
                       text: part.slice(2, -2),
                       marks: [{ type: 'strong' }]
                     });
                   } else {
                     lineContent.push({
                       type: 'text',
                       text: part
                     });
                   }
                 }
                 return {
                   type: "paragraph",
                   content: lineContent.length ? lineContent : [{ type: "text", text: " " }]
                 };
               });

               adfPayload[designNotesFieldKey] = {
                  "version": 1,
                  "type": "doc",
                  "content": contentBlocks.length ? contentBlocks : [{ type: "paragraph", content: [{ type: "text", text: " " }] }]
               };
               resp = await fetch(`/api/jira/stories/${issue.key}`, {
                 method: 'PUT',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ fields: adfPayload })
               });
               
               if (!resp.ok) {
                  const retryErrResp = await resp.json();
                  throw new Error(retryErrResp.error || "Failed to edit Jira with ADF format");
               }
           } else {
             throw new Error(errorMsg);
           }
        }
      } else {
        // Fallback to comment
        const resp = await fetch(`/api/jira/stories/${issue.key}/comment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: `*Design Document Notes*\n\n${plan}` })
        });
        if (!resp.ok) {
          const errorData = await resp.json();
          throw new Error(errorData.error || 'Failed to post comment to Jira');
        }
      }
      
      // refresh story to show latest data without clearing ui state
      await handleIssueSelect(issue, true);

      toast({
        title: 'Success',
        message: designNotesFieldKey ? 'Successfully updated Design Notes field.' : 'Successfully added design document as comment.',
        type: 'success'
      });
    } catch (e: any) {
      toast({
        title: 'Update failed',
        message: e.message,
        type: 'error'
      });
    } finally {
      setIsUpdatingJira(false);
    }
  };

  const handleIssueSelect = async (issue: JiraIssue, isRefresh = false) => {
    setSelectedIssue(issue);
    if (!isRefresh) {
      setDesignPlan(null);
      setDesignNotes('');
      setChatHistory([{ 
        role: 'model', 
        text: 'Hello Architect. I am your Salesforce Architecture Copilot. I have analyzed this Jira issue and drafted the initial design notes. How can we refine this further? I am here to ensure our solution remains scalable, secure, and follows a "Clicks before Code" philosophy.' 
      }]);
      setRefinementInput('');
    }
    
    // Attempt to load existing analysis from DB
    if (!isRefresh && orgData?.orgId) {
      try {
        const docRef = doc(db, 'orgs', orgData.orgId, 'jira_analyses', issue.key);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.designPlan) setDesignPlan(formatToMarkdown(data.designPlan));
          if (data.designNotes) setDesignNotes(formatToMarkdown(data.designNotes));
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `/orgs/${orgData.orgId}/jira_analyses/${issue.key}`);
      }
    }

    try {
      const resp = await fetch(`/api/jira/stories/${issue.key}`);
      if (resp.ok) {
        const fullIssue = await resp.json();
        // If names are returned in the single issue payload, use them
        if (fullIssue.names) {
          setFieldNames(prev => ({...prev, ...fullIssue.names}));
        }
        setSelectedIssue(fullIssue);
      }
    } catch (e) {
      console.error("Failed to fetch full issue details", e);
    }
  };

  const getAcceptanceCriteria = (issue: JiraIssue) => {
    // Find custom field with name like "Acceptance Criteria"
    for (const [key, name] of Object.entries(fieldNames)) {
      if (name.toLowerCase().includes('acceptance criteria')) {
        const val = (issue.fields as any)[key];
        if (val) return extractADFText(val);
      }
    }
    return null;
  };

  const cleanDesignNotes = (text: string): string => {
    if (!text) return '';
    // Look for the start of the structured list or the section title
    // Priority 1: The actual bulleted list
    const listPattern = /(-?\s*\*\*Components Involved\*\*[\s\S]*)/i;
    const match = text.match(listPattern);
    
    if (match) {
      let cleaned = match[1].trim();
      // If result starts with a title like "### Revised Design Notes", we might want to keep it or strip it.
      // The user wants the implementation details.
      return cleaned;
    }
    
    // Priority 2: Segment after common preamble phrases
    const splitters = [
      'Here are the revised Design Notes:',
      'Here is the revised design:',
      'REVISED DESIGN NOTES:',
      'Design Notes:'
    ];
    
    for (const splitter of splitters) {
      if (text.includes(splitter)) {
        return text.split(splitter)[1].trim();
      }
    }

    return text;
  };

  const handleRefineDesign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refinementInput.trim() || !selectedIssue || isRefining) return;

    const userInput = refinementInput.trim();
    setRefinementInput('');
    setIsRefining(true);
    
    // Add user message to local history
    const newHistory = [...chatHistory, { role: 'user' as const, text: userInput }];
    setChatHistory(newHistory);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      let additionalCodeContext = '';
      if (sfService) {
        try {
          const extractionPrompt = `Parse the following user request and return a JSON array of any explicit Salesforce components mentioned that need analyzing or fetching. 
Only output valid JSON in this format: [{"type": "lwcs"|"classes"|"vfPages"|"triggers"|"flows", "name": "ExactComponentName"}]. 
Output ONLY the JSON and nothing else. If none, return [].\n\nUser Request:\n${userInput}`;
          const extRes = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ text: extractionPrompt }]
          });
          const extText = extRes.text?.replace(/```json/g, '').replace(/```/g, '').trim() || '[]';
          let identifiedComps: any[] = [];
          try {
            identifiedComps = JSON.parse(extText);
          } catch (e) {
            console.warn('Failed to parse identified components JSON', e);
          }
          
          for (const comp of identifiedComps) {
            try {
              const result = await sfService.fetchMetadataContent(comp.type, comp.name);
              const code = result.content;
              additionalCodeContext += `\n\n--- Source Code for ${comp.type}: ${comp.name} ---\n${code}\n`;
            } catch (err) {
              console.warn(`Could not fetch ${comp.name}`, err);
            }
          }
        } catch (err) {
          console.warn('Failed to extract components from refinement query', err);
        }
      }

      const descStr = extractADFText(selectedIssue.fields.description);
      const acStr = getAcceptanceCriteria(selectedIssue) || 'None provided.';
      
      let systemContext = getRefinementPrompt(selectedIssue, descStr, acStr, designPlan || '', designNotes || '');

      if (additionalCodeContext) {
        systemContext += `\n\nAdditional Source Code dynamically fetched based on user request:\n${additionalCodeContext}\n\nPlease analyze this code thoroughly before providing suggestions to the architect.`;
      }

      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          ...chatHistory.map(h => ({
            role: (h.role === 'user' ? 'user' : 'model') as 'user' | 'model',
            parts: [{ text: h.text }]
          })),
          { role: 'user', parts: [{ text: `${systemContext}\n\nArchitect Suggestion: ${userInput}` }] }
        ]
      });
      
      const responseText = result.text || '';
      
      setChatHistory(prev => [...prev, { role: 'model', text: responseText }]);

      // Automatically clean and update the main design notes view
      const cleanedNotes = cleanDesignNotes(responseText);
      if (cleanedNotes && cleanedNotes.includes('**Components Involved**')) {
        setDesignNotes(cleanedNotes);
      } else if (!designNotes) {
        // Fallback for first generation if notes were empty
        setDesignNotes(responseText);
      }

    } catch (e: any) {
      toast({
        title: 'Refinement Failed',
        message: e.message,
        type: 'error'
      });
    } finally {
      setIsRefining(false);
    }
  };

  const handleApproveDesign = async () => {
    if (!selectedIssue || !designNotes) return;
    
    const finalNotes = cleanDesignNotes(designNotes);
    setDesignNotes(finalNotes); // Update UI to show cleaned version

    // Save the latest design notes to Firestore
    if (orgData?.orgId) {
      try {
        const docRef = doc(db, 'orgs', orgData.orgId, 'jira_analyses', selectedIssue.key);
        await setDoc(docRef, {
          designNotes: finalNotes,
          updatedAt: new Date().toISOString()
        }, { merge: true });
        
        toast({
          title: 'Design Approved',
          message: 'The technical design notes have been cleaned and saved. You can now update Jira.',
          type: 'success'
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `/orgs/${orgData.orgId}/jira_analyses/${selectedIssue.key}`);
      }
    }
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-100px)]">
      <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-4 mb-6 flex items-start space-x-3 shadow-sm">
        <i className="fas fa-info-circle mt-0.5 text-blue-500 text-lg"></i>
        <div>
          <h4 className="text-sm font-bold">Build in Progress</h4>
          <p className="text-xs mt-1 font-medium">This functionality is currently being built and will be released by the first week of July.</p>
        </div>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Jira Debugger</h1>
          <p className="text-sm text-slate-500 font-medium mt-1">Pull stories from Jira and generate implementation designs.</p>
        </div>
        <button 
          onClick={() => fetchIssues()}
          disabled={loading}
          className="flex items-center space-x-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold shadow-sm hover:bg-slate-50 transition-all disabled:opacity-75"
          title="Fetch latest issues"
        >
          <i className={`fas fa-sync-alt ${loading ? 'fa-spin' : ''}`}></i>
          <span>Refresh</span>
        </button>
      </div>

      <div className="flex space-x-6 flex-1 items-start">
        {/* Left Sidebar - Issue List */}
        <div className="w-1/6 bg-white border border-slate-200 rounded-3xl p-5 flex flex-col shadow-sm sticky top-6 max-h-[calc(100vh-140px)]">
          <form onSubmit={handleSearch} className="mb-4 space-y-3">
            <div className="relative">
              <i className="fas fa-search absolute left-3.5 top-3 text-slate-400"></i>
              <input
                type="text"
                placeholder="Search by key or summary..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all shadow-inner placeholder-slate-400 font-medium"
              />
            </div>
            <div className="flex space-x-2">
              <select 
                value={issueType}
                onChange={(e) => setIssueType(e.target.value)}
                className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="Story">Story</option>
                <option value="Bug">Bug</option>
                <option value="Task">Task</option>
                <option value="Epic">Epic</option>
              </select>
              <button type="submit" className="px-4 py-2 bg-[#FFE600] text-[#2E2E38] rounded-xl text-sm font-bold shadow-md shadow-[#FFE600]/30 hover:bg-[#E5CF00] transition-colors">
                Find
              </button>
            </div>
          </form>

          {error && (
            <div className="p-3 mb-4 bg-red-50 text-red-600 text-xs font-semibold rounded-xl border border-red-100 flex items-start">
              <i className="fas fa-exclamation-circle mt-0.5 mr-2"></i>
              <span>{error}. Check your .env configuration.</span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto pr-2 space-y-2 custom-scrollbar">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                <i className="fas fa-circle-notch fa-spin text-2xl mb-2 text-[#2E2E38]"></i>
                <span className="text-xs font-bold uppercase tracking-wider">Loading Jira...</span>
              </div>
            ) : issues.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                <i className="fas fa-inbox text-3xl mb-2 opacity-50"></i>
                <span className="text-xs font-bold uppercase tracking-wider">No issues found</span>
              </div>
            ) : (
              issues.map(issue => (
                <button
                  key={issue.id}
                  onClick={() => handleIssueSelect(issue)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    selectedIssue?.id === issue.id 
                      ? 'bg-[#FFE600]/10 border-[#FFE600]/30 shadow-sm' 
                      : 'bg-white border-slate-100 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-xs font-bold text-slate-500">{issue.key}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-100 text-slate-600`}>
                      {issue.fields.status.name}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 line-clamp-2 leading-snug">{issue.fields.summary}</h3>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right Side - Issue Details & Design */}
        <div className="w-5/6 flex flex-col space-y-4 pb-20">
          {selectedIssue ? (
            <>
              {/* 1. Issue Details Card (Top) */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm shrink-0 relative">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center space-x-3">
                    <img src={selectedIssue.fields.issuetype.iconUrl} alt="type" className="w-5 h-5 rounded" />
                    <span className="text-sm font-bold text-slate-500 tracking-wider uppercase">{selectedIssue.key}</span>
                    <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-[10px] font-black uppercase tracking-widest border border-slate-200">
                      {selectedIssue.fields.status.name}
                    </span>
                  </div>
                   {/* Button removed from conditional rendering */}
                   <button 
                     onClick={() => generateDesign(selectedIssue)}
                     disabled={isDesigning}
                     className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-[#FFE600] to-[#E5CF00] text-slate-800 rounded-xl text-xs font-bold shadow-sm shadow-[#FFE600]/30 hover:shadow-md transition-all disabled:opacity-75 tracking-wider absolute top-6 right-6"
                   >
                     {isDesigning ? (
                       <><i className="fas fa-circle-notch fa-spin"></i><span>Analyzing...</span></>
                     ) : (
                       <><i className="fas fa-wand-magic-sparkles"></i><span>Build Design</span></>
                     )}
                   </button>
                </div>
                
                <h2 className="text-2xl font-bold text-slate-900 mb-6 pr-40 leading-tight">{selectedIssue.fields.summary}</h2>
                
                <div className="prose prose-sm max-w-none text-slate-600">
                  <p className="font-medium whitespace-pre-wrap">
                    {extractADFText(selectedIssue.fields.description)}
                  </p>
                </div>
                
                {(() => {
                  const ac = getAcceptanceCriteria(selectedIssue);
                  if (ac) {
                    return (
                      <div className="mt-8 pt-6 border-t border-slate-100">
                        <h4 className="text-sm font-bold text-slate-900 mb-3">Acceptance Criteria</h4>
                        <div className="bg-slate-50 p-4 rounded-xl text-sm text-slate-700 whitespace-pre-wrap">
                          {ac}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}

                {selectedIssue.fields.attachment && selectedIssue.fields.attachment.length > 0 && (
                  <div className="mt-8 pt-6 border-t border-slate-100">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Attachments</h4>
                    <div className="grid grid-cols-3 gap-3">
                      {selectedIssue.fields.attachment.map((att: any) => (
                        <div key={att.id} className="flex items-center p-2 bg-slate-50 border border-slate-100 rounded-lg space-x-2">
                          <i className="fas fa-paperclip text-slate-400"></i>
                          <a href={att.content} target="_blank" rel="noreferrer" className="text-xs font-medium text-[#2E2E38] hover:underline truncate">
                            {att.filename}
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 2. Design Notes with Update Button */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col shrink-0 min-h-[150px]">
                 <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center space-x-3">
                      <h3 className="text-lg font-bold text-slate-900">Design Notes</h3>
                      {designNotes && (
                        <button 
                          onClick={handleApproveDesign}
                          className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-blue-100 hover:bg-blue-100 transition-all"
                        >
                          Approve Design
                        </button>
                      )}
                    </div>
                    <button 
                      onClick={() => updateJiraStory(selectedIssue, designNotes)}
                      disabled={isUpdatingJira}
                      className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl text-xs font-bold shadow-md shadow-green-500/30 hover:shadow-lg hover:scale-105 transition-all disabled:opacity-75 disabled:hover:scale-100"
                    >
                      {isUpdatingJira ? (
                        <><i className="fas fa-circle-notch fa-spin"></i><span>Updating Jira...</span></>
                      ) : (
                        <><i className="fab fa-jira"></i><span>Update Jira Story</span></>
                      )}
                    </button>
                 </div>
                 {designNotes ? (
                   <div className="flex-1 w-full p-4 border border-slate-200 rounded-xl bg-slate-50 text-sm text-slate-800 prose prose-slate max-w-none prose-sm prose-p:my-1 prose-ol:my-1 prose-ul:my-1 prose-li:my-0">
                     <ReactMarkdown>{designNotes}</ReactMarkdown>
                   </div>
                 ) : (
                   <div className="flex-1 w-full p-8 border border-slate-200 border-dashed rounded-xl bg-slate-50 text-sm text-slate-400 flex items-center justify-center text-center">
                     Auto-populated dev design notes will appear here.
                   </div>
                 )}

                 {/* interactive refinement */}
                 <div className="mt-6 pt-6 border-t border-slate-100">
                   <h4 className="text-sm font-bold text-slate-900 mb-4 flex items-center">
                      <i className="fas fa-comments mr-2 text-blue-500"></i>
                      Refine with Architecture Copilot
                   </h4>
                   
                   <div className="space-y-4 max-h-[300px] overflow-y-auto mb-4 bg-slate-50 rounded-xl p-3 border border-slate-200 custom-scrollbar">
                      {chatHistory.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] p-3 rounded-2xl text-xs font-medium ${
                            msg.role === 'user' 
                              ? 'bg-[#FFE600] text-[#2E2E38] rounded-tr-none shadow-sm' 
                              : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none shadow-sm'
                          }`}>
                            <ReactMarkdown>{msg.text}</ReactMarkdown>
                          </div>
                        </div>
                      ))}
                      {isRefining && (
                        <div className="flex justify-start">
                          <div className="bg-white border border-slate-200 text-slate-400 rounded-2xl rounded-tl-none p-3 text-[10px] font-bold italic flex items-center shadow-sm">
                            <i className="fas fa-circle-notch fa-spin mr-2"></i>
                            Revising design notes...
                          </div>
                        </div>
                      )}
                   </div>

                   <form onSubmit={handleRefineDesign} className="relative">
                      <input
                        type="text"
                        value={refinementInput}
                        onChange={(e) => setRefinementInput(e.target.value)}
                        placeholder="Provide suggestions to redesign the notes..."
                        className="w-full pl-4 pr-20 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm font-medium"
                        disabled={isRefining}
                      />
                      <button
                        type="submit"
                        disabled={isRefining || !refinementInput.trim()}
                        className="absolute right-2 top-1.5 bottom-1.5 px-4 bg-[#2E2E38] text-white rounded-lg text-xs font-bold hover:bg-slate-700 transition-all disabled:opacity-50"
                      >
                        Send
                      </button>
                   </form>
                 </div>
              </div>

              {/* 3. Analysis and Further Steps */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex-1 relative">
                {isDesigning ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8">
                    <div className="relative mb-6">
                      <div className="absolute inset-0 bg-[#FFE600]/100 rounded-full blur-xl opacity-20 animate-pulse"></div>
                      <div className="w-16 h-16 bg-gradient-to-tr from-[#FFE600] to-[#E5CF00] rounded-2xl flex items-center justify-center text-white shadow-xl relative z-10 animate-bounce">
                        <i className="fas fa-brain text-2xl"></i>
                      </div>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 mb-2">{designingState || 'Analyzing Requirements...'}</h3>
                    <p className="text-sm text-slate-500 font-medium max-w-sm">Generating architectural design and implementation strategies based on the selected Jira issue.</p>
                  </div>
                ) : designPlan ? (
                  <div className="h-full flex flex-col">
                    <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
                      <h3 className="text-xl font-bold text-slate-900">Analysis and Further Steps</h3>
                    </div>
                    <div className="prose prose-slate prose-sm max-w-none prose-headings:font-bold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-a:text-[#2E2E38] prose-code:bg-slate-100 prose-code:text-slate-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md markdown-body flex-1">
                      <ReactMarkdown>{designPlan}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-50 relative">
                    <i className="fas fa-palette text-4xl text-slate-300 mb-4 mt-8"></i>
                    <p className="text-sm text-slate-500 font-bold uppercase tracking-wider">Click "Build Design" above to generate a design plan</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-white border border-slate-200 rounded-3xl flex-1 flex flex-col items-center justify-center text-center p-8 opacity-50 shadow-sm">
              <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                <i className="fas fa-bug text-3xl text-slate-300"></i>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">No Issue Selected</h3>
              <p className="text-sm text-slate-500 font-medium">Select a Jira issue from the list to view its details and generate a technical design plan.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default JiraDebugger;
