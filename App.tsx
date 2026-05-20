
import React, { useState, useRef, useEffect } from 'react';
import { useToast } from './components/Toast';
import { SalesforceOrgData, ViewType, AuthConfig, AuthResponse, MetadataCategory, ProxyProvider } from './types';
import { SalesforceService } from './services/salesforceService';
import { explainMetadata } from './services/geminiService';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import MetadataHub from './components/MetadataHub';
import MetadataExplorer from './components/MetadataExplorer';
import ObjectExplorer from './components/ObjectExplorer';
import DeepResearch from './components/DeepResearch';
import ControlTower from './components/ControlTower';
import AIChatBot from './components/AIChatBot';
import LogAnalyzer from './components/LogAnalyzer';
import AuthForm from './components/AuthForm';
import SalesforceOAuthLogin from './components/SalesforceOAuthLogin';
import { ToastProvider } from './components/Toast';
import { NotificationProvider } from './src/contexts/NotificationContext';
import MetadataSyncOverlay from './components/MetadataSyncOverlay';
import EnhancedReleaseNotes from './components/EnhancedReleaseNotes';
import ErrorBoundary from './components/ErrorBoundary';
import QueryEditor from './components/QueryEditor';
import EnhancedDataLoader from './components/EnhancedDataLoader';
import SecurityAnalysis from './components/SecurityAnalysis';
import JiraDebugger from './components/JiraDebugger';

import AppLogo from './components/AppLogo';

import { testConnection, auth } from './firebase';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <NotificationProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </NotificationProvider>
    </ErrorBoundary>
  );
};

