import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";
import { PDFDocument } from 'pdf-lib';
import { Search, Rocket, AlertTriangle, Zap, Archive, Info, Upload, FileText, ChevronLeft, Calendar, Plus, Bell } from 'lucide-react';
import { useToast } from './Toast';
import { useNotifications } from '../src/contexts/NotificationContext';

interface EnhancedReleaseNotesProps {
  orgData?: any;
  onSyncCategory?: (category: any) => void;
}

const EnhancedReleaseNotes: React.FC<EnhancedReleaseNotesProps> = ({ orgData, onSyncCategory }) => {
  const { toast } = useToast();
  const { addNotification } = useNotifications();
  const [releases, setReleases] = useState<any[]>([]);
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingPdf, setProcessingPdf] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<any | null>(null);
  const [deepDiveData, setDeepDiveData] = useState<any | null>(null);
  const [loadingDeepDive, setLoadingDeepDive] = useState(false);
  const [view, setView] = useState<'landing' | 'overview' | 'categories' | 'features' | 'deepdive'>('landing');
  const [overviewData, setOverviewData] = useState<any | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isScanningDeepDive, setIsScanningDeepDive] = useState(false);
  const [deepDiveScanResults, setDeepDiveScanResults] = useState<any[] | null>(null);
  const [orgRelevance, setOrgRelevance] = useState<Record<string, 'relevant' | 'unused'>>({});
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchReleases();
  }, []);

  const fetchReleases = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/release-notes');
      if (!response.ok) throw new Error('Failed to fetch releases');
      const json = await response.json();
      
      const formattedReleases = json.map((r: any) => {
        const fileName = r.id;
        const cleanName = fileName.replace('.pdf', '').replace(/_/g, ' ');
        // Try to extract a clean release name like "Winter '26"
        const releaseMatch = cleanName.match(/(Winter|Spring|Summer)\s*'?\s*(\d{2})/i);
        const finalName = releaseMatch ? `${releaseMatch[1]} '${releaseMatch[2]}` : cleanName;
        
        return {
          ...r,
          displayName: finalName
        };
      });
      
      setReleases(formattedReleases);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getTimelineStatus = (dateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eventDate = new Date(dateStr);
    eventDate.setHours(0, 0, 0, 0);
    
    if (eventDate < today) return 'completed';
    if (eventDate.getTime() === today.getTime()) return 'active';
    return 'upcoming';
  };

  const fetchReleaseData = async (releaseId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/enhanced-release-notes/${encodeURIComponent(releaseId)}`);
      if (!response.ok) throw new Error('Failed to fetch release data');
      const json = await response.json();
      setData(json);
      setSelectedReleaseId(releaseId);
      
      // Fetch overview data
      fetchOverviewData(releaseId, json);
      
      setView('overview');
    } catch (err: any) {
      toast({ title: 'Error', message: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const fetchOverviewData = async (releaseId: string, releaseData: any, force = false) => {
    setLoadingOverview(true);
    try {
      if (!force) {
        const response = await fetch(`/api/enhanced-release-notes/${encodeURIComponent(releaseId)}/overview`);
        if (response.ok) {
          const json = await response.json();
          setOverviewData(json);
          if (json.orgRelevance) setOrgRelevance(json.orgRelevance);
          setLoadingOverview(false);
          return;
        }
      }

      // If not found or forced, generate with Gemini
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = "gemini-3-flash-preview";
      
      const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const prompt = `Research and provide the official Salesforce release timeline and key resources for the "${releaseId}" release.
      Today's date is ${today}. 
      
      CRITICAL: Compare each event date with today's date (${today}). 
      - If the event date is BEFORE today, set status to "completed".
      - If the event date is TODAY, set status to "active".
      - If the event date is AFTER today, set status to "upcoming".
      
      Include:
      1. A timeline of 4-5 key dates (Pre-release, Sandbox preview, Production windows).
      2. Official resource links (HTML notes, PDF, Trailhead, Release Readiness).
      3. Based on the following features, identify which ones are most likely to be "Relevant" vs "Unused" for a typical Salesforce org that uses: ${orgData ? JSON.stringify(Object.keys(orgData).filter(k => Array.isArray(orgData[k]) && orgData[k].length > 0)) : 'Standard features'}.
      
      Features to analyze: ${JSON.stringify(releaseData.flatMap((m: any) => m.newFeatures || []).map((f: any) => f.title))}
      
      Return the data in JSON format:
      {
        "timeline": [{"date": "MMM DD, YYYY", "event": "Event Name", "status": "completed|active|upcoming"}],
        "resources": [{"label": "Resource Name", "url": "URL"}],
        "orgRelevance": {"Feature Title": "relevant|unused"}
      }`;

      const result = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { 
          tools: [{ googleSearch: {} }]
        }
      });

      let responseText = result.text || '';
      const jsonStart = responseText.indexOf('{');
      const jsonEnd = responseText.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        responseText = responseText.substring(jsonStart, jsonEnd + 1);
      }
      const generatedData = JSON.parse(responseText);
      setOverviewData(generatedData);
      if (generatedData.orgRelevance) setOrgRelevance(generatedData.orgRelevance);

      // Store in DB
      await fetch(`/api/enhanced-release-notes/${encodeURIComponent(releaseId)}/overview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(generatedData)
      });

    } catch (err: any) {
      console.error('Error fetching overview:', err);
    } finally {
      setLoadingOverview(false);
    }
  };

  const handleScanOrg = async () => {
    if (!selectedReleaseId || !data || !onSyncCategory) return;
    
    setIsScanning(true);
    toast({ title: 'Scanning Org', message: 'Analyzing release notes to identify relevant metadata...', type: 'info' });
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyze these Salesforce release notes and identify which metadata categories are most relevant for scanning. 
        Return a JSON array of metadata categories from this list: ["objects", "classes", "triggers", "vfPages", "lwcs", "flows", "profiles", "permissionSets", "layouts", "flexiPages", "validationRules", "workflowRules", "approvalProcesses"].
        
        Release Notes Summary: ${JSON.stringify(data.overview || data)}
        
        Return ONLY the JSON array.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        }
      });

      const categoriesToSync = JSON.parse(response.text || '[]');
      
      if (categoriesToSync.length === 0) {
        toast({ title: 'Scan Complete', message: 'No specific metadata categories identified for this release.', type: 'info' });
        return;
      }

      toast({ title: 'Scan Complete', message: `Identified ${categoriesToSync.length} categories to sync: ${categoriesToSync.join(', ')}`, type: 'success' });
      
      // Trigger sync for each category
      for (const category of categoriesToSync) {
        onSyncCategory(category);
      }
      
    } catch (err: any) {
      console.error('Scan failed:', err);
      toast({ title: 'Scan Failed', message: err.message, type: 'error' });
    } finally {
      setIsScanning(false);
    }
  };

  const handleDeepDiveScan = async () => {
    if (!selectedFeature || !deepDiveData || !orgData) return;
    
    setIsScanningDeepDive(true);
    setDeepDiveScanResults(null);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyze this Salesforce release feature and identify:
        1. Specific metadata component NAMES that are explicitly mentioned or highly likely to exist (e.g., "Account", "Opportunity", or specific class names mentioned in the text). Do NOT include descriptive phrases like "Classes using X".
        2. Search terms (keywords, regex patterns, or specific code snippets) to find relevant components in the org's metadata content.
        
        Feature: ${selectedFeature.title}
        Explanation: ${deepDiveData.explanation}
        
        Example: If the feature is about "Visualforce PDF Rendering", search terms might be ["renderAs=\"pdf\"", "renderAs='pdf'", "Blob.toPdf"].
        
        Return a JSON object:
        {
          "identifiedComponents": [{"category": "...", "name": "..."}],
          "searchTerms": ["keyword1", "keyword2"],
          "categoriesToScan": ["vfPages", "classes", "triggers", "lwcs", "flows", "objects"]
        }
        
        Categories must be from: ["objects", "classes", "triggers", "vfPages", "lwcs", "flows", "profiles", "permissionSets", "layouts", "flexiPages", "validationRules", "workflowRules", "approvalProcesses"].
        
        Return ONLY the JSON object.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              identifiedComponents: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: { type: Type.STRING },
                    name: { type: Type.STRING }
                  },
                  required: ["category", "name"]
                }
              },
              searchTerms: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              categoriesToScan: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["identifiedComponents", "searchTerms", "categoriesToScan"]
          }
        }
      });

      const { identifiedComponents, searchTerms, categoriesToScan } = JSON.parse(response.text || '{}');
      const results: any[] = [];
      const processedNames = new Set<string>();

      // 1. Process identified components (exact name match)
      if (identifiedComponents) {
        for (const comp of identifiedComponents) {
          // Skip if it looks like a description rather than a name
          if (comp.name.includes(' ') || comp.name.toLowerCase().includes('utilizing') || comp.name.toLowerCase().includes('using')) {
            continue;
          }

          try {
            const res = await fetch(`/api/metadata/${orgData.orgId}/${comp.category}`);
            if (res.ok) {
              const list = await res.json();
              const foundItem = list.find((item: any) => 
                (item.name || item.DeveloperName || item.Label || '').toLowerCase() === comp.name.toLowerCase()
              );
              if (foundItem) {
                results.push({ ...comp, found: true, id: foundItem.id, reason: 'Identified by AI' });
                processedNames.add(`${comp.category}:${comp.name.toLowerCase()}`);
              } else {
                // Only add "Not Found" if it really looks like a specific name
                if (comp.name.length > 3 && !comp.name.includes(' ')) {
                  results.push({ ...comp, found: false });
                }
              }
            }
          } catch (e) {}
        }
      }

      // 2. Perform keyword search in specified categories
      if (searchTerms && searchTerms.length > 0 && categoriesToScan) {
        const regexes = searchTerms.map((term: string) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        
        for (const category of categoriesToScan) {
          try {
            const res = await fetch(`/api/metadata/${orgData.orgId}/${category}`);
            if (res.ok) {
              const list = await res.json();
              for (const item of list) {
                const itemName = (item.name || item.DeveloperName || item.Label || '');
                if (processedNames.has(`${category}:${itemName.toLowerCase()}`)) continue;

                let matches = false;
                let matchedTerm = '';
                
                // Check name
                for (const r of regexes) {
                  if (r.test(itemName)) {
                    matches = true;
                    matchedTerm = r.source.replace(/\\/g, '');
                    break;
                  }
                }
                
                // Check content
                if (!matches && item.content) {
                  for (const r of regexes) {
                    if (r.test(item.content)) {
                      matches = true;
                      matchedTerm = r.source.replace(/\\/g, '');
                      break;
                    }
                  }
                }

                if (matches) {
                  results.push({ category, name: itemName, found: true, id: item.id, reason: `Matches "${matchedTerm}"` });
                  processedNames.add(`${category}:${itemName.toLowerCase()}`);
                  
                  // Special logic for Visualforce Pages to find controllers
                  if (category === 'vfPages' && item.content) {
                    const controllerMatch = item.content.match(/controller="([^"]+)"/i);
                    const extensionsMatch = item.content.match(/extensions="([^"]+)"/i);
                    
                    const controllers = [];
                    if (controllerMatch) controllers.push(controllerMatch[1]);
                    if (extensionsMatch) controllers.push(...extensionsMatch[1].split(',').map((s: string) => s.trim()));
                    
                    for (const ctrl of controllers) {
                      if (!processedNames.has(`classes:${ctrl.toLowerCase()}`)) {
                        results.push({ category: 'classes', name: ctrl, found: true, reason: `Controller for ${itemName}` });
                        processedNames.add(`classes:${ctrl.toLowerCase()}`);
                      }
                    }
                  }
                }
              }
            }
          } catch (e) {}
        }
      }

      setDeepDiveScanResults(results);
      
      let newOrgImpact = deepDiveData.orgImpact;
      
      // If we found specific components, generate a new org impact statement
      if (results.length > 0) {
        try {
          const foundComponentsList = results.filter(r => r.found).map(r => `${r.category}: ${r.name}`).join(', ');
          if (foundComponentsList) {
            const impactResponse = await ai.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: `Based on the Salesforce release feature "${selectedFeature.title}" and the following specific components found in the user's org:
              
              [${foundComponentsList}]
              
              Write a short, specific "Org Impact & Recommendations" paragraph (3-4 sentences). 
              Explain exactly how this feature impacts these specific components and what the user should do next.
              Do not use markdown formatting.`,
            });
            
            if (impactResponse.text) {
              newOrgImpact = impactResponse.text.trim();
              setDeepDiveData(prev => prev ? { ...prev, orgImpact: newOrgImpact } : prev);
            }
          }
        } catch (e) {
          console.error("Failed to generate updated org impact", e);
        }
      }

      // Save the scan results and the (potentially updated) org impact to the DB
      try {
        await fetch(`/api/orgs/${orgData.orgId}/release-notes/${encodeURIComponent(selectedReleaseId!)}/features/${encodeURIComponent(selectedFeature.title)}/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scanResults: results,
            orgImpact: newOrgImpact
          })
        });
      } catch (e) {
        console.error("Failed to save org-specific scan results", e);
      }

      if (results.length === 0) {
        toast({ title: 'Scan Complete', message: 'No specific components identified for this feature.', type: 'info' });
      } else {
        const foundCount = results.filter(r => r.found).length;
        toast({ title: 'Scan Complete', message: `Identified ${results.length} components. Found ${foundCount} in your database.`, type: 'success' });
      }
      
    } catch (err: any) {
      console.error('Deep dive scan failed:', err);
      toast({ title: 'Scan Failed', message: err.message, type: 'error' });
    } finally {
      setIsScanningDeepDive(false);
    }
  };

  const fetchFeatureDeepDive = async (feature: any) => {
    if (!selectedReleaseId) return;
    
    setLoadingDeepDive(true);
    setSelectedFeature(feature);
    setDeepDiveScanResults(null);
    setView('deepdive');
    
    try {
      // Try to fetch from DB first
      const response = await fetch(`/api/enhanced-release-notes/${encodeURIComponent(selectedReleaseId)}/features/${encodeURIComponent(feature.title)}`);
      
      let deepDive = null;
      if (response.ok) {
        deepDive = await response.json();
      } else {
        // If not in DB, generate with Gemini
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const model = "gemini-3-flash-preview";
        
        // Fetch relevant metadata for context if available
        let orgContext = "";
        if (orgData) {
          const categories = ['ApexClass', 'Flow', 'CustomObject', 'LightningComponentBundle'];
          const relevantMetadata: any = {};
          categories.forEach(cat => {
            if (orgData[cat]) {
              relevantMetadata[cat] = orgData[cat].slice(0, 20).map((i: any) => i.name || i.label || i.DeveloperName);
            }
          });
          orgContext = `The user's Salesforce org contains the following components: ${JSON.stringify(relevantMetadata)}.`;
        }

        const prompt = `Provide a deep dive explanation for this Salesforce Release Note feature:
        Title: ${feature.title}
        Summary: ${feature.one_liner}
        Description: ${feature.description}
        Phase: ${feature.phase}
        
        ${orgContext}
        
        Your response MUST include:
        1. A 4-5 line detailed explanation of the feature and its business impact.
        2. A "Sample Code" or "Implementation Example" section (if applicable, especially for Apex, LWC, or Flow logic).
        3. A "Real-world Use Case" example.
        4. A "Best Practices" section.
        5. ORG IMPACT: Identify 1-2 specific components from the provided org list that could be enhanced or might be affected by this change. Explain why and how. If no specific components match, provide a general impact analysis for a typical org.
        
        Return the data as a JSON object:
        {
          "explanation": "...",
          "sampleCode": "...",
          "useCase": "...",
          "bestPractices": "...",
          "orgImpact": "...",
          "officialLinks": [ { "label": "...", "url": "..." } ]
        }
        
        IMPORTANT: Only return the JSON object. No markdown formatting.`;

        const result = await ai.models.generateContent({
          model,
          contents: [{ parts: [{ text: prompt }] }],
          config: { responseMimeType: "application/json" }
        });

        const text = result.text || '';
        const jsonStart = text.indexOf('{');
        const jsonEnd = text.lastIndexOf('}');
        const jsonStr = text.substring(jsonStart, jsonEnd + 1);
        deepDive = JSON.parse(jsonStr);
        
        // Store in DB for future use
        await fetch(`/api/enhanced-release-notes/${encodeURIComponent(selectedReleaseId)}/features/${encodeURIComponent(feature.title)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(deepDive)
        });
      }

      // Check for org-specific scan results
      if (orgData && deepDive) {
        try {
          const scanRes = await fetch(`/api/orgs/${orgData.orgId}/release-notes/${encodeURIComponent(selectedReleaseId)}/features/${encodeURIComponent(feature.title)}/scan`);
          if (scanRes.ok) {
            const scanData = await scanRes.json();
            if (scanData.scanResults) {
              setDeepDiveScanResults(scanData.scanResults);
            }
            if (scanData.orgImpact) {
              deepDive.orgImpact = scanData.orgImpact;
            }
          }
        } catch (e) {
          console.error("Failed to load org-specific scan results", e);
        }
      }

      setDeepDiveData(deepDive);

    } catch (err: any) {
      console.error("Deep dive generation failed", err);
      toast({ title: 'Deep Dive Failed', message: err.message, type: 'error' });
    } finally {
      setLoadingDeepDive(false);
    }
  };

  const categoriesConfig = [
    { id: 'retirements', title: "Retirements", icon: Archive, color: 'text-rose-600', bg: 'bg-rose-50', description: 'Features being retired in this release' },
    { id: 'critical', title: "Critical update", icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', description: 'Important updates and release changes' },
    { id: 'relevant', title: "Relevant enhancements", icon: Zap, color: 'text-emerald-600', bg: 'bg-emerald-50', description: 'New GA and Beta features' },
    { id: 'unused', title: "Unused enhancements", icon: Info, color: 'text-slate-600', bg: 'bg-slate-50', description: 'Other updates and minor changes' },
  ];

  const categorizedData = useMemo(() => {
    if (!data || !Array.isArray(data)) return null;

    const categories = categoriesConfig.map(cat => ({ ...cat, modules: {} as any }));

    data.forEach((module: any) => {
      // Process newFeatures
      module.newFeatures?.forEach((feature: any) => {
        const matchesSearch = 
          feature.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          feature.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          module.module.toLowerCase().includes(searchQuery.toLowerCase());
        
        if (!matchesSearch) return;

        let categoryIdx = 3; // Default to unused
        const phase = (feature.phase || '').toLowerCase().trim();

        // Exact match categorization logic as requested
        if (phase === 'retiring' || phase === 'retired' || phase === 'discontinued') {
          categoryIdx = 0; // Retirements
        } else if (phase === 'release update' || phase === 'release updates' || phase === 'critical update' || phase === 'critical updates' || feature.title.toLowerCase().includes('onboarding')) {
          categoryIdx = 1; // Critical update
        } else {
          // Check Org Relevance for Relevant vs Unused
          const relevance = orgRelevance[feature.title];
          if (relevance === 'relevant' || phase === 'ga' || phase === 'beta') {
            categoryIdx = 2; // Relevant enhancements
          } else {
            categoryIdx = 3; // Unused enhancements
          }
        }

        if (!categories[categoryIdx].modules[module.module]) {
          categories[categoryIdx].modules[module.module] = [];
        }
        categories[categoryIdx].modules[module.module].push(feature);
      });

      // Process retirements array explicitly
      module.retirements?.forEach((feature: any) => {
        const matchesSearch = 
          feature.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          feature.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          module.module.toLowerCase().includes(searchQuery.toLowerCase());
        
        if (!matchesSearch) return;

        const categoryIdx = 0; 
        if (!categories[categoryIdx].modules[module.module]) {
          categories[categoryIdx].modules[module.module] = [];
        }
        categories[categoryIdx].modules[module.module].push(feature);
      });
    });

    return categories;
  }, [data, searchQuery, orgRelevance]);

  // Store categories in DB at runtime if they don't exist
  useEffect(() => {
    if (selectedReleaseId && categorizedData && view === 'categories') {
      const saveCategories = async () => {
        try {
          // Check if categories already exist
          const checkRes = await fetch(`/api/enhanced-release-notes/${encodeURIComponent(selectedReleaseId)}/categories`);
          const existingCats = await checkRes.json();
          
          if (existingCats.length === 0) {
            await fetch(`/api/enhanced-release-notes/${encodeURIComponent(selectedReleaseId)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                categories: categorizedData.map(cat => ({
                  id: cat.id,
                  title: cat.title,
                  modules: cat.modules
                }))
              })
            });
          }
        } catch (err) {
          console.error("Failed to auto-save categories", err);
        }
      };
      saveCategories();
    }
  }, [selectedReleaseId, categorizedData, view]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      toast({ title: 'Invalid File', message: 'Please upload a PDF document.', type: 'error' });
      return;
    }

    setProcessingPdf(true);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Data = (e.target?.result as string).split(',')[1];
        await processPdfWithGemini(base64Data, file.name);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      toast({ title: 'Upload Failed', message: err.message, type: 'error' });
      setProcessingPdf(false);
    }
  };

  const processPdfWithGemini = async (base64Data: string, fileName: string) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = "gemini-2.5-pro";
      
      // Load PDF to check page count
      const pdfBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const pageCount = pdfDoc.getPageCount();
      
      const CHUNK_SIZE = 50;
      const allModules: any[] = [];
      const moduleMap = new Map<string, any>();
      let detectedReleaseName = "";

      // Helper to process a single chunk
      const processChunk = async (start: number, end: number, isFirstChunk: boolean) => {
        const subPdf = await PDFDocument.create();
        const pages = await subPdf.copyPages(pdfDoc, Array.from({ length: end - start }, (_, k) => start + k));
        pages.forEach(p => subPdf.addPage(p));
        const subPdfBase64 = await subPdf.saveAsBase64();

        const prompt = `Analyze pages ${start + 1} to ${end} of this Salesforce Release Notes PDF and extract the key features and updates. 
        Focus on identifying new features, enhancements, and retirements.
        Group them by Module (e.g., Salesforce Overall, Einstein, Sales, Service, etc.).
        ${isFirstChunk ? 'ALSO: Identify the exact Salesforce release name mentioned on the first page (e.g., "Winter \'26", "Spring \'26", "Summer \'25").' : ''}
        
        For each feature, provide:
        - title: The name of the feature
        - one_liner: A very short, catchy summary
        - description: A detailed explanation of what the feature does
        - phase: The release phase (MUST be exactly one of: "GA", "Beta", "Retiring", "Retired", "Discontinued", "Release Update", "Unused Things", or "Unused Releases")
        - requiresSetup: Boolean if it needs admin configuration
        - Links: An array of objects with "label" (e.g., "Official Help", "Release Notes") and "url" (the actual Salesforce help URL). Use your internal knowledge and Google Search to find the most accurate URLs.
        
        Return the data as a JSON object:
        {
          ${isFirstChunk ? '"releaseName": "Detected Release Name",' : ''}
          "modules": [
            {
              "module": "Module Name",
              "newFeatures": [
                { 
                  "title": "...", 
                  "one_liner": "...", 
                  "description": "...", 
                  "phase": "...", 
                  "requiresSetup": boolean,
                  "Links": [ { "label": "...", "url": "..." } ]
                }
              ],
              "retirements": [
                { 
                  "title": "...", 
                  "one_liner": "...", 
                  "description": "...", 
                  "phase": "Retiring", 
                  "requiresSetup": boolean,
                  "Links": [ { "label": "...", "url": "..." } ]
                }
              ]
            }
          ]
        }
        
        IMPORTANT: Only return the JSON object. No markdown formatting.`;

        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              parts: [
                { text: prompt },
                { inlineData: { data: subPdfBase64, mimeType: "application/pdf" } }
              ]
            }
          ],
          config: {
            tools: [{ googleSearch: {} }]
          }
        });

        const text = response.text || '';
        const jsonStart = text.indexOf('{');
        const jsonEnd = text.lastIndexOf('}');
        
        if (jsonStart === -1 || jsonEnd === -1) {
          throw new Error('AI response did not contain a valid JSON object');
        }

        const jsonStr = text.substring(jsonStart, jsonEnd + 1);
        return JSON.parse(jsonStr);
      };

      // Process in chunks if needed
      for (let i = 0; i < pageCount; i += CHUNK_SIZE) {
        const end = Math.min(i + CHUNK_SIZE, pageCount);
        const progressMsg = `Analyzing pages ${i + 1} to ${end} of ${pageCount}...`;
        console.log(progressMsg);
        setProcessingProgress(progressMsg);
        
        // Add a small delay between chunks to avoid rate limits
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        try {
          const chunkData = await processChunk(i, end, i === 0);
          
          if (i === 0 && chunkData.releaseName) {
            detectedReleaseName = chunkData.releaseName;
          }

          const modules = chunkData.modules || [];
          
          // Merge chunk data into allModules
          modules.forEach((moduleObj: any) => {
            if (moduleMap.has(moduleObj.module)) {
              const existingModule = moduleMap.get(moduleObj.module);
              if (!existingModule.newFeatures) existingModule.newFeatures = [];
              if (!existingModule.retirements) existingModule.retirements = [];
              existingModule.newFeatures.push(...(moduleObj.newFeatures || []));
              existingModule.retirements.push(...(moduleObj.retirements || []));
            } else {
              const newModule = { ...moduleObj };
              if (!newModule.newFeatures) newModule.newFeatures = [];
              if (!newModule.retirements) newModule.retirements = [];
              moduleMap.set(moduleObj.module, newModule);
              allModules.push(newModule);
            }
          });
        } catch (chunkErr: any) {
          console.error(`Failed to process chunk ${i + 1}-${end}:`, chunkErr);
          // If it's a size error even with 50 pages, we might need to skip or warn
          if (chunkErr.message?.includes('size exceeds supported limit')) {
            toast({ 
              title: 'Chunk Too Large', 
              message: `Pages ${i + 1}-${end} were too large to process and were skipped.`, 
              type: 'error' 
            });
            continue;
          }
          throw chunkErr; // Re-throw other errors
        }
      }

      // Determine release name - prefer detected name
      let releaseName = detectedReleaseName || fileName.replace('.pdf', '');
      
      // Clean up release name (e.g. "Winter '26" instead of "Salesforce Winter '26 Release Notes")
      const yearMatch = releaseName.match(/'?\d{2}/);
      const year = yearMatch ? yearMatch[0].replace("'", "") : '26';
      
      if (releaseName.toLowerCase().includes('winter')) releaseName = `Winter '${year}`;
      else if (releaseName.toLowerCase().includes('spring')) releaseName = `Spring '${year}`;
      else if (releaseName.toLowerCase().includes('summer')) releaseName = `Summer '${year}`;
      
      // Save merged results to DB
      await fetch(`/api/enhanced-release-notes/${encodeURIComponent(releaseName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: allModules })
      });

      toast({ title: 'Success', message: `Processed ${pageCount} pages and saved release notes as ${releaseName}.`, type: 'success' });
      addNotification('Release Notes Processed', `The ${releaseName} release notes have been successfully analyzed and are now available.`, 'success');
      
      fetchReleases();
      setData(allModules);
      setSelectedReleaseId(releaseName);
      setView('overview');
    } catch (err: any) {
      console.error("Gemini processing failed", err);
      toast({ title: 'Processing Failed', message: err.message, type: 'error' });
      addNotification('Processing Failed', `Failed to process release notes: ${err.message}`, 'error');
    } finally {
      setProcessingPdf(false);
      setProcessingProgress('');
    }
  };

  const refreshReleaseData = async () => {
    if (!selectedReleaseId) return;
    
    setLoading(true);
    try {
      // Clear categories in DB first to force re-categorization
      await fetch(`/api/enhanced-release-notes/${encodeURIComponent(selectedReleaseId)}/categories`, {
        method: 'DELETE'
      });
      
      // Re-fetch the base data
      const response = await fetch(`/api/enhanced-release-notes/${encodeURIComponent(selectedReleaseId)}`);
      if (!response.ok) throw new Error('Failed to fetch release data');
      const json = await response.json();
      
      // Update state
      setData(json);
      
      // Force refresh overview data to update timeline statuses
      await fetchOverviewData(selectedReleaseId, json, true);
      
      toast({ title: 'Data Refreshed', message: 'Release notes and overview have been updated.', type: 'success' });
    } catch (err: any) {
      toast({ title: 'Refresh Failed', message: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const enrichLinks = async () => {
    if (!selectedReleaseId) return;
    
    toast({ title: 'Enriching Links', message: 'Finding reference URLs for all features...', type: 'info' });
    
    try {
      const response = await fetch(`/api/enhanced-release-notes/${encodeURIComponent(selectedReleaseId)}/enrich`, {
        method: 'POST'
      });
      
      if (response.ok) {
        toast({ title: 'Enrichment Started', message: 'The backend is finding links in the background. You will be notified when done.', type: 'success' });
        addNotification('Link Enrichment Started', `We are finding official reference URLs for the ${selectedReleaseId} release notes.`, 'info');
      } else {
        throw new Error('Failed to start enrichment');
      }
    } catch (err: any) {
      toast({ title: 'Enrichment Failed', message: err.message, type: 'error' });
    }
  };

  const getSearchUrl = (title: string) => {
    return `https://help.salesforce.com/s/global-search/${encodeURIComponent(title + " Salesforce " + selectedReleaseId + " Release Notes")}`;
  };

  const sortedReleases = useMemo(() => {
    return [...releases].sort((a, b) => {
      const getOrder = (id: string) => {
        const lowerId = id.toLowerCase();
        let year = 0;
        let season = 0;
        
        const yearMatch = lowerId.match(/\d+/);
        if (yearMatch) year = parseInt(yearMatch[0]);
        
        if (lowerId.includes('summer')) season = 3;
        else if (lowerId.includes('spring')) season = 2;
        else if (lowerId.includes('winter')) season = 1;
        
        return year * 10 + season;
      };
      return getOrder(b.id) - getOrder(a.id);
    });
  }, [releases]);

  const currentRelease = sortedReleases[0];
  const previousReleases = sortedReleases.slice(1);

  if (loading && view === 'landing') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#FFE600]"></div>
      </div>
    );
  }

  const activeCategory = categorizedData?.find(cat => cat.id === selectedCategoryId);

  return (
    <div className="max-w-6xl mx-auto p-8 animate-fadeIn">
      <AnimatePresence mode="wait">
        {view === 'landing' ? (
          <motion.div 
            key="landing"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-16"
          >
            <header className="text-center space-y-6">
              <div className="inline-flex items-center space-x-2 px-4 py-2 bg-[#FFE600]/10 text-[#2E2E38] rounded-full text-[10px] font-bold uppercase tracking-widest">
                <Zap className="w-4 h-4" />
                <span>AI-Powered Insights</span>
              </div>
              <h1 className="text-6xl font-black text-slate-900 tracking-tight leading-tight">
                Salesforce <span className="text-[#2E2E38]">Release</span> Explorer
              </h1>
              <p className="text-slate-500 text-lg max-w-2xl mx-auto leading-relaxed">
                Stay ahead of the curve with intelligent, categorized release notes. 
                Upload any Salesforce PDF to instantly unlock searchable, actionable updates.
              </p>
            </header>

            {currentRelease && (
              <section className="space-y-8">
                <div className="flex items-center space-x-4">
                  <div className="h-px flex-1 bg-slate-100"></div>
                  <h2 className="text-sm font-black text-slate-400 uppercase tracking-[0.3em]">Current Release</h2>
                  <div className="h-px flex-1 bg-slate-100"></div>
                </div>
                
                <div className="max-w-4xl mx-auto">
                  <motion.button
                    whileHover={{ y: -8, scale: 1.01 }}
                    onClick={() => fetchReleaseData(currentRelease.id)}
                    className="w-full bg-white p-12 rounded-[50px] border border-slate-100 shadow-xl shadow-[#FFE600]/30 hover:shadow-2xl hover:shadow-[#FFE600]/30 transition-all text-left group relative overflow-hidden flex flex-col md:flex-row items-center md:items-start space-y-8 md:space-y-0 md:space-x-12"
                  >
                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                      <Rocket className="w-64 h-64 text-[#2E2E38]" />
                    </div>
                    
                    <div className="p-8 rounded-[40px] bg-[#FFE600] shadow-lg shadow-[#FFE600]/30 group-hover:scale-110 transition-transform shrink-0">
                      <Zap className="w-12 h-12 text-white" />
                    </div>
                    
                    <div className="flex-1 space-y-4 text-center md:text-left">
                      <div className="flex items-center justify-center md:justify-start space-x-3">
                        <span className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-bold uppercase tracking-widest">Active Now</span>
                        <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                          {currentRelease.updatedAt ? new Date(currentRelease.updatedAt).toLocaleDateString() : 'Original'}
                        </span>
                      </div>
                      <h3 className="text-5xl font-black text-slate-900 tracking-tight">
                        {currentRelease.displayName}
                      </h3>
                      <p className="text-slate-500 text-lg leading-relaxed max-w-xl">
                        Explore the most recent updates, including Einstein AI enhancements, Sales Cloud innovations, and critical platform changes.
                      </p>
                      <div className="pt-4 flex items-center justify-center md:justify-start text-[#2E2E38] font-black text-sm uppercase tracking-[0.2em]">
                        <span>Launch Explorer</span>
                        <ChevronLeft className="w-5 h-5 ml-2 rotate-180 group-hover:translate-x-3 transition-transform" />
                      </div>
                    </div>
                  </motion.button>
                </div>
              </section>
            )}

            <section className="space-y-8">
              <div className="flex items-center space-x-4">
                <div className="h-px flex-1 bg-slate-100"></div>
                <h2 className="text-sm font-black text-slate-400 uppercase tracking-[0.3em]">
                  {previousReleases.length > 0 ? 'Previous & New Releases' : 'Get Started'}
                </h2>
                <div className="h-px flex-1 bg-slate-100"></div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {previousReleases.map((release) => (
                  <motion.button
                    key={release.id}
                    whileHover={{ y: -8, scale: 1.02 }}
                    onClick={() => fetchReleaseData(release.id)}
                    className="bg-white p-10 rounded-[40px] border border-slate-100 shadow-sm hover:shadow-2xl hover:shadow-[#FFE600]/30 transition-all text-left group relative overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                      <Calendar className="w-24 h-24 text-[#2E2E38]" />
                    </div>
                    <div className="p-5 rounded-3xl bg-[#FFE600]/10 inline-block mb-8 group-hover:scale-110 transition-transform">
                      <Rocket className="w-8 h-8 text-[#2E2E38]" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-2 tracking-tight">
                      {release.displayName}
                    </h2>
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-6">
                      Last updated: {release.updatedAt ? new Date(release.updatedAt).toLocaleDateString() : 'Original'}
                    </p>
                    <div className="flex items-center text-[#2E2E38] font-bold text-xs uppercase tracking-widest">
                      <span>Explore Notes</span>
                      <ChevronLeft className="w-4 h-4 ml-2 rotate-180 group-hover:translate-x-2 transition-transform" />
                    </div>
                  </motion.button>
                ))}

                <motion.button
                  whileHover={{ y: -8, scale: 1.02 }}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={processingPdf}
                  className="bg-slate-50 p-10 rounded-[40px] border-2 border-dashed border-slate-200 hover:border-[#FFE600]/30 hover:bg-white transition-all text-center group flex flex-col items-center justify-center min-h-[300px]"
                >
                  {processingPdf ? (
                    <div className="flex flex-col items-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#FFE600] mb-4"></div>
                      <p className="text-sm font-bold text-slate-900 uppercase tracking-widest">{processingProgress || 'AI Processing PDF...'}</p>
                      <p className="text-xs text-slate-500 mt-2">Extracting features and modules</p>
                    </div>
                  ) : (
                    <>
                      <div className="p-5 rounded-3xl bg-white shadow-sm mb-6 group-hover:scale-110 transition-transform">
                        <Plus className="w-8 h-8 text-slate-400 group-hover:text-[#2E2E38]" />
                      </div>
                      <h2 className="text-xl font-bold text-slate-900 mb-2 tracking-tight">Upload New Release</h2>
                      <p className="text-slate-500 text-sm max-w-[200px] mx-auto">
                        Drop a Salesforce Release Notes PDF here to process it.
                      </p>
                    </>
                  )}
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileUpload} 
                    accept=".pdf" 
                    className="hidden" 
                  />
                </motion.button>
              </div>
            </section>
          </motion.div>
        ) : (
          <motion.div 
            key="content"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-12"
          >
            <header className="mb-12 text-center relative">
              <div className="flex justify-between items-center mb-4">
                <button 
                  onClick={() => {
                    if (view === 'deepdive') {
                      setDeepDiveData(null);
                      setSelectedFeature(null);
                      setView('categories');
                    } else if (view === 'categories') {
                      setSelectedCategoryId(null);
                      setView('overview');
                    } else if (view === 'overview') {
                      setView('landing');
                    } else {
                      setView('landing');
                    }
                  }}
                  className="flex items-center space-x-2 text-slate-500 hover:text-[#2E2E38] font-bold text-sm transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>
                    {view === 'deepdive' ? 'Back to Features' : 
                     view === 'categories' ? 'Back to Overview' : 
                     'Back to Releases'}
                  </span>
                </button>
                <div className="flex-1"></div>
                <div className="inline-block px-4 py-1.5 bg-[#FFE600]/10 text-[#2E2E38] rounded-full text-[10px] font-bold uppercase tracking-widest">
                  {selectedReleaseId?.replace("'", " '")}
                </div>
                <div className="flex-1"></div>
              </div>

              <h1 className="text-4xl font-bold text-slate-900 tracking-tight mb-4 capitalize">
                {view === 'deepdive' ? selectedFeature?.title : selectedCategoryId ? activeCategory?.title : view === 'overview' ? `${selectedReleaseId?.replace("'", " '")} Complete Guide` : `${selectedReleaseId?.replace("'", " '")} Release Notes`}
              </h1>
              <p className="text-slate-500 max-w-2xl mx-auto mb-8">
                {view === 'deepdive' ? selectedFeature?.one_liner : selectedCategoryId ? activeCategory?.description : view === 'overview' ? "Your comprehensive roadmap to the latest Salesforce innovations, timelines, and critical updates." : "Explore the latest features and updates in a rich, interactive format retrieved directly from our knowledge base."}
              </p>

              <div className="flex justify-center mb-8 space-x-4">
                <button
                  onClick={refreshReleaseData}
                  className="px-6 py-2 bg-white text-slate-600 border border-slate-200 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center shadow-sm"
                >
                  <Search className="w-4 h-4 mr-2" />
                  Refresh & Re-categorize
                </button>
                <button
                  onClick={enrichLinks}
                  className="px-6 py-2 bg-[#FFE600] text-[#2E2E38] rounded-full text-xs font-bold uppercase tracking-widest hover:bg-[#E5CF00] transition-all flex items-center shadow-lg shadow-[#FFE600]/30"
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Enrich with Official Links
                </button>
              </div>
            </header>

            {view === 'deepdive' ? (
              <div className="max-w-4xl mx-auto space-y-12">
                {loadingDeepDive ? (
                  <div className="flex flex-col items-center justify-center py-20 space-y-6">
                    <div className="w-16 h-16 border-4 border-[#FFE600] border-t-transparent rounded-full animate-spin"></div>
                    <div className="text-center">
                      <h3 className="text-xl font-bold text-slate-900 mb-2">Generating Deep Dive...</h3>
                      <p className="text-slate-500">Analyzing feature details and generating implementation examples.</p>
                    </div>
                  </div>
                ) : deepDiveData && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-12"
                  >
                    {/* Detailed Explanation */}
                    <section className="bg-white p-10 rounded-[40px] border border-slate-100 shadow-sm">
                      <h3 className="text-xl font-black text-slate-900 mb-6 flex items-center">
                        <Info className="w-6 h-6 mr-3 text-[#2E2E38]" />
                        Detailed Explanation
                      </h3>
                      <p className="text-slate-600 leading-relaxed text-lg">
                        {deepDiveData.explanation}
                      </p>
                    </section>

                    {/* Org Impact Analysis */}
                    {deepDiveData.orgImpact && (
                      <section className="bg-blue-900 p-10 rounded-[40px] text-white shadow-xl shadow-[#FFE600]/30 relative overflow-hidden">
                        <div className="relative z-10">
                          <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-black flex items-center">
                              <Bell className="w-6 h-6 mr-3 text-[#FFE600]" />
                              Org Impact & Recommendations
                            </h3>
                            <button
                              onClick={handleDeepDiveScan}
                              disabled={isScanningDeepDive}
                              className={`px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center space-x-2 transition-all ${
                                isScanningDeepDive 
                                  ? 'bg-white/10 text-white/40 cursor-not-allowed' 
                                  : 'bg-white text-blue-900 hover:bg-[#FFE600]/10 hover:-translate-y-0.5 active:translate-y-0'
                              }`}
                            >
                              {isScanningDeepDive ? (
                                <>
                                  <div className="w-3 h-3 border-2 border-white/40 border-t-transparent rounded-full animate-spin"></div>
                                  <span>Scanning...</span>
                                </>
                              ) : (
                                <>
                                  <Zap className="w-3 h-3" />
                                  <span>Scan My Org</span>
                                </>
                              )}
                            </button>
                          </div>
                          <p className="text-blue-100 leading-relaxed text-lg mb-8">
                            {deepDiveData.orgImpact}
                          </p>

                          {deepDiveScanResults && (
                            <div className="bg-white/10 rounded-3xl p-6 border border-white/10">
                              <h4 className="text-sm font-bold mb-4 flex items-center text-blue-200">
                                <Search className="w-4 h-4 mr-2" />
                                Identified Components in Your Org
                              </h4>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {deepDiveScanResults.map((res, idx) => (
                                  <div key={idx} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                                    <div className="flex flex-col">
                                      <span className="text-[10px] uppercase tracking-wider text-blue-300 font-bold">{res.category}</span>
                                      <span className="text-sm font-medium">{res.name}</span>
                                      {res.reason && (
                                        <span className="text-[9px] text-[#FFE600] italic mt-0.5">{res.reason}</span>
                                      )}
                                    </div>
                                    {res.found ? (
                                      <div className="flex items-center text-emerald-400 text-[10px] font-bold bg-emerald-400/10 px-2 py-1 rounded-lg">
                                        <Zap className="w-3 h-3 mr-1" />
                                        FOUND IN DB
                                      </div>
                                    ) : (
                                      <div className="flex items-center text-slate-400 text-[10px] font-bold bg-white/5 px-2 py-1 rounded-lg">
                                        NOT FOUND
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                              <p className="mt-4 text-[10px] text-blue-300 italic">
                                * This scan only checks components already stored in your local database.
                              </p>
                            </div>
                          )}
                        </div>
                        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-400/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
                      </section>
                    )}

                    {/* Use Case & Best Practices */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <section className="bg-emerald-50 p-10 rounded-[40px] border border-emerald-100">
                        <h3 className="text-lg font-black text-emerald-900 mb-4 flex items-center">
                          <Zap className="w-5 h-5 mr-3 text-emerald-600" />
                          Real-world Use Case
                        </h3>
                        <p className="text-emerald-800/80 leading-relaxed text-sm">
                          {deepDiveData.useCase}
                        </p>
                      </section>
                      <section className="bg-[#FFE600]/10 p-10 rounded-[40px] border border-[#FFE600]/30">
                        <h3 className="text-lg font-black text-blue-900 mb-4 flex items-center">
                          <Rocket className="w-5 h-5 mr-3 text-[#2E2E38]" />
                          Best Practices
                        </h3>
                        <p className="text-blue-800/80 leading-relaxed text-sm">
                          {deepDiveData.bestPractices}
                        </p>
                      </section>
                    </div>

                    {/* Sample Code */}
                    {deepDiveData.sampleCode && (
                      <section className="bg-[#2E2E38] p-10 rounded-[40px] text-white shadow-xl shadow-slate-900/20">
                        <h3 className="text-xl font-black mb-6 flex items-center">
                          <FileText className="w-6 h-6 mr-3 text-[#FFE600]" />
                          Implementation Example
                        </h3>
                        <div className="bg-black/30 p-8 rounded-3xl whitespace-pre-wrap break-words text-sm text-blue-50 leading-relaxed">
                          {deepDiveData.sampleCode}
                        </div>
                      </section>
                    )}

                    {/* Official Links */}
                    <div className="flex justify-center pt-8">
                      <div className="flex flex-wrap gap-4">
                        {deepDiveData.officialLinks?.map((link: any, idx: number) => (
                          <a 
                            key={idx}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-8 py-3 bg-white text-[#2E2E38] border border-[#FFE600]/30 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-[#FFE600]/10 transition-all shadow-sm flex items-center"
                          >
                            {link.label} <ChevronLeft className="w-4 h-4 ml-2 rotate-180" />
                          </a>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            ) : view === 'overview' ? (
              <div className="space-y-16">
                {loadingOverview ? (
                  <div className="flex flex-col items-center justify-center py-20 space-y-6">
                    <div className="w-16 h-16 border-4 border-[#FFE600] border-t-transparent rounded-full animate-spin"></div>
                    <div className="text-center">
                      <h3 className="text-xl font-bold text-slate-900 mb-2">Researching Release Details...</h3>
                      <p className="text-slate-500">Fetching official timeline and analyzing org relevance.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* At a Glance Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                      {[
                        { label: 'Total Updates', value: data?.reduce((acc: number, m: any) => acc + (m.newFeatures?.length || 0) + (m.retirements?.length || 0), 0), icon: FileText, color: 'text-[#2E2E38]', bg: 'bg-[#FFE600]/10' },
                        { label: 'Retirements', value: categorizedData?.[0]?.modules ? Object.values(categorizedData[0].modules).flat().length : 0, icon: Archive, color: 'text-rose-600', bg: 'bg-rose-50' },
                        { label: 'Critical Updates', value: categorizedData?.[1]?.modules ? Object.values(categorizedData[1].modules).flat().length : 0, icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
                        { label: 'New Features', value: categorizedData?.[2]?.modules ? Object.values(categorizedData[2].modules).flat().length : 0, icon: Zap, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                      ].map((stat, idx) => (
                        <div key={idx} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center space-x-4">
                          <div className={`p-3 rounded-2xl ${stat.bg}`}>
                            <stat.icon className={`w-6 h-6 ${stat.color}`} />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{stat.label}</p>
                            <p className="text-2xl font-black text-slate-900">{stat.value}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Timeline & Resources Split */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                      <div className="lg:col-span-2 space-y-8">
                        <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm">
                          <div className="flex items-center justify-between mb-8">
                            <h3 className="text-xl font-black text-slate-900 tracking-tight flex items-center">
                              <Calendar className="w-6 h-6 mr-3 text-[#2E2E38]" />
                              Release Timeline
                            </h3>
                            <span className="px-3 py-1 bg-[#FFE600]/10 text-[#2E2E38] rounded-full text-[10px] font-bold uppercase tracking-widest">
                              {selectedReleaseId?.replace("'", " '")}
                            </span>
                          </div>
                          
                          <div className="flex items-center space-x-8 relative before:absolute before:left-4 before:right-4 before:top-[11px] before:h-0.5 before:bg-slate-100">
                            {(overviewData?.timeline || [
                              { date: 'Dec 12, 2025', event: 'Pre-Release Environment Access' },
                              { date: 'Jan 05, 2026', event: 'Sandbox Preview Starts' },
                              { date: 'Feb 13, 2026', event: 'Production Release (First Window)' },
                              { date: 'Mar 17, 2026', event: 'Final Production Release' },
                            ]).map((item: any, idx: number) => {
                              const status = getTimelineStatus(item.date);
                              return (
                                <div key={idx} className="flex flex-col items-center space-y-3 relative flex-1 text-center">
                                  <div className={`w-6 h-6 rounded-full border-4 border-white shadow-sm z-10 ${
                                    status === 'completed' ? 'bg-emerald-400' : 
                                    status === 'active' ? 'bg-[#FFE600] animate-pulse' : 
                                    'bg-slate-200'
                                  }`}></div>
                                  <div>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{item.date}</p>
                                    <p className={`text-[11px] font-bold leading-tight ${status === 'active' ? 'text-[#2E2E38]' : 'text-slate-900'}`}>{item.event}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Quick Navigation Tiles */}
                        <div className="grid grid-cols-2 gap-4">
                          {categoriesConfig.map((cat) => (
                            <button
                              key={cat.id}
                              onClick={() => {
                                setSelectedCategoryId(cat.id);
                                setView('categories');
                              }}
                              className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-[#FFE600]/30 transition-all text-left group"
                            >
                              <div className={`p-3 rounded-2xl ${cat.bg} inline-block mb-4 group-hover:scale-110 transition-transform`}>
                                <cat.icon className={`w-5 h-5 ${cat.color}`} />
                              </div>
                              <h4 className="text-sm font-black text-slate-900 mb-1">{cat.title}</h4>
                              <p className="text-[10px] text-slate-500 leading-tight">{cat.description}</p>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-8">
                        {/* Official Resources */}
                        <div className="bg-[#2E2E38] p-8 rounded-[40px] text-white shadow-xl shadow-slate-900/20">
                          <h3 className="text-lg font-black mb-6 tracking-tight flex items-center">
                            <Rocket className="w-5 h-5 mr-3 text-[#FFE600]" />
                            Official Resources
                          </h3>
                          <div className="space-y-4">
                            {(overviewData?.resources || [
                              { label: 'HTML Release Notes', url: 'https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm' },
                              { label: 'Release Notes PDF', url: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_pdf.htm' },
                              { label: 'Trailhead Highlights', url: 'https://trailhead.salesforce.com/content/learn/modules/spring-26-release-highlights' },
                              { label: 'Release Readiness', url: 'https://www.salesforce.com/video/release-readiness-spring-26/' },
                            ]).map((link: any, idx: number) => (
                              <a 
                                key={idx}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-between p-4 bg-white/5 rounded-2xl hover:bg-white/10 transition-colors group"
                              >
                                <span className="text-xs font-bold text-slate-300 group-hover:text-white transition-colors">{link.label}</span>
                                <ChevronLeft className="w-4 h-4 text-slate-500 rotate-180" />
                              </a>
                            ))}
                          </div>
                        </div>


                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-16">
                <div className="max-w-xl mx-auto mb-8">
                  <div className="relative group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-[#2E2E38] transition-colors" />
                    <input 
                      type="text"
                      placeholder="Search features, modules, or descriptions..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-[#FFE600]/30 transition-all text-slate-700"
                    />
                  </div>
                </div>

                {view === 'categories' && (
                  <div className="space-y-12">
                    {Object.entries(activeCategory?.modules || {}).length > 0 ? (
                      Object.entries(activeCategory?.modules || {}).map(([moduleName, features]: [string, any]) => (
                        <div key={moduleName} className="space-y-6">
                          <div className="flex items-center space-x-4">
                            <div className="h-px flex-1 bg-slate-200"></div>
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] px-4 whitespace-nowrap">
                              {moduleName}
                            </h3>
                            <div className="h-px flex-1 bg-slate-200"></div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {features.map((feature: any, fIdx: number) => (
                              <motion.div 
                                key={fIdx}
                                whileHover={{ y: -4 }}
                                onClick={() => fetchFeatureDeepDive(feature)}
                                className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100 hover:shadow-xl hover:shadow-[#FFE600]/30 transition-all flex flex-col cursor-pointer group"
                              >
                                <div className="flex justify-between items-start mb-6">
                                  <div className="flex space-x-2">
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                      (feature.phase?.toLowerCase() === 'ga' || feature.phase?.toLowerCase() === 'beta') ? 'bg-emerald-50 text-emerald-600' : 
                                      (feature.phase?.toLowerCase() === 'retiring' || feature.phase?.toLowerCase() === 'retired' || feature.phase?.toLowerCase() === 'discontinued') ? 'bg-rose-50 text-rose-600' :
                                      (feature.phase?.toLowerCase() === 'release update' || feature.phase?.toLowerCase() === 'release updates') ? 'bg-amber-50 text-amber-600' :
                                      'bg-slate-50 text-slate-600'
                                    }`}>
                                      {feature.phase}
                                    </span>
                                    {feature.requiresSetup && (
                                      <span className="px-3 py-1 bg-slate-50 text-slate-400 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center">
                                        <i className="fas fa-cog mr-1.5"></i> Setup
                                      </span>
                                    )}
                                  </div>
                                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Plus className="w-5 h-5 text-[#2E2E38]" />
                                  </div>
                                </div>

                                <h3 className="text-xl font-bold text-slate-900 mb-3 leading-tight group-hover:text-[#2E2E38] transition-colors">
                                  {feature.title}
                                </h3>
                                
                                <p className="text-[#2E2E38] text-sm font-semibold mb-4 italic leading-relaxed">
                                  "{feature.one_liner}"
                                </p>

                                <p className="text-slate-500 text-sm leading-relaxed mb-6 flex-1">
                                  {feature.description}
                                </p>

                                <div className="pt-6 border-t border-slate-50 mt-auto">
                                  <div className="flex items-center text-[10px] font-bold text-[#2E2E38] uppercase tracking-widest">
                                    <span>Drill Down for Deep Dive</span>
                                    <ChevronLeft className="w-3 h-3 ml-2 rotate-180 group-hover:translate-x-2 transition-transform" />
                                  </div>
                                </div>
                              </motion.div>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-20 bg-white rounded-[40px] border border-dashed border-slate-200">
                        <Search className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-slate-900 mb-2">No updates in this category</h3>
                        <p className="text-slate-500 max-w-xs mx-auto">
                          There are currently no release notes matching "{searchQuery}" in the {activeCategory?.title} category.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default EnhancedReleaseNotes;