const AppContent: React.FC = () => {
  const { toast } = useToast();
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [loginMode, setLoginMode] = useState<'password' | 'oauth'>('password');
  const [activeCategory, setActiveCategory] = useState<MetadataCategory | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [orgData, setOrgData] = useState<SalesforceOrgData | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [showExistingDataModal, setShowExistingDataModal] = useState(false);
  const [existingDataInfo, setExistingDataInfo] = useState<{ date: string, orgId: string } | null>(null);
  const [backgroundSync, setBackgroundSync] = useState<{
    isProcessing: boolean;
    total: number;
    current: number;
    category: string;
    item: string;
  }>({ isProcessing: false, total: 0, current: 0, category: '', item: '' });
  
  const [syncSource, setSyncSource] = useState<'salesforce' | 'database'>('salesforce');
  
  // Sync State
  const [isSyncing, setIsSyncing] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [syncProgress, setSyncProgress] = useState({
    category: '',
    item: '',
    current: 0,
    total: 0,
    errors: [] as string[]
  });
  
  const sfServiceRef = useRef<SalesforceService | null>(null);
  const [user, setUser] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    testConnection();
    
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setIsAuthReady(true);
      } else {
        try {
          const userCredential = await signInAnonymously(auth);
          setUser(userCredential.user);
          setIsAuthReady(true);
        } catch (error) {
          console.error("❌ Firebase anonymous sign-in failed:", error);
          setIsAuthReady(true); // Still set ready to avoid blocking UI, but user will be null
        }
      }
    });
    
    return () => unsubscribe();
  }, []);

  const syncAllMetadata = async (data: SalesforceOrgData) => {
    if (!sfServiceRef.current) return;
    
    setSyncSource('salesforce');
    setIsSyncing(true);
    abortControllerRef.current = new AbortController();
    
    setSyncProgress({
      category: 'Initializing',
      item: 'Preparing...',
      current: 0,
      total: 0,
      errors: []
    });

    const categories: MetadataCategory[] = [
      'objects', 'classes', 'triggers', 'vfPages', 'lwcs', 
      'flows', 'processBuilders', 'layouts', 'validationRules',
      'permissionSets', 'profiles', 'tabs', 'recordTypes', 'emailTemplates',
      'staticResources', 'labels', 'workflowRules', 'customMetadata', 'flexiPages', 'dashboards',
      'quickActions', 'buttons', 'automation'
    ];

    let totalItems = 0;
    const itemsToSync: { category: MetadataCategory, item: any }[] = [];
    const categoryResults: Partial<Record<MetadataCategory, any[]>> = {};

    // First pass: get all items
    for (const cat of categories) {
      setSyncProgress(prev => ({ ...prev, category: `Listing ${cat}...`, item: 'Fetching list' }));
      try {
        const records = await sfServiceRef.current.fetchCategory(cat);
        categoryResults[cat] = records;
        totalItems += (records || []).length;
        (records || []).forEach(r => itemsToSync.push({ category: cat, item: r }));
      } catch (e: any) {
        console.warn(`Failed to list ${cat}`, e);
        setSyncProgress(prev => ({ 
          ...prev, 
          errors: [...prev.errors, `Failed to list ${cat}: ${e.message}`] 
        }));
      }
    }

    // Update orgData with all lists at once
    setOrgData(prev => {
      if (!prev) return prev;
      const updatedSyncedCategories = { ...prev.syncedCategories };
      const updatedData = { ...prev };
      
      Object.keys(categoryResults).forEach(key => {
        const cat = key as MetadataCategory;
        (updatedData as any)[cat] = categoryResults[cat];
        updatedSyncedCategories[cat] = true;
      });
      
      return {
        ...updatedData,
        syncedCategories: updatedSyncedCategories
      };
    });

    // Filter layouts to only those whose objects exist in this Org
    if (categoryResults['layouts'] && categoryResults['objects']) {
      const objectNames = new Set(categoryResults['objects'].map(o => o.name));
      const filteredLayouts = categoryResults['layouts'].filter(l => 
        // TableEnumOrId (mapped to 'type') must be a valid object name
        objectNames.has(l.type)
      );
      
      // Update itemsToSync to use filtered layouts
      const nonLayoutItems = itemsToSync.filter(i => i.category !== 'layouts');
      const layoutItems = filteredLayouts.map(l => ({ category: 'layouts' as MetadataCategory, item: l }));
      
      // Re-calculate total and itemsToSync
      itemsToSync.length = 0;
      itemsToSync.push(...nonLayoutItems, ...layoutItems);
      totalItems = itemsToSync.length;
    }

    setSyncProgress(prev => ({ ...prev, total: totalItems, current: 0 }));

    // Second pass: fetch content and store
    const BATCH_SIZE = 10; // Increased from 3
    const errors: string[] = [];

    // Pre-fetch object related metadata if we have objects to sync
    let preFetchedObjectMetadata: any = null;
    if (itemsToSync.some(i => i.category === 'objects')) {
      setSyncProgress(prev => ({ ...prev, category: 'Objects', item: 'Pre-fetching related metadata...' }));
      preFetchedObjectMetadata = await sfServiceRef.current.fetchObjectsMetadataInBulk();
    }

    for (let i = 0; i < itemsToSync.length; i += BATCH_SIZE) {
      if (abortControllerRef.current?.signal.aborted) {
        toast({
          title: 'Sync Cancelled',
          message: 'Metadata synchronization was cancelled by the user.',
          type: 'info',
        });
        break;
      }

      // Add a small delay between batches to be nice to the API
      if (i > 0) await new Promise(resolve => setTimeout(resolve, 500));

      const batch = itemsToSync.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async ({ category, item }) => {
        if (abortControllerRef.current?.signal.aborted) return;
        
        try {
          setSyncProgress(prev => ({ 
            ...prev, 
            category, 
            item: item.name || item.label || item.id, 
            current: prev.current + 1 
          }));

          const metadataResult = await sfServiceRef.current!.fetchMetadataContent(
            category, 
            item.id, 
            category === 'objects' ? preFetchedObjectMetadata : undefined
          );
          
          const { content, lwcFiles, metaXml, ...extraMetadata } = metadataResult;
          
          // Store in DB (Content only to avoid payload size issues)
          await fetch('/api/metadata/store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orgId: data.orgId,
              category,
              metadataId: item.id,
              content,
              lwcFiles,
              metaXml,
              name: item.name || item.label || item.id,
              label: item.label || item.name || item.id,
              hasFullMetadata: category === 'objects',
              ownerUid: auth.currentUser?.uid,
              UserType: extraMetadata.UserType || item.UserType,
              UserLicense: extraMetadata.UserLicense || item.UserLicense,
              ...(category === 'objects' ? { relatedMetadata: extraMetadata } : extraMetadata)
            })
          });
        } catch (e: any) {
          if (abortControllerRef.current?.signal.aborted) return;
          console.error(`Failed to sync ${category} ${item.name}`, e);
          const errorMsg = `Failed to sync ${category} ${item.name || item.id}: ${e.message}`;
          errors.push(errorMsg);
          setSyncProgress(prev => ({ 
            ...prev, 
            errors: [...prev.errors, errorMsg] 
          }));
        }
      }));
    }

    setIsSyncing(false);
    // Fetch full data from DB to merge changes
    try {
      const res = await fetch(`/api/metadata/${data.orgId}/all`);
      if (res.ok) {
        const allData = await res.json();
        setOrgData(prev => ({ ...prev!, ...allData }));
      }
    } catch (e) {
      console.error("Failed to re-fetch full data from DB after sync", e);
    }
    const wasAborted = abortControllerRef.current?.signal.aborted;
    abortControllerRef.current = null;
    
    if (errors.length > 0) {
      toast({
        title: 'Sync Completed with Errors',
        message: `Metadata synchronization completed with ${errors.length} errors.`,
        type: 'error',
      });
    } else if (!wasAborted) {
      toast({
        title: 'Metadata Stored',
        message: 'Metadata storage complete! AI explanations will be generated on-demand when you open a component.',
        type: 'info',
      });
    }
  };

  const cancelSync = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsSyncing(false);
    }
  };

  const handleLogout = async () => {
    if (orgData) {
      try {
        await fetch(`/api/orgs/${orgData.orgId}/chat-history`, { method: 'DELETE' });
      } catch (e) {
        console.error("Failed to clear chat history", e);
      }
    }
    if (sfServiceRef.current) {
      await sfServiceRef.current.revokeToken();
    }
    setOrgData(null);
    sfServiceRef.current = null;
    toast({
      title: 'Logged Out',
      message: 'Logged out successfully. Session token revoked.',
      type: 'info',
    });
  };

  const getProxiedTokenUrl = (baseUrl: string, provider: ProxyProvider): string => {
    const tokenUrl = `${baseUrl}/services/oauth2/token`;
    if (provider === 'none') return tokenUrl;
    
    switch (provider) {
      case 'corsproxy':
        return `https://corsproxy.io/?${encodeURIComponent(tokenUrl)}`;
      case 'allorigins':
        return `https://api.allorigins.win/raw?url=${encodeURIComponent(tokenUrl)}`;
      case 'codetabs':
        return `https://api.codetabs.com/v1/proxy?url=${encodeURIComponent(tokenUrl)}`;
      default:
        return tokenUrl;
    }
  };

  const handleConnect = async (config: AuthConfig) => {
    setIsConnecting(true);
    setConnectionError(null);
    try {
      // 1. Sanitize Inputs
      const baseUrl = config.instanceUrl.trim().replace(/\/+$/, '');
      if (!baseUrl.startsWith('https://')) {
        throw new Error("INVALID_URL: Instance URL must start with https://");
      }

      const tokenUrl = `${baseUrl}/services/oauth2/token`;
      
      const params = new URLSearchParams();
      params.append('grant_type', 'password');
      params.append('client_id', config.clientId.trim());
      params.append('client_secret', config.clientSecret.trim());
      params.append('username', config.username.trim());
      params.append('password', config.password.trim());

      let authRes: Response;

      if (config.useProxy) {
        // Use Backend Proxy (Default)
        authRes = await fetch('/api/sf/proxy', { 
          method: 'POST', 
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: tokenUrl,
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Accept': 'application/json'
            },
            body: params.toString(),
            username: config.username.trim(),
            clientId: config.clientId.trim(),
            clientSecret: config.clientSecret.trim(),
            saveCreds: true, // We always try to save if successful
            ownerUid: user?.uid
          })
        });
      } else {
        // Direct Mode (Browser -> Salesforce)
        // Note: This typically requires a browser extension or disabled CORS on the browser
        // because Salesforce OAuth endpoints do not support CORS.
        authRes = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          body: params
        });
      }

      // 3. Robust Error Detection
      const contentType = authRes.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        const bodyText = await authRes.text();
        if (bodyText.includes('Zscaler') || bodyText.includes('Anonymizer') || bodyText.includes('blocked')) {
          throw new Error(`ZSCALER_BLOCK: The proxy '${config.proxyProvider}' is blocked. Your IT treats it as a 'security bypass'. Switch to 'Direct Mode' in Advanced Settings.`);
        }
      }

      if (!authRes.ok) {
        let errorData: any = {};
        const resClone = authRes.clone();
        try {
          errorData = await authRes.json();
        } catch (e) {
          const rawText = await resClone.text();
          throw new Error(`Auth Error ${authRes.status}: ${rawText.substring(0, 100)}`);
        }
        
        const errorMsg = errorData.error_description || errorData.error || `Code ${authRes.status}`;
        
        if (authRes.status === 400) {
          throw new Error(`OAUTH_400: ${errorMsg}. Hint: Check Client Secret and ensure Password + Security Token are concatenated.`);
        }
        throw new Error(`Auth Failed: ${errorMsg}`);
      }

      const authData: AuthResponse = await authRes.json();
      
      const serviceProxyMode = config.useHybridMode ? 'none' : config.proxyProvider;
      // We use the config.useProxy directly. 
      // If Direct Mode is ON, useProxy is false -> SalesforceService uses direct fetch.
      // If Direct Mode is OFF, useProxy is true -> SalesforceService uses backend proxy.
      const serviceUseProxy = config.useProxy;

      sfServiceRef.current = new SalesforceService(
        authData.access_token, 
        authData.instance_url, 
        serviceUseProxy, 
        serviceProxyMode as ProxyProvider,
        {
          clientId: config.clientId.trim(),
          clientSecret: config.clientSecret.trim(),
          username: config.username.trim(),
          password: config.password.trim(),
          onRefresh: async (newToken: string, newUrl: string) => {
            console.log("🔄 Source org token refreshed.");
            // Update the org credentials in Firestore if we have an orgId
            const currentOrgId = sfServiceRef.current?.getOrgId();
            if (currentOrgId) {
              try {
                await fetch(`/api/org/update/${currentOrgId}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ accessToken: newToken, instanceUrl: newUrl, ownerUid: user?.uid })
                });
                console.log("✅ Source org token updated in database.");
              } catch (e) {
                console.error("❌ Failed to update source org token in database:", e);
              }
            }
          }
        }
      );

      const initialData = await sfServiceRef.current.initializeOrgData(authData); 
      sfServiceRef.current.setOrgId(initialData.orgId);
      
      // Register org in DB to ensure ownership
      if (auth.currentUser) {
        try {
          await fetch('/api/org/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orgId: initialData.orgId,
              ownerUid: auth.currentUser.uid,
              name: initialData.orgName,
              instanceUrl: initialData.instanceUrl
            })
          });
          console.log("✅ Org registered in database.");
        } catch (e) {
          console.error("❌ Failed to register org in database:", e);
        }
      }
      
      setOrgData(initialData);
      
      // Check if org exists in DB
      try {
        const checkRes = await fetch(`/api/org/check/${initialData.orgId}`);
        const checkData = await checkRes.json();
        
        if (checkData.exists) {
          const lastSyncDate = checkData.lastSyncAt 
            ? new Date(checkData.lastSyncAt._seconds * 1000).toLocaleString() 
            : 'an unknown date';
          
          setExistingDataInfo({ date: lastSyncDate, orgId: initialData.orgId });
          setShowExistingDataModal(true);
        } else {
          // Trigger full sync only for new orgs
          await syncAllMetadata(initialData);
        }
      } catch (e) {
        console.warn("Failed to check org status, proceeding with sync", e);
        await syncAllMetadata(initialData);
      }
      
      toast({
        title: 'Connected',
        message: 'Successfully connected to Salesforce Org.',
        type: 'success',
      });
    } catch (err: any) {
      console.error("Connection Error Trace:", err);
      
      if (err.name === 'AbortError') {
        setConnectionError("TIMED_OUT: The connection took longer than 30 seconds. This happens when Zscaler silently drops the packet. Switch to 'Direct Mode' and whiltelist CORS.");
      } else if (err.message.includes('INVALID_URL')) {
        setConnectionError(err.message.split(':')[1]);
      } else if (err.message.includes('ZSCALER_BLOCK')) {
        setConnectionError(err.message);
      } else if (err.message.includes('OAUTH_400')) {
        setConnectionError(err.message.split(':')[1]);
      } else if (err.name === 'TypeError' || err.message.includes('fetch')) {
        setConnectionError("NETWORK_FAILURE: Your browser blocked the request. If you are using 'Direct Mode', ensure Salesforce CORS whitelisting is complete.");
      } else {
        setConnectionError(err.message || "An unexpected error occurred during connection.");
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleOAuthSuccess = async (data?: any) => {
    // After OAuth success, we need to fetch the org data
    setIsConnecting(true);
    setConnectionError(null);
    
    try {
      let authData: AuthResponse;
      
      if (data) {
        authData = data;
      } else {
        const response = await fetch('/api/auth/salesforce/session');
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'Failed to retrieve OAuth session.');
        }
        authData = await response.json();
      }
      
      sfServiceRef.current = new SalesforceService(
        authData.access_token, 
        authData.instance_url, 
        true, // useProxy
        'allorigins',
        {
          clientId: authData.clientId || '', 
          clientSecret: '', // Server will use env var or DB
          username: authData.username || '',
          refreshToken: authData.refresh_token,
          onRefresh: (newToken) => {
            console.log('🔄 Token refreshed successfully');
            setOrgData(prev => prev ? { ...prev, accessToken: newToken } : null);
          }
        }
      );

      const initialData = await sfServiceRef.current.initializeOrgData(authData); 
      sfServiceRef.current.setOrgId(initialData.orgId);
      
      // Register org in DB to ensure ownership
      if (auth.currentUser) {
        try {
          await fetch('/api/org/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orgId: initialData.orgId,
              ownerUid: auth.currentUser.uid,
              name: initialData.orgName,
              instanceUrl: initialData.instanceUrl
            })
          });
          console.log("✅ Org registered in database.");
        } catch (e) {
          console.error("❌ Failed to register org in database:", e);
        }
      }

      // Check if org exists in DB
      try {
        const checkRes = await fetch(`/api/org/check/${initialData.orgId}`);
        const checkData = await checkRes.json();
        
        if (checkData.exists) {
          const lastSyncDate = checkData.lastSyncAt 
            ? new Date(checkData.lastSyncAt._seconds * 1000).toLocaleString() 
            : 'an unknown date';
          
          setExistingDataInfo({ date: lastSyncDate, orgId: initialData.orgId });
          setShowExistingDataModal(true);
          setOrgData(initialData);
        } else {
          setOrgData(initialData);
          // Trigger full sync only for new orgs
          await syncAllMetadata(initialData);
        }
      } catch (e) {
        console.error("Failed to check existing org in DB", e);
        setOrgData(initialData);
      }
      
      toast({
        title: 'Connected',
        message: 'Successfully connected via Salesforce OAuth.',
        type: 'success',
      });
    } catch (err: any) {
      console.error("OAuth Session Fetch Error:", err);
      setConnectionError(err.message || 'Failed to retrieve OAuth session.');
      toast({
        title: 'Connection Failed',
        message: err.message || 'Failed to retrieve OAuth session.',
        type: 'error',
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const syncCategory = async (category: MetadataCategory) => {
    if (!sfServiceRef.current || !orgData) return;
    
    setActiveCategory(category);
    setCurrentView(category === 'objects' ? 'objects' : 'metadata_hub');

    if (category === 'objects') {
      // For objects, we want to trigger the sync process for just this category
      await syncAllInCategory('objects');
      return;
    }

    if (orgData.syncedCategories[category]) return;

    // Try to fetch from DB first
    try {
      const dbRes = await fetch(`/api/metadata/${orgData.orgId}/${category}`);
      if (dbRes.ok) {
        const dbItems = await dbRes.json();
        if (dbItems && dbItems.length > 0) {
          setOrgData({
            ...orgData,
            [category]: dbItems,
            syncedCategories: { ...orgData.syncedCategories, [category]: true }
          });
          toast({
            title: 'Loaded from Database',
            message: `Loaded ${dbItems.length} ${category} from database.`,
            type: 'info',
          });
          return;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch from DB, falling back to Salesforce", e);
    }

    // Fallback to Salesforce only if DB is empty or failed
    toast({
      title: 'Fetching Metadata',
      message: `Pulling ${category} from org, please wait...`,
      type: 'info',
    });
    
    try {
      const result = await sfServiceRef.current.fetchCategory(category);
      setOrgData({
        ...orgData,
        [category]: result,
        syncedCategories: { ...orgData.syncedCategories, [category]: true }
      });
      toast({
        title: 'Sync Successful',
        message: `${category.charAt(0).toUpperCase() + category.slice(1)} synced successfully.`,
        type: 'success',
      });
    } catch (err: any) {
      toast({
        title: 'Sync Failed',
        message: `Failed to sync ${category}: ${err.message}`,
        type: 'error',
      });
    }
  };

  const syncAllInCategory = async (category: MetadataCategory) => {
    if (!sfServiceRef.current || !orgData) return;

    setSyncSource('salesforce');
    setIsSyncing(true);
    abortControllerRef.current = new AbortController();
    setSyncProgress({
      category: `Listing ${category}...`,
      item: 'Fetching list',
      current: 0,
      total: 0,
      errors: []
    });

    try {
      const records = await sfServiceRef.current.fetchCategory(category);
      
      // Update list in state
      setOrgData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          [category]: records,
          syncedCategories: { ...prev.syncedCategories, [category]: true }
        };
      });

      setSyncProgress(prev => ({ ...prev, total: (records || []).length, current: 0 }));

      const BATCH_SIZE = 10; // Increased from 3
      const errors: string[] = [];

      // Pre-fetch object related metadata if we are syncing objects
      let preFetchedObjectMetadata: any = null;
      if (category === 'objects') {
        setSyncProgress(prev => ({ ...prev, item: 'Pre-fetching related metadata...' }));
        preFetchedObjectMetadata = await sfServiceRef.current.fetchObjectsMetadataInBulk();
      }

      for (let i = 0; i < (records || []).length; i += BATCH_SIZE) {
        if (abortControllerRef.current?.signal.aborted) {
          toast({
            title: 'Sync Cancelled',
            message: 'Metadata synchronization was cancelled by the user.',
            type: 'info',
          });
          break;
        }

        // Add a small delay between batches
        if (i > 0) await new Promise(resolve => setTimeout(resolve, 500));

        const batch = records.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (item) => {
          if (abortControllerRef.current?.signal.aborted) return;
          
          try {
            setSyncProgress(prev => ({ 
              ...prev, 
              category, 
              item: item.name || item.label || item.id, 
              current: prev.current + 1 
            }));

            const { content, metaXml, lwcFiles, ...extraMetadata } = await sfServiceRef.current!.fetchMetadataContent(
              category, 
              item.id, 
              category === 'objects' ? preFetchedObjectMetadata : undefined
            );
            
            // Store in DB
            await fetch('/api/metadata/store', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orgId: orgData.orgId,
                category,
                metadataId: item.id,
                content,
                metaXml,
                lwcFiles,
                name: item.name || item.label || item.id,
                label: item.label || item.name || item.id,
                hasFullMetadata: category === 'objects',
                ownerUid: user?.uid,
                ...(category === 'objects' ? { relatedMetadata: extraMetadata } : extraMetadata)
              })
            });
          } catch (e: any) {
            if (abortControllerRef.current?.signal.aborted) return;
            console.error(`Failed to sync ${category} ${item.name}`, e);
            errors.push(`Failed to sync ${item.name || item.id}: ${e.message}`);
          }
        }));
      }

      const wasAborted = abortControllerRef.current?.signal.aborted;
      abortControllerRef.current = null;

      if (errors.length > 0) {
        toast({
        title: 'Sync Completed with Errors',
        message: `Synchronization for ${category} completed with ${errors.length} errors.`,
        type: 'error',
      });
      } else if (!wasAborted) {
        toast({
        title: 'Sync Successful',
        message: `Successfully retrieved all ${(records || []).length} ${category} components! AI explanations will be generated on-demand.`,
        type: 'success',
      });
      }
    } catch (err: any) {
      toast({
        title: 'Sync Failed',
        message: `Failed to sync ${category}: ${err.message}`,
        type: 'error',
      });
    } finally {
      setIsSyncing(false);
      // Fetch category data from DB to merge changes
      try {
        const res = await fetch(`/api/metadata/${orgData.orgId}/${category}`);
        if (res.ok) {
          const dbItems = await res.json();
          setOrgData(prev => ({ ...prev!, [category]: dbItems }));
        }
      } catch (e) {
        console.error(`Failed to re-fetch ${category} from DB after sync`, e);
      }
    }
  };



  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#2E2E38] flex flex-col items-center justify-center p-6">
        <div className="relative mb-8">
          <div className="absolute -inset-4 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
          <AppLogo size="xl" className="animate-pulse" />
        </div>
        <p className="text-blue-400 text-sm font-medium tracking-widest uppercase animate-pulse">Initializing Secure Session...</p>
      </div>
    );
  }

  return (
    <>
      {orgData ? (
        <div className="flex h-screen bg-slate-50 overflow-hidden">
          <Sidebar 
            currentView={currentView} 
            setView={(v) => { setCurrentView(v); if(v !== 'metadata_hub') setActiveCategory(null); }} 
            user={orgData.user} 
            onRetrieveMetadata={() => syncAllMetadata(orgData)}
            onLogout={handleLogout}
          />
          
          <div className="flex-1 flex flex-col min-w-0 relative">
            <Header 
              orgData={orgData} 
              searchTerm={searchTerm} 
              setSearchTerm={setSearchTerm} 
              activeCategory={activeCategory}
              setView={setCurrentView}
              backgroundSync={backgroundSync}
            />
            
            <main className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {currentView === 'dashboard' && <Dashboard orgData={orgData} isSyncing={isSyncing} />}
              {currentView === 'control-tower' && <ControlTower />}
              {currentView === 'objects' && (
                <ObjectExplorer 
                  orgData={orgData} 
                  searchTerm={searchTerm} 
                  sfService={sfServiceRef.current}
                  onOrgDataUpdate={setOrgData}
                  onSyncCategory={() => syncCategory('objects')}
                  onNavigateToMetadata={(category, name) => {
                    setCurrentView('metadata_hub');
                    setActiveCategory(category);
                    setSearchTerm(name);
                  }}
                />
              )}
              {currentView === 'metadata_hub' && (
                <MetadataHub 
                  orgData={orgData} 
                  onSyncCategory={syncCategory} 
                  onSyncAllInCategory={syncAllInCategory}
                  activeCategory={activeCategory}
                  setActiveCategory={setActiveCategory}
                  searchTerm={searchTerm}
                  sfService={sfServiceRef.current}
                  onOrgDataUpdate={setOrgData}
                />
              )}
              {currentView === 'ai-insights' && <DeepResearch orgData={orgData} />}
              {currentView === 'release-notes' && (
                <EnhancedReleaseNotes 
                  orgData={orgData} 
                  onSyncCategory={syncCategory}
                />
              )}
              {currentView === 'query-editor' && <QueryEditor orgData={orgData} sfService={sfServiceRef.current} />}
              {currentView === 'enhanced-data-loader' && <EnhancedDataLoader orgData={orgData!} sfService={sfServiceRef.current!} onOrgDataUpdate={setOrgData} />}
              {currentView === 'security-analysis' && <SecurityAnalysis orgData={orgData!} sfService={sfServiceRef.current!} onOrgDataUpdate={setOrgData} />}
              {currentView === 'debugger' && <JiraDebugger orgData={orgData!} sfService={sfServiceRef.current!} />}
            </main>

            <AIChatBot 
              orgData={orgData} 
              isOpen={isChatOpen} 
              onClose={() => setIsChatOpen(false)} 
            />

            <button
              onClick={() => setIsChatOpen(!isChatOpen)}
              className="fixed bottom-6 right-6 w-14 h-14 bg-[#FFE600] text-[#2E2E38] rounded-full shadow-2xl flex items-center justify-center hover:bg-[#E6CF00] hover:scale-110 transition-all z-[101]"
            >
              <i className={`fas ${isChatOpen ? 'fa-times' : 'fa-comment-dots'} text-xl`}></i>
            </button>

          </div>
          <MetadataSyncOverlay 
            isVisible={isSyncing}
            currentCategory={syncProgress.category}
            currentItem={syncProgress.item}
            progress={syncProgress.current}
            total={syncProgress.total}
            errorCount={syncProgress.errors.length}
            onCancel={cancelSync}
            source={syncSource}
          />

          {/* Existing Metadata Modal */}
          {showExistingDataModal && existingDataInfo && (
            <div className="fixed inset-0 z-[10000] bg-[#2E2E38]/60 backdrop-blur-sm flex items-center justify-center p-6 animate-fadeIn">
              <div className="max-w-md w-full bg-white rounded-[32px] p-10 shadow-2xl text-center transform animate-slideUp">
                <div className="w-16 h-16 bg-[#FFE600]/10 text-[#2E2E38] rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner">
                  <i className="fas fa-database text-2xl"></i>
                </div>
                
                <h2 className="text-2xl font-semibold text-slate-900 tracking-tight mb-3">Existing Metadata Found</h2>
                <p className="text-slate-500 text-sm mb-10 font-medium leading-relaxed">
                  This organization's metadata was last retrieved on <span className="text-slate-900 font-semibold">{existingDataInfo.date}</span>. 
                  Would you like to use the existing data or perform a fresh retrieval?
                </p>
                
                <div className="space-y-3">
                  <button 
                    onClick={async () => {
                      setShowExistingDataModal(false);
                      setSyncSource('database');
                      setIsSyncing(true);
                      setSyncProgress({
                        category: 'Database',
                        item: 'Retrieving all metadata...',
                        current: 0,
                        total: 100,
                        errors: []
                      });
                      try {
                        const res = await fetch(`/api/metadata/${existingDataInfo.orgId}/all`);
                        if (res.ok) {
                          const allData = await res.json();
                          setOrgData(prev => {
                            if (!prev) return prev;
                            const syncedCategories: any = {};
                            Object.keys(allData).forEach(cat => syncedCategories[cat] = true);
                            return {
                              ...prev,
                              ...allData,
                              syncedCategories
                            };
                          });
                          toast({
                            title: 'Data Loaded',
                            message: `Successfully loaded all metadata from the database.`,
                            type: 'success'
                          });
                        } else {
                          throw new Error("Failed to fetch all data from DB");
                        }
                      } catch (e: any) {
                        toast({
                          title: 'Load Failed',
                          message: `Could not load existing data: ${e.message}. Falling back to Salesforce.`,
                          type: 'error'
                        });
                        if (orgData) await syncAllMetadata(orgData);
                      } finally {
                        setIsSyncing(false);
                      }
                    }}
                    className="w-full py-4 bg-[#FFE600] text-[#2E2E38] font-semibold rounded-2xl shadow-xl shadow-[#FFE600]/20 hover:bg-[#E6CF00] transition-all uppercase tracking-widest text-[10px]"
                  >
                    Use Existing Data
                  </button>
                  <button 
                    onClick={async () => {
                      setShowExistingDataModal(false);
                      if (orgData) await syncAllMetadata(orgData);
                    }}
                    className="w-full py-4 bg-white text-slate-600 border border-slate-200 font-semibold rounded-2xl hover:bg-slate-50 transition-all uppercase tracking-widest text-[10px]"
                  >
                    Retrieve Fresh Metadata
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-screen bg-[#2E2E38] flex flex-col items-center justify-center p-6">
          {!isConnecting && (
            <div className="mb-8 flex flex-col items-center">
              <div className="flex items-center space-x-3 mb-4">
                <AppLogo size="xl" />
                <h1 className="text-4xl font-bold text-white tracking-tighter uppercase">Metaassist</h1>
              </div>
              <div className="flex p-1 bg-slate-800 rounded-2xl">
                <button 
                  onClick={() => setLoginMode('password')}
                  className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${loginMode === 'password' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  Password Flow
                </button>
                <button 
                  onClick={() => setLoginMode('oauth')}
                  className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${loginMode === 'oauth' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  OAuth Flow
                </button>
              </div>
            </div>
          )}

          {isConnecting ? (
            <div className="text-center animate-in fade-in zoom-in duration-500 flex flex-col items-center py-20">
              <div className="relative mb-12">
                <div className="absolute -inset-8 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                <div className="absolute -inset-4 border-2 border-indigo-500/20 border-b-indigo-500 rounded-full animate-[spin_2s_linear_reverse]"></div>
                <AppLogo size="xl" className="animate-pulse scale-150" />
              </div>
              <div className="flex items-center space-x-3 mb-4">
                <h1 className="text-4xl font-bold text-white tracking-tighter uppercase">Metaassist</h1>
              </div>
              <p className="text-blue-400 text-[10px] font-black tracking-[0.5em] uppercase animate-pulse">Connecting to Workspace...</p>
            </div>
          ) : loginMode === 'password' ? (
            <AuthForm onConnect={handleConnect} isConnecting={isConnecting} error={connectionError} />
          ) : (
            <div className="max-w-md w-full">
              <SalesforceOAuthLogin onSuccess={handleOAuthSuccess} />
              {connectionError && (
                <div className="mt-6 bg-rose-500/10 border border-rose-500/20 p-4 rounded-2xl text-rose-400 text-xs font-medium text-center animate-shake">
                  {connectionError}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default App;
