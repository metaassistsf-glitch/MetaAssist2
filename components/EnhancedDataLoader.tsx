
import React, { useState, useEffect, useRef } from 'react';
import { SalesforceOrgData, SalesforceObject } from '../types';
import { SalesforceService } from '../services/salesforceService';
import { DataLoaderService, DataLoaderFile, DeploymentResult, ParentRelationship } from '../services/dataLoaderService';
import { useNotifications } from '../src/contexts/NotificationContext';
import * as d3 from 'd3';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';

interface TargetCredential {
  id: string;
  name: string;
  instanceUrl: string;
  clientId: string;
  clientSecret: string;
  username?: string;
  password?: string;
  accessToken?: string;
  createdAt: string;
}

interface EnhancedDataLoaderProps {
  orgData: SalesforceOrgData;
  sfService: SalesforceService;
  onOrgDataUpdate: (update: (prev: SalesforceOrgData | null) => SalesforceOrgData | null) => void;
}

const EnhancedDataLoader: React.FC<EnhancedDataLoaderProps> = ({ orgData, sfService, onOrgDataUpdate }) => {
  const { addNotification } = useNotifications();
  const [files, setFiles] = useState<DataLoaderFile[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [deploymentResults, setDeploymentResults] = useState<DeploymentResult[]>([]);
  const [mode, setMode] = useState<'load' | 'move' | null>(null);
  const [currentStep, setCurrentStep] = useState<'home' | 'prepare' | 'upload' | 'fieldMapping' | 'visualize' | 'deploy' | 'targetConnect'>('home');
  const [parentObject, setParentObject] = useState<string | null>(null);
  const [childObjects, setChildObjects] = useState<string[]>([]);
  const [targetOrgConfig, setTargetOrgConfig] = useState<TargetCredential | null>(null);
  const [isTargetConnected, setIsTargetConnected] = useState(false);
  const [isFetchingSource, setIsFetchingSource] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<{ objectName: string; count: number; total: number } | null>(null);
  const [targetCredentials, setTargetCredentials] = useState<TargetCredential[]>([]);
  const [newCredName, setNewCredName] = useState('');
  const [newCredUrl, setNewCredUrl] = useState('');
  const [newCredClientId, setNewCredClientId] = useState('');
  const [newCredClientSecret, setNewCredClientSecret] = useState('');
  const [newCredUsername, setNewCredUsername] = useState('');
  const [newCredPassword, setNewCredPassword] = useState('');
  const [showNewCredForm, setShowNewCredForm] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [objectSearch, setObjectSearch] = useState('');
  const [childObjectSearch, setChildObjectSearch] = useState('');
  const [uploadSearch, setUploadSearch] = useState('');
  const [recordLimit, setRecordLimit] = useState<string>('');
  const prevRecordLimit = useRef<string>('');
  const [fieldMappings, setFieldMappings] = useState<Record<string, Record<string, string>>>({});
  const [fieldDefaultValues, setFieldDefaultValues] = useState<Record<string, Record<string, string>>>({});
  const [constantValues, setConstantValues] = useState<Record<string, Record<string, string>>>({});
  
  // Handle the "disabled by default" requirement for child objects when a limit is set
  useEffect(() => {
    if (recordLimit && !prevRecordLimit.current && childObjects.length > 0) {
      setChildObjects([]);
      addNotification('Info', 'Child objects unselected. When a limit is applied, please re-select the related objects you wish to include.', 'info');
    }
    prevRecordLimit.current = recordLimit;
  }, [recordLimit, childObjects.length, addNotification]);

  const dataLoaderService = useRef(new DataLoaderService(sfService));
  const targetServiceRef = useRef<SalesforceService | null>(null);
  const [targetOrgFields, setTargetOrgFields] = useState<Record<string, any[]>>({});
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        fetchUserCredentials(currentUser.uid);
      } else {
        // Try to sign in anonymously if no user is present
        try {
          const userCredential = await signInAnonymously(auth);
          setUser(userCredential.user);
          fetchUserCredentials(userCredential.user.uid);
        } catch (error) {
          console.error("Anonymous sign-in failed:", error);
          setUser(null);
          setTargetCredentials([]);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const fetchUserCredentials = async (uid: string) => {
    const path = `users/${uid}`;
    try {
      // In a real app, we'd query by ownerUid
      // For now, let's assume we can list them or they are stored in the user doc as before
      // but with the new fields.
      const userDoc = await getDoc(doc(db, 'users', uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setTargetCredentials(data.targetCredentials || []);
      } else {
        await setDoc(doc(db, 'users', uid), {
          uid,
          email: auth.currentUser?.email,
          targetCredentials: []
        });
        setTargetCredentials([]);
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, path);
      console.error('Failed to fetch user credentials', e);
      addNotification('Error', 'Failed to fetch stored credentials', 'error');
    }
  };

  const initializeTargetService = (cred: TargetCredential) => {
    targetServiceRef.current = new SalesforceService(
      cred.accessToken || '',
      cred.instanceUrl,
      true, // Always use proxy for target org
      'none',
      {
        clientId: cred.clientId,
        clientSecret: cred.clientSecret,
        username: cred.username,
        password: cred.password,
        onRefresh: async (newToken: string, newUrl: string) => {
          console.log("🔄 Target org token refreshed.");
          // Update the credential in state
          setTargetOrgConfig(prev => prev ? { ...prev, accessToken: newToken, instanceUrl: newUrl } : null);
          
          // Update in Firestore
          if (cred.id) {
            try {
              // 1. Update dedicated collection
              await updateDoc(doc(db, 'target_org_creds', cred.id), {
                accessToken: newToken,
                instanceUrl: newUrl,
                updatedAt: new Date().toISOString()
              });

              // 2. Update array in user document to keep in sync
              if (user?.uid) {
                const userDocRef = doc(db, 'users', user.uid);
                const userDoc = await getDoc(userDocRef);
                if (userDoc.exists()) {
                  const userData = userDoc.data();
                  const updatedCreds = (userData.targetCredentials || []).map((c: any) => 
                    c.id === cred.id ? { ...c, accessToken: newToken, instanceUrl: newUrl } : c
                  );
                  await updateDoc(userDocRef, { targetCredentials: updatedCreds });
                }
              }
              
              console.log("✅ Target org token updated in Firestore (both locations).");
            } catch (e) {
              console.error("❌ Failed to update target org token in Firestore:", e);
            }
          }
        }
      }
    );
  };

  const fetchTargetFields = async (objName: string) => {
    if (!targetServiceRef.current) return [];
    if (targetOrgFields[objName]) return targetOrgFields[objName];

    try {
      const describe = await targetServiceRef.current.describeSObject(objName);
      const fields = (describe.fields || []).map((f: any) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        createable: f.createable,
        updateable: f.updateable,
        nillable: f.nillable,
        defaultedOnCreate: f.defaultedOnCreate,
        required: f.nillable === false && f.type !== 'boolean' && f.defaultedOnCreate === false
      }));

      setTargetOrgFields(prev => ({ ...prev, [objName]: fields }));
      return fields;
    } catch (e) {
      console.error(`Failed to fetch target fields for ${objName}`, e);
      return [];
    }
  };

  const saveNewCredential = async () => {
    let currentUser = user;
    
    // If no user, try to sign in anonymously to allow saving
    if (!currentUser) {
      try {
        const userCredential = await signInAnonymously(auth);
        currentUser = userCredential.user;
        setUser(currentUser);
      } catch (authError: any) {
        console.error('Anonymous auth failed', authError);
        addNotification('Authentication Error', 'Could not establish a secure session to save credentials.', 'error');
        return;
      }
    }

    if (!newCredName || !newCredUrl || !newCredClientId || !newCredClientSecret) {
      addNotification('Missing Info', 'Please fill in all required credential fields', 'warning');
      return;
    }

    setIsTestingConnection(true);
    try {
      // Test the connection using Client Credentials flow via server
      const response = await fetch('/api/sf/target/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceUrl: newCredUrl,
          clientId: newCredClientId,
          clientSecret: newCredClientSecret,
          username: newCredUsername,
          password: newCredPassword
        })
      });

      const authData = await response.json();
      if (!response.ok) {
        throw new Error(authData.error || 'Failed to authenticate');
      }
      
      const newCred: TargetCredential = {
        id: Math.random().toString(36).substring(2, 15),
        name: newCredName,
        instanceUrl: authData.instance_url || newCredUrl,
        clientId: newCredClientId,
        clientSecret: newCredClientSecret,
        username: newCredUsername,
        password: newCredPassword,
        accessToken: authData.access_token,
        createdAt: new Date().toISOString()
      };

      const path = `users/${currentUser.uid}`;
      try {
        // Ensure user document exists
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
          await setDoc(userDocRef, {
            uid: currentUser.uid,
            email: currentUser.email || 'anonymous',
            createdAt: new Date().toISOString(),
            targetCredentials: [newCred]
          });
        } else {
          await updateDoc(userDocRef, {
            targetCredentials: arrayUnion(newCred)
          });
        }
        
        // Also store in the dedicated collection for better organization
        const credPath = `target_org_creds/${newCred.id}`;
        try {
          await setDoc(doc(db, 'target_org_creds', newCred.id), {
            ...newCred,
            ownerUid: currentUser.uid,
            updatedAt: new Date().toISOString()
          });
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, credPath);
        }
      } catch (e) {
        handleFirestoreError(e, OperationType.UPDATE, path);
      }
      setTargetCredentials(prev => [...prev, newCred]);
      setTargetOrgConfig(newCred);
      initializeTargetService(newCred);
      setIsTargetConnected(true);
      setShowNewCredForm(false);
      setNewCredName('');
      setNewCredUrl('');
      setNewCredClientId('');
      setNewCredClientSecret('');
      setNewCredUsername('');
      setNewCredPassword('');
      addNotification('Success', 'Target connection established and saved!', 'success');
    } catch (e: any) {
      console.error('Failed to connect or save credential', e);
      addNotification('Connection Failed', `Could not connect to Salesforce: ${e.message || 'Invalid credentials'}`, 'error');
    } finally {
      setIsTestingConnection(false);
    }
  };

  if (!orgData || !orgData.objects) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#FFE600]"></div>
      </div>
    );
  }

  const fetchObjectFields = async (objName: string) => {
    const obj = orgData.objects.find(o => (o.name || '').toLowerCase() === (objName || '').toLowerCase());
    if (!obj) {
      console.warn(`⚠️ Object ${objName} not found in orgData.objects`);
      return [];
    }
    
    // If we already have fields, return them
    if (obj.fields && obj.fields.length > 0) return obj.fields;

    console.log(`🔍 Fetching fields for ${obj.name}...`);
    try {
      const describe = await sfService.describeSObject(obj.name);
      const fields = (describe.fields || []).map((f: any) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        referenceTo: f.referenceTo,
        updateable: f.updateable,
        createable: f.createable,
        calculated: f.calculated,
        queryable: f.queryable,
        required: f.nillable === false && f.type !== 'boolean' && f.defaultedOnCreate === false
      }));

      console.log(`✅ Fetched ${fields.length} fields for ${obj.name}`);

      onOrgDataUpdate(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          objects: prev.objects.map(o => 
            o.name?.toLowerCase() === obj.name?.toLowerCase() ? { ...o, fields } : o
          )
        };
      });
      return fields;
    } catch (e) {
      console.error(`❌ Failed to fetch fields for ${objName}`, e);
      addNotification('Metadata Error', `Failed to fetch fields for ${objName}. Please try again.`, 'error');
      return [];
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    
    const uploadedFiles = Array.from(e.target.files);
    const parsedFiles = await Promise.all(uploadedFiles.map(async (file) => {
      const { data, fields } = await dataLoaderService.current.parseFile(file);
      
      if (!data || data.length === 0) {
        addNotification('Empty File', 'Both the excel uploaded is empty. Please populate some values and proceed for data creation.', 'error');
        return null;
      }

      // Guess object name from file name
      const baseName = file.name.split('.')[0]
        .replace(/\(.*\)$/, '') // Remove (in), (out), etc.
        .replace(/_Template$/, '')
        .trim();
      
      // Prioritize exact name match, then exact label match, then singular
      const matchedObject = orgData.objects.find(o => (o.name || '').toLowerCase() === (baseName || '').toLowerCase()) ||
                           orgData.objects.find(o => (o.label || '').toLowerCase() === (baseName || '').toLowerCase()) ||
                           orgData.objects.find(o => (o.name || '').toLowerCase() === (baseName || '').replace(/s$/, '').toLowerCase());

      const objectName = matchedObject?.name || baseName;
      
      // Fetch fields if missing
      let sfFieldsList = matchedObject?.fields || [];
      if (matchedObject && (!sfFieldsList || sfFieldsList.length === 0)) {
        sfFieldsList = await fetchObjectFields(matchedObject.name);
      }

      const externalIdField = objectName === parentObject ? fields.find(f => (f || '').toLowerCase() === 'external_id' || (f || '').toLowerCase() === 'id') : undefined;
      
      // Auto-detect relationships if headers match SF lookup fields
      const parentRelationships: ParentRelationship[] = [];
      if (sfFieldsList && sfFieldsList.length > 0) {
        sfFieldsList.filter((f: any) => f.type === 'reference').forEach((sfField: any) => {
          const matchingHeader = fields.find(h => (h || '').toLowerCase() === (sfField.name || '').toLowerCase());
          if (matchingHeader) {
            // Find which object this lookup points to
            const targetObject = sfField.referenceTo?.[0];
            if (targetObject === parentObject) {
              parentRelationships.push({
                parentObject: targetObject, 
                parentKeyField: 'External_ID',
                childLookupField: matchingHeader,
                sfLookupField: sfField.name
              });
            }
          }
        });
      }

      // Auto-detect field mapping
      const fieldMapping: Record<string, string> = {};
      if (sfFieldsList && sfFieldsList.length > 0) {
        fields.forEach(header => {
          if ((header || '').toLowerCase() === 'external_id') return;

          // Try to extract API name from "Label (APIName)" format
          const apiMatch = header?.match(/\(([^)]+)\)$/);
          const apiName = apiMatch ? apiMatch[1] : header;
          const normalizedHeader = (header || '').toLowerCase().replace(/[^a-z0-9]/g, '');

          const sfField = sfFieldsList.find((f: any) => 
            (f.name || '').toLowerCase() === (apiName || '').toLowerCase() || 
            (f.name || '').toLowerCase() === (header || '').toLowerCase() || 
            (f.label || '').toLowerCase() === (header || '').toLowerCase() ||
            (f.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedHeader ||
            (f.label || '').toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedHeader
          );
          if (sfField) {
            fieldMapping[header] = sfField.name;
          }
        });
      }

      return {
        name: file.name,
        objectName: matchedObject?.name || objectName,
        data,
        fields,
        externalIdField,
        parentRelationships,
        fieldMapping
      } as DataLoaderFile;
    }));

    const validFiles = parsedFiles.filter((f): f is DataLoaderFile => f !== null);
    setFiles(prev => [...prev, ...validFiles]);
  };

  const renderDiagram = () => {
    if (!svgRef.current) return;
    if (mode === 'load' && files.length === 0) return;
    if (mode === 'move' && !parentObject) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    const container = svg.append("g");

    const zoom = d3.zoom()
      .scaleExtent([0.1, 3])
      .on("zoom", (event) => {
        container.attr("transform", event.transform);
      });

    svg.call(zoom as any);
    
    let rootData: any;

    if (mode === 'load') {
      const rootFile = files.find(f => f.objectName === parentObject);
      if (!rootFile) return;

      const buildTree = (file: DataLoaderFile): any => {
        const children = files.filter(f => 
          f.parentRelationships?.some(rel => rel.parentObject === file.objectName)
        );
        return {
          name: file.objectName,
          fileName: file.name,
          fields: file.fields.filter(f => file.fieldMapping?.[f]).slice(0, 5),
          totalFields: file.fields.filter(f => file.fieldMapping?.[f]).length,
          children: children.map(buildTree)
        };
      };
      rootData = buildTree(rootFile);
    } else {
      // Move mode: Build tree from parentObject and childObjects
      const buildMoveTree = (objName: string): any => {
        const obj = orgData.objects.find(o => o.name === objName);
        
        // If it's the parent, all childObjects are its children
        // If it's a child, it has no children in this simplified flat model
        const children = objName === parentObject ? childObjects : [];

        return {
          name: objName,
          fileName: "Source Org Data",
          fields: (obj?.fields || []).filter(f => fieldMappings[objName]?.[f.name]).slice(0, 10).map(f => f.label),
          totalFields: (obj?.fields || []).filter(f => fieldMappings[objName]?.[f.name]).length,
          children: children.map(buildMoveTree)
        };
      };
      rootData = buildMoveTree(parentObject!);
    }

    const root = d3.hierarchy(rootData);
    const treeLayout = d3.tree().size([width - 200, height - 200]);
    treeLayout(root);

    const g = container.append("g").attr("transform", "translate(100, 100)");

    // Draw links
    g.selectAll(".link")
      .data(root.links())
      .enter()
      .append("path")
      .attr("class", "link")
      .attr("d", d3.linkVertical()
        .x((d: any) => d.x)
        .y((d: any) => d.y) as any)
      .attr("fill", "none")
      .attr("stroke", "#cbd5e1")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "5,5");

    // Draw nodes
    const node = g.selectAll(".node")
      .data(root.descendants())
      .enter()
      .append("g")
      .attr("class", "node")
      .attr("transform", d => `translate(${d.x},${d.y})`);

    // Node Card
    node.append("rect")
      .attr("x", -80)
      .attr("y", -40)
      .attr("width", 160)
      .attr("height", d => 80 + (d.data.fields.length * 15))
      .attr("rx", 16)
      .attr("fill", d => d.depth === 0 ? "#0f172a" : "#ffffff")
      .attr("stroke", d => d.depth === 0 ? "#1e293b" : "#e2e8f0")
      .attr("stroke-width", 2)
      .attr("filter", "drop-shadow(0 4px 6px rgba(0,0,0,0.05))");

    // Object Icon background
    node.append("rect")
      .attr("x", -70)
      .attr("y", -30)
      .attr("width", 30)
      .attr("height", 30)
      .attr("rx", 8)
      .attr("fill", d => d.depth === 0 ? "#3b82f6" : "#f1f5f9");

    // Object Name
    node.append("text")
      .attr("x", -30)
      .attr("y", -18)
      .attr("fill", d => d.depth === 0 ? "#ffffff" : "#0f172a")
      .attr("font-size", "12px")
      .attr("font-weight", "bold")
      .text(d => d.data.name);

    // File Name
    node.append("text")
      .attr("x", -30)
      .attr("y", -4)
      .attr("fill", d => d.depth === 0 ? "#94a3b8" : "#64748b")
      .attr("font-size", "9px")
      .text(d => d.data.fileName);

    // Fields Header
    node.append("text")
      .attr("x", -70)
      .attr("y", 25)
      .attr("fill", d => d.depth === 0 ? "#64748b" : "#94a3b8")
      .attr("font-size", "8px")
      .attr("font-weight", "bold")
      .attr("text-transform", "uppercase")
      .text("Mapped Fields");

    // Fields List
    node.each(function(d: any) {
      const nodeGroup = d3.select(this);
      d.data.fields.forEach((field: string, i: number) => {
        nodeGroup.append("text")
          .attr("x", -70)
          .attr("y", 40 + (i * 15))
          .attr("fill", d.depth === 0 ? "#cbd5e1" : "#475569")
          .attr("font-size", "9px")
          .text(`• ${field.length > 20 ? field.substring(0, 17) + '...' : field}`);
      });

      if (d.data.totalFields > 5) {
        nodeGroup.append("text")
          .attr("x", -70)
          .attr("y", 40 + (d.data.fields.length * 15))
          .attr("fill", "#3b82f6")
          .attr("font-size", "8px")
          .attr("font-style", "italic")
          .text(`+ ${d.data.totalFields - 5} more fields`);
      }
    });
  };

  useEffect(() => {
    if (currentStep === 'visualize') {
      renderDiagram();
    }
  }, [currentStep, files]);

  const startDeployment = async () => {
    if (!targetOrgConfig) return;
    setIsDeploying(true);
    setDeploymentResults([]);
    
    try {
      let effectiveInstanceUrl = targetOrgConfig.instanceUrl;
      let effectiveAccessToken = targetOrgConfig.accessToken;

      // Ensure we're not using a login URL for API calls (Bulk API V2 requirement)
      if (effectiveInstanceUrl.includes('login.salesforce.com') || effectiveInstanceUrl.includes('test.salesforce.com')) {
        console.log("🔄 Login URL detected for target org. Re-authenticating to get instance URL...");
        const authResponse = await fetch('/api/sf/target/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instanceUrl: targetOrgConfig.instanceUrl,
            clientId: targetOrgConfig.clientId,
            clientSecret: targetOrgConfig.clientSecret,
            username: targetOrgConfig.username,
            password: targetOrgConfig.password
          })
        });

        const authData = await authResponse.json();
        if (authResponse.ok && authData.instance_url) {
          effectiveInstanceUrl = authData.instance_url;
          effectiveAccessToken = authData.access_token;
          console.log(`✅ Re-authenticated. New instance URL: ${effectiveInstanceUrl}`);
        } else {
          console.warn("⚠️ Re-authentication failed. Attempting with original URL...");
        }
      }

      const targetService = new SalesforceService(
        effectiveAccessToken!, 
        effectiveInstanceUrl, 
        true, 
        'allorigins',
        {
          clientId: targetOrgConfig.clientId,
          clientSecret: targetOrgConfig.clientSecret,
          username: targetOrgConfig.username,
          password: targetOrgConfig.password,
          onRefresh: (newToken: string, newUrl: string) => {
            setTargetOrgConfig(prev => prev ? { ...prev, accessToken: newToken, instanceUrl: newUrl } : null);
          }
        }
      );
      const targetDataLoaderService = new DataLoaderService(targetService);
      await targetDataLoaderService.deployHierarchy(files, (result) => {
        setDeploymentResults(prev => {
          const existingIdx = prev.findIndex(r => r.objectName === result.objectName);
          if (existingIdx >= 0) {
            const newResults = [...prev];
            newResults[existingIdx] = result;
            return newResults;
          }
          return [...prev, result];
        });
      });
    } catch (e) {
      console.error("Deployment failed", e);
      addNotification('Deployment Failed', 'An error occurred during deployment. Please check the logs.', 'error');
    } finally {
      setIsDeploying(false);
    }
  };

  const handleMoveDeployment = async () => {
    if (!targetOrgConfig || !parentObject) return;
    
    setIsDeploying(true);
    setDeploymentResults([]);
    
    try {
      let effectiveInstanceUrl = targetOrgConfig.instanceUrl;
      let effectiveAccessToken = targetOrgConfig.accessToken;

      // Ensure we're not using a login URL for API calls (Bulk API V2 requirement)
      if (effectiveInstanceUrl.includes('login.salesforce.com') || effectiveInstanceUrl.includes('test.salesforce.com')) {
        console.log("🔄 Login URL detected for target org. Re-authenticating to get instance URL...");
        const authResponse = await fetch('/api/sf/target/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instanceUrl: targetOrgConfig.instanceUrl,
            clientId: targetOrgConfig.clientId,
            clientSecret: targetOrgConfig.clientSecret,
            username: targetOrgConfig.username,
            password: targetOrgConfig.password
          })
        });

        const authData = await authResponse.json();
        if (authResponse.ok && authData.instance_url) {
          effectiveInstanceUrl = authData.instance_url;
          effectiveAccessToken = authData.access_token;
          console.log(`✅ Re-authenticated. New instance URL: ${effectiveInstanceUrl}`);
        } else {
          console.warn("⚠️ Re-authentication failed. Attempting with original URL...");
        }
      }

      const targetService = new SalesforceService(
        effectiveAccessToken!, 
        effectiveInstanceUrl, 
        true, 
        'allorigins',
        {
          clientId: targetOrgConfig.clientId,
          clientSecret: targetOrgConfig.clientSecret,
          username: targetOrgConfig.username,
          password: targetOrgConfig.password,
          onRefresh: (newToken: string, newUrl: string) => {
            setTargetOrgConfig(prev => prev ? { ...prev, accessToken: newToken, instanceUrl: newUrl } : null);
          }
        }
      );
      const objectsToMove = [parentObject, ...childObjects];
      
      // Map to store Source ID -> Target ID for relationship mapping
      const idMap: Record<string, string> = {};

      for (const objName of objectsToMove) {
        try {
          setDeploymentResults(prev => [
            ...prev.filter(r => r.objectName !== objName),
            { objectName: objName, success: 0, failed: 0, total: 0, errors: [] }
          ]);

          const file = files.find(f => f.objectName === objName);
          if (!file) continue;

          const obj = orgData.objects.find(o => o.name === objName);
          if (!obj) continue;

          const records = file.data;
          if (records.length === 0) {
            setDeploymentResults(prev => prev.map(r => 
              r.objectName === objName ? { ...r, total: 0, success: 0, failed: 0 } : r
            ));
            continue;
          }

          setDeploymentResults(prev => prev.map(r => 
            r.objectName === objName ? { ...r, total: records.length } : r
          ));

          // Describe target object to get createable fields and required fields
          let targetFields: any[];
          let targetCreateableFields: Set<string>;
          let targetRequiredFields: Set<string>;
          try {
            const targetObjDescribe = await targetService.describeSObject(objName);
            console.log(`🔍 Describe response for ${objName}:`, targetObjDescribe);
            targetFields = targetObjDescribe.fields || [];
            const createableFields = targetFields.filter((f: any) => f.createable);
            console.log(`🔍 Createable fields for ${objName}:`, createableFields.map((f: any) => f.name));
            targetCreateableFields = new Set(createableFields.map((f: any) => f.name.toLowerCase()));
            targetRequiredFields = new Set(targetFields.filter((f: any) => f.nillable === false && f.type !== 'boolean' && f.defaultedOnCreate === false && f.createable).map((f: any) => f.name.toLowerCase()));
          } catch (e: any) {
            throw new Error(`Object ${objName} does not exist or is not accessible in the target org. Error: ${e.message}`);
          }

          // Prepare data for Bulk API
          const processedRecords = records.map(record => {
            const newRec: any = {};
            const sourceId = record.Id || record.id || record.ID;
            
            // Map fields based on fieldMappings
            const mappings = fieldMappings[objName] || {};
            const defaults = fieldDefaultValues[objName] || {};
            
            Object.entries(mappings).forEach(([sourceField, targetField]) => {
              let val = record[sourceField];
              
              // Use default value if source value is null/undefined/empty
              if ((val === undefined || val === null || val === '') && defaults[sourceField]) {
                val = defaults[sourceField];
              }
              
              if (val !== undefined && val !== null) {
                const lowerTargetField = targetField.toLowerCase();
                if (targetCreateableFields.has(lowerTargetField)) {
                  newRec[targetField] = val;
                } else {
                  console.warn(`⚠️ Field ${targetField} is not createable in target org for ${objName}. Skipping.`);
                }
              }
            });

            // Map lookups if parent was already deployed
            obj.fields.filter(f => f.type === 'reference').forEach(f => {
              const sourceVal = record[f.name];
              if (sourceVal && idMap[sourceVal]) {
                const targetField = mappings[f.name] || f.name;
                newRec[targetField] = idMap[sourceVal];
              }
            });

            // Add constant values for target fields
            const constants = constantValues[objName] || {};
            Object.entries(constants).forEach(([targetField, val]) => {
              if (val !== undefined && val !== null && val !== '') {
                newRec[targetField] = val;
              }
            });

            // Check for missing required fields
            targetRequiredFields.forEach(reqField => {
              const found = Object.keys(newRec).some(k => k.toLowerCase() === reqField);
              if (!found) {
                // Try to see if we have a default value for this required field even if not mapped
                // This handles cases where a field is required in target but doesn't exist in source
                const mappingEntry = Object.entries(mappings).find(([_, tf]) => tf.toLowerCase() === reqField);
                const sourceFieldName = mappingEntry ? mappingEntry[0] : null;
                
                if (sourceFieldName && defaults[sourceFieldName]) {
                   const targetFieldName = mappings[sourceFieldName];
                   newRec[targetFieldName] = defaults[sourceFieldName];
                } else {
                  console.warn(`⚠️ Required field ${reqField} is missing for ${objName} record ${sourceId}. This may cause a failure.`);
                }
              }
            });
            
            // We need to keep the source ID for mapping later, but it shouldn't be in the final payload for creation
            return { _sourceId: sourceId, ...newRec };
          });

          // 1. Create Job
          const job = await targetService.createBulkJob(objName);
          const jobId = job.id;

          // 2. Upload Data (CSV)
          // We need to remove internal _sourceId from CSV headers before uploading
          const uploadData = processedRecords.map(({ _sourceId, ...rest }) => rest);

          if (uploadData.length === 0 || Object.keys(uploadData[0]).length === 0) {
            throw new Error(`No createable fields found for object ${objName}. Check field-level security or object permissions.`);
          }

          const csvData = dataLoaderService.current.jsonToCsv(uploadData);
          await targetService.uploadBulkData(jobId, csvData);

          // 3. Close Job
          await targetService.closeBulkJob(jobId);

          // 4. Poll for status
          let jobStatus = await targetService.getBulkJobStatus(jobId);
          while (jobStatus.state !== 'JobComplete' && jobStatus.state !== 'Failed' && jobStatus.state !== 'Aborted') {
            await new Promise(resolve => setTimeout(resolve, 3000));
            jobStatus = await targetService.getBulkJobStatus(jobId);
          }

          if (jobStatus.state === 'JobComplete') {
            const successResults = await targetService.getBulkJobSuccessfulResults(jobId);
            const failedResults = await targetService.getBulkJobFailedResults(jobId);

            // Parse results
            const successRows = successResults.split('\n').filter(line => line.trim() !== '');
            const failedRows = failedResults.split('\n').filter(line => line.trim() !== '');

            const successCount = Math.max(0, successRows.length - 1); // Header row
            const failedCount = Math.max(0, failedRows.length - 1);

            // Map new IDs back to source IDs
            if (successCount > 0) {
              const headers = successRows[0].split(',').map(h => h.replace(/"/g, ''));
              const idIdx = headers.indexOf('sf__Id');
              
              for (let j = 1; j < successRows.length; j++) {
                const columns = successRows[j].split(',').map(c => c.replace(/"/g, ''));
                const newId = columns[idIdx];
                
                // Assuming order is preserved for successful records (best effort without External ID)
                if (j - 1 < processedRecords.length) {
                  const sourceId = processedRecords[j - 1]._sourceId;
                  if (sourceId && newId) {
                    idMap[sourceId] = newId;
                  }
                }
              }
            }

            if (failedCount > 0) {
              console.error(`❌ ${failedCount} records failed for ${objName}. Sample errors:`, failedRows.slice(1, 6));
            }

            setDeploymentResults(prev => prev.map(r => 
              r.objectName === objName ? { 
                ...r, 
                success: successCount, 
                failed: failedCount,
                errors: failedCount > 0 ? [`${failedCount} records failed. Check browser console or Salesforce Bulk Jobs for details.`] : []
              } : r
            ));
          } else {
            const errorMessage = `Bulk Job ${jobId} failed with state: ${jobStatus.state}. ${jobStatus.errorMessage || ''}`;
            console.error(`❌ ${errorMessage}`);
            throw new Error(errorMessage);
          }
        } catch (e: any) {
          // Mark this object as failed
          setDeploymentResults(prev => prev.map(r => 
            r.objectName === objName ? { 
              ...r, 
              failed: r.total || 1, // Ensure failed is > 0 so it shows as error
              errors: [e.message || 'Unknown error']
            } : r
          ));
          throw e; // Rethrow to stop the outer loop and show notification
        }
      }
      
      addNotification('Deployment Complete', 'Data migration finished successfully.', 'success');
    } catch (e: any) {
      console.error("Migration failed", e);
      addNotification('Migration Failed', e.message || 'An error occurred during migration.', 'error');
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2">Data Migration Studio</h1>
          <p className="text-slate-500 font-medium text-lg">
            {currentStep === 'home' ? 'Select your migration path to begin.' : 
             mode === 'load' ? 'Hierarchical data deployment with relationship mapping.' :
             'Cross-org migration with parent-child integrity.'}
          </p>
        </div>
        {currentStep !== 'home' && (
          <div className="flex items-center space-x-4 bg-white p-3 rounded-3xl border border-slate-100 shadow-sm">
            {(() => {
              const steps = mode === 'move' 
                ? ['targetConnect', 'prepare', 'fieldMapping', 'visualize', 'deploy']
                : ['prepare', 'upload', 'fieldMapping', 'visualize', 'deploy'];
              
              return steps.map((step, idx) => {
                const isActive = currentStep === step;
                const stepIndex = steps.indexOf(step);
                const currentIndex = steps.indexOf(currentStep as any);
                const isPast = currentIndex > stepIndex;
                
                return (
                  <div key={step} className="flex items-center">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                      isActive ? 'bg-[#FFE600] text-[#2E2E38] shadow-xl shadow-[#FFE600]/30 scale-110' : 
                      isPast ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {isPast ? <i className="fas fa-check"></i> : idx + 1}
                    </div>
                    {idx < steps.length - 1 && (
                      <div className={`w-6 h-1 mx-2 rounded-full transition-colors duration-500 ${
                        isPast ? 'bg-emerald-200' : 'bg-slate-100'
                      }`}></div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>

      {currentStep === 'home' && (
        <div className="relative pt-12">
          {/* Background Decoration */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-6xl h-[500px] bg-gradient-to-b from-[#FFE600]/50 to-transparent -z-10 rounded-[100px] blur-3xl"></div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 max-w-6xl mx-auto px-4">
            <button 
              onClick={() => {
                setMode('load');
                setCurrentStep('prepare');
              }}
              className="group bg-white p-12 rounded-[48px] border border-slate-200 shadow-xl hover:shadow-2xl hover:border-[#FFE600]/30 transition-all text-left relative overflow-hidden flex flex-col h-full"
            >
              <div className="absolute top-0 right-0 w-40 h-40 bg-[#FFE600]/10 rounded-bl-[120px] -mr-16 -mt-16 group-hover:bg-[#FFE600] transition-colors duration-500"></div>
              <div className="relative z-10 flex-1">
                <div className="w-20 h-20 bg-blue-100 text-[#2E2E38] rounded-3xl flex items-center justify-center mb-10 group-hover:bg-white transition-colors shadow-inner">
                  <i className="fas fa-file-upload text-3xl"></i>
                </div>
                <h2 className="text-3xl font-black text-slate-900 mb-6">Load Data to Org</h2>
                <p className="text-slate-500 leading-relaxed text-lg mb-10">
                  Import CSV or Excel files directly into Salesforce. Our engine automatically maps relationships and handles multi-level hierarchies with ease.
                </p>
              </div>
              <div className="relative z-10 flex items-center justify-between pt-6 border-t border-slate-50">
                <div className="flex items-center text-[#2E2E38] font-black uppercase tracking-[0.2em] text-xs">
                  <span>Start Loading</span>
                  <i className="fas fa-arrow-right ml-3 group-hover:translate-x-3 transition-transform"></i>
                </div>
                <div className="flex -space-x-2">
                  {[1,2,3].map(i => (
                    <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center">
                      <div className="w-4 h-1 bg-slate-300 rounded-full"></div>
                    </div>
                  ))}
                </div>
              </div>
            </button>

            <button 
              onClick={() => {
                setMode('move');
                setCurrentStep('targetConnect');
              }}
              className="group bg-[#2E2E38] p-12 rounded-[48px] border border-slate-800 shadow-2xl hover:shadow-[0_20px_50px_rgba(59,130,246,0.3)] hover:border-[#FFE600]/30 transition-all text-left relative overflow-hidden flex flex-col h-full"
            >
              <div className="absolute top-0 right-0 w-40 h-40 bg-slate-800 rounded-bl-[120px] -mr-16 -mt-16 group-hover:bg-[#FFE600] transition-colors duration-500"></div>
              <div className="relative z-10 flex-1">
                <div className="w-20 h-20 bg-slate-800 text-[#FFE600] rounded-3xl flex items-center justify-center mb-10 group-hover:bg-white group-hover:text-[#2E2E38] transition-colors shadow-inner">
                  <i className="fas fa-exchange-alt text-3xl"></i>
                </div>
                <h2 className="text-3xl font-black text-white mb-6">Move Data Between Orgs</h2>
                <p className="text-slate-400 leading-relaxed text-lg mb-10">
                  Seamlessly migrate records between Salesforce environments. Select your source objects and target org, and we'll handle the heavy lifting.
                </p>
              </div>
              <div className="relative z-10 flex items-center justify-between pt-6 border-t border-slate-800">
                <div className="flex items-center text-[#FFE600] font-black uppercase tracking-[0.2em] text-xs">
                  <span>Start Migration</span>
                  <i className="fas fa-arrow-right ml-3 group-hover:translate-x-3 transition-transform"></i>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#FFE600]/100 animate-pulse"></div>
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Live Sync Ready</span>
                </div>
              </div>
            </button>
          </div>
          
          {/* Bottom Stats/Flavor removed */}
        </div>
      )}

      {currentStep === 'prepare' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            {/* Parent Object Selection */}
            <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">1. Select Parent Object</h2>
                  <p className="text-sm text-slate-500 mt-1">Choose the primary object (e.g. Account)</p>
                </div>
                {parentObject && (
                  <span className="px-4 py-1.5 bg-[#FFE600]/10 text-[#2E2E38] text-[10px] font-bold rounded-full uppercase tracking-wider border border-[#FFE600]/30">
                    Selected: {parentObject}
                  </span>
                )}
              </div>
              
              <div className="relative mb-6">
                <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                <input 
                  type="text" 
                  placeholder="Search parent object..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={objectSearch}
                  onChange={(e) => setObjectSearch(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                {orgData.objects
                  .filter(o => o.name?.toLowerCase().includes(objectSearch?.toLowerCase()) || o.label?.toLowerCase().includes(objectSearch?.toLowerCase()))
                  .map(obj => (
                    <button
                      key={obj.name}
                      onClick={() => {
                        setParentObject(obj.name);
                        if (!obj.fields || obj.fields.length === 0) {
                          fetchObjectFields(obj.name);
                        }
                      }}
                      className={`p-4 rounded-2xl border text-left transition-all ${
                        parentObject === obj.name
                          ? 'bg-[#FFE600] border-[#FFE600] text-white shadow-lg shadow-[#FFE600]/30'
                          : 'bg-white border-slate-100 hover:border-[#FFE600]/30 text-slate-600'
                      }`}
                    >
                      <p className="text-xs font-bold truncate uppercase tracking-tight">{obj.label}</p>
                      <p className={`text-[10px] truncate ${parentObject === obj.name ? 'text-blue-100' : 'text-slate-400'}`}>{obj.name}</p>
                    </button>
                  ))}
              </div>
            </div>

            {/* Child Objects Selection */}
            <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">2. Select Child Objects</h2>
                  <p className="text-sm text-slate-500 mt-1">Choose related objects (e.g. Contact, Opportunity)</p>
                  {recordLimit && (
                    <div className="mt-3 flex items-center gap-2 text-amber-600 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-100 text-[10px] font-bold uppercase tracking-wider w-fit">
                      <i className="fas fa-filter"></i>
                      Filtered by parent limit ({recordLimit})
                    </div>
                  )}
                </div>
                <span className="px-4 py-1.5 bg-slate-50 text-slate-600 text-[10px] font-bold rounded-full uppercase tracking-wider border border-slate-100">
                  {childObjects.length} Selected
                </span>
              </div>

              <div className="relative mb-6">
                <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                <input 
                  type="text" 
                  placeholder="Search child objects..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={childObjectSearch}
                  onChange={(e) => setChildObjectSearch(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {orgData.objects
                  .filter(o => o.name?.toLowerCase().includes(childObjectSearch?.toLowerCase()) || o.label?.toLowerCase().includes(childObjectSearch?.toLowerCase()))
                  .map(obj => {
                    const objName = obj.name;
                    const isSelected = childObjects.includes(objName);
                    const isParent = parentObject === objName;
                    
                    return (
                      <button
                        key={objName}
                        disabled={isParent}
                        onClick={() => {
                          if (isSelected) {
                            setChildObjects(childObjects.filter(n => n !== objName));
                          } else {
                            setChildObjects([...childObjects, objName]);
                            fetchObjectFields(objName);
                          }
                        }}
                        className={`p-4 rounded-2xl border text-left transition-all ${
                          isSelected
                            ? 'bg-[#FFE600] border-[#FFE600] text-white shadow-lg shadow-[#FFE600]/30'
                            : isParent
                            ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed opacity-50'
                            : 'bg-white border-slate-100 hover:border-[#FFE600]/30 text-slate-600'
                        }`}
                      >
                        <p className="text-xs font-bold truncate uppercase tracking-tight">{obj.label}</p>
                        <p className={`text-[10px] truncate ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>
                          {objName} {isParent && '(Parent)'}
                        </p>
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-[#2E2E38] rounded-[32px] p-8 text-white">
              <h3 className="text-lg font-semibold mb-6">Hierarchy Summary</h3>
              
              <div className="space-y-6 mb-8">
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Parent Object</p>
                  {parentObject ? (
                    <div className="flex items-center justify-between p-3 bg-[#FFE600]/20 rounded-xl border border-[#FFE600]/30/30">
                      <span className="text-sm font-medium">{parentObject}</span>
                      <button onClick={() => setParentObject(null)} className="text-white/40 hover:text-white">
                        <i className="fas fa-times"></i>
                      </button>
                    </div>
                  ) : (
                    <p className="text-slate-500 text-xs italic">Select a parent object...</p>
                  )}
                </div>

                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Record Limit (Parent)</p>
                  <div className="relative">
                    <i className="fas fa-list-ol absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"></i>
                    <input 
                      type="number"
                      placeholder="No limit (all records)"
                      value={recordLimit}
                      onChange={(e) => setRecordLimit(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                    />
                  </div>
                  <p className="text-[9px] text-slate-500 mt-2 italic">
                    {recordLimit ? `Only the first ${recordLimit} records will be fetched.` : 'All records will be fetched.'}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Child Objects ({childObjects.length})</p>
                  <div className="space-y-2">
                    {childObjects.map(name => (
                      <div key={name} className="flex items-center justify-between p-3 bg-white/10 rounded-xl border border-white/10">
                        <span className="text-sm font-medium">{name}</span>
                        <button onClick={() => setChildObjects(childObjects.filter(n => n !== name))} className="text-white/40 hover:text-white">
                          <i className="fas fa-times"></i>
                        </button>
                      </div>
                    ))}
                    {childObjects.length === 0 && <p className="text-slate-500 text-xs italic">Select child objects...</p>}
                  </div>
                </div>
              </div>

              <div className="flex flex-col space-y-3">
                <div className="flex space-x-3">
                    <button 
                      onClick={() => setCurrentStep(mode === 'move' ? 'targetConnect' : 'home')}
                      className="px-6 py-4 text-slate-400 font-bold hover:text-white transition-all uppercase tracking-widest text-[10px] border border-white/10 rounded-2xl"
                    >
                      <i className="fas fa-arrow-left mr-2"></i>
                      Back
                    </button>
                    <button 
                      disabled={!parentObject || isFetchingSource}
                      onClick={async () => {
                        if (mode === 'move') {
                          setIsFetchingSource(true);
                          setFetchProgress(null);
                          try {
                            const simulatedFiles: DataLoaderFile[] = [];
                            
                            // 1. Fetch Parent Data
                            setFetchProgress({ objectName: parentObject!, count: 0, total: 0 });
                            const parentFields = await fetchObjectFields(parentObject!);
                            // Filter out non-queryable fields
                            let queryFields = parentFields.filter(f => f.queryable).map(f => f.name).join(', ');
                            if (!queryFields) {
                              console.warn(`No queryable fields found for ${parentObject}, defaulting to Id`);
                              queryFields = 'Id';
                            }
                            const parentSoql = `SELECT ${queryFields} FROM ${parentObject}${recordLimit ? ` LIMIT ${recordLimit}` : ''}`;
                            
                            const parentRecords = await sfService.queryAll(parentSoql, false, (count, total) => {
                              setFetchProgress({ objectName: parentObject!, count, total: recordLimit ? Math.min(total, parseInt(recordLimit)) : total });
                            });

                            if (parentRecords.length === 0) {
                              addNotification('No Records Found', `No ${parentObject} records found to migrate.`, 'warning');
                              setIsFetchingSource(false);
                              setFetchProgress(null);
                              return;
                            }

                            const parentIdSet = new Set(parentRecords.map(r => r.Id || r.id || r.ID));
                            const parentIdList = Array.from(parentIdSet).map(id => `'${id}'`).join(',');

                            simulatedFiles.push({
                              name: `${parentObject}_Source_Data.csv`,
                              objectName: parentObject!,
                              fields: parentFields.map(f => f.name),
                              externalIdField: 'Id', // Use Salesforce ID as the key for migration
                              data: parentRecords.map(r => {
                                const { attributes, ...rest } = r;
                                return rest;
                              }),
                              fieldMapping: parentFields
                                .filter(f => f.createable)
                                .reduce((acc, f) => ({ ...acc, [f.name]: f.name }), {})
                            });

                            // 2. Fetch Children Data
                            for (const childName of childObjects) {
                              setFetchProgress({ objectName: childName, count: 0, total: 0 });
                              const childFields = await fetchObjectFields(childName);
                              
                              // Find the lookup field to the parent
                              const lookupField = childFields.find(f => f.referenceTo?.includes(parentObject!));
                              if (!lookupField) continue;

                              // Filter out non-queryable fields
                              let childQueryFields = childFields.filter(f => f.queryable).map(f => f.name).join(', ');
                              if (!childQueryFields) {
                                console.warn(`No queryable fields found for ${childName}, defaulting to Id`);
                                childQueryFields = 'Id';
                              }
                              
                              // If recordLimit is set, we MUST filter by the specific parent IDs fetched
                              // Otherwise, we can use a semi-join for efficiency
                              const childSoql = recordLimit 
                                ? (parentIdList ? `SELECT ${childQueryFields} FROM ${childName} WHERE ${lookupField.name} IN (${parentIdList})` : null)
                                : `SELECT ${childQueryFields} FROM ${childName} WHERE ${lookupField.name} IN (SELECT Id FROM ${parentObject})`;
                              
                              if (!childSoql) {
                                console.warn(`Skipping ${childName} as no parent IDs were found.`);
                                continue;
                              }

                              const childRecords = await sfService.queryAll(childSoql, false, (count, total) => {
                                setFetchProgress({ objectName: childName, count, total });
                              });

                              simulatedFiles.push({
                                name: `${childName}_Source_Data.csv`,
                                objectName: childName,
                                fields: childFields.map(f => f.name),
                                data: childRecords.map(r => {
                                  const { attributes, ...rest } = r;
                                  return rest;
                                }),
                                fieldMapping: childFields
                                  .filter(f => f.createable)
                                  .reduce((acc, f) => ({ ...acc, [f.name]: f.name }), {}),
                                parentRelationships: [{
                                  parentObject: parentObject!,
                                  childLookupField: lookupField.name,
                                  parentKeyField: 'Id',
                                  sfLookupField: lookupField.name
                                }]
                              });
                            }

                            setFiles(simulatedFiles);
                            
                            // Initialize field mappings state for move mode
                            const initialMappings: Record<string, Record<string, string>> = {};
                            simulatedFiles.forEach(f => {
                              initialMappings[f.objectName] = { ...(f.fieldMapping || {}) };
                            });
                            setFieldMappings(initialMappings);

                            // Fetch target fields for comparison
                            setIsFetchingSource(true);
                            setFetchProgress({ objectName: 'Target Metadata', count: 0, total: simulatedFiles.length });
                            for (let i = 0; i < simulatedFiles.length; i++) {
                              const f = simulatedFiles[i];
                              setFetchProgress({ objectName: `Target ${f.objectName}`, count: i + 1, total: simulatedFiles.length });
                              await fetchTargetFields(f.objectName);
                            }

                            setCurrentStep('fieldMapping');
                            addNotification('Data Extracted', `Successfully retrieved ${simulatedFiles.reduce((acc, f) => acc + f.data.length, 0)} records from source org.`, 'success');
                          } catch (e: any) {
                            console.error('Failed to fetch source data', e);
                            addNotification('Error', `Failed to retrieve data: ${e.message}`, 'error');
                          } finally {
                            setIsFetchingSource(false);
                            setFetchProgress(null);
                          }
                        } else {
                          setCurrentStep('fieldMapping');
                        }
                      }}
                      className="flex-1 py-4 bg-[#FFE600] text-[#2E2E38] font-bold rounded-2xl hover:bg-[#E5CF00] transition-all shadow-xl shadow-[#FFE600]/30 uppercase tracking-widest text-[10px] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isFetchingSource ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Extracting {fetchProgress?.objectName || 'Data'}...</span>
                        </>
                      ) : (
                        <span>Next Step</span>
                      )}
                    </button>
                </div>
                
                {parentObject && (
                  <button 
                    onClick={async () => {
                      const allSelected = [parentObject!, ...childObjects];
                      for (const objName of allSelected) {
                        let obj = orgData.objects.find(o => o.name?.toLowerCase() === objName?.toLowerCase());
                        if (!obj) continue;
                        
                        // Fetch fields if missing
                        let currentFields = obj.fields || [];
                        if (currentFields.length === 0) {
                          addNotification('Fetching Metadata', `Retrieving fields for ${obj.name}...`, 'info');
                          currentFields = await fetchObjectFields(obj.name);
                        }

                        if (currentFields.length === 0) {
                          addNotification('Download Failed', `No fields found for ${obj.name}. Please check your connection.`, 'error');
                          continue;
                        }

                        const headers = objName === parentObject 
                          ? ['External_ID', ...currentFields.map(f => `${f.label} (${f.name})`)]
                          : currentFields.map(f => `${f.label} (${f.name})`);
                        
                        const csvContent = headers.join(',') + '\n';
                        
                        const blob = new Blob([csvContent], { type: 'text/csv' });
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.setAttribute('hidden', '');
                        a.setAttribute('href', url);
                        a.setAttribute('download', `${obj.name}_Template.csv`);
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        addNotification('Template Downloaded', `${obj.name} template is ready.`, 'success');
                      }
                    }}
                    className="w-full py-3 text-slate-400 hover:text-[#2E2E38] transition-all flex items-center justify-center space-x-2 text-[10px] font-bold uppercase tracking-widest"
                  >
                    <i className="fas fa-download"></i>
                    <span>Download Templates</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {currentStep === 'targetConnect' && (
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-[40px] p-12 border border-slate-200 shadow-xl">
            <div className="flex items-center justify-between mb-10">
              <div className="flex items-center gap-6">
                <button 
                  onClick={() => setCurrentStep('home')}
                  className="w-12 h-12 bg-slate-50 text-slate-400 rounded-2xl flex items-center justify-center hover:bg-slate-100 hover:text-slate-600 transition-all"
                  title="Back to Home"
                >
                  <i className="fas fa-arrow-left"></i>
                </button>
                <div className="w-16 h-16 bg-blue-100 text-[#2E2E38] rounded-3xl flex items-center justify-center">
                  <i className="fas fa-plug text-2xl"></i>
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-slate-900">Connect Target Organization</h2>
                  <p className="text-slate-500 mt-1">Select an existing credential or add a new target box.</p>
                </div>
              </div>
              <button 
                onClick={() => setShowNewCredForm(!showNewCredForm)}
                className="px-6 py-3 bg-[#FFE600]/10 text-[#2E2E38] rounded-2xl font-bold hover:bg-blue-100 transition-all flex items-center gap-2 uppercase tracking-widest text-[10px]"
              >
                {showNewCredForm ? 'Cancel' : (
                  <>
                    <i className="fas fa-plus"></i> Add New Credential
                  </>
                )}
              </button>
            </div>

            {showNewCredForm ? (
              <div className="space-y-8 animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Credential Name</label>
                      <div className="group relative inline-block">
                        <i className="fas fa-info-circle text-slate-300 cursor-help"></i>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 pb-2 hidden group-hover:block z-50 w-48">
                          <div className="p-3 bg-[#2E2E38] text-white text-[10px] rounded-xl shadow-2xl">
                            A friendly name for this connection (e.g., "Production", "UAT Sandbox").
                          </div>
                        </div>
                      </div>
                    </div>
                    <input 
                      type="text" 
                      placeholder="e.g. Production Org, Sandbox 1"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={newCredName}
                      onChange={(e) => setNewCredName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Instance URL</label>
                      <div className="group relative inline-block">
                        <i className="fas fa-info-circle text-slate-300 cursor-help"></i>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 pb-2 hidden group-hover:block z-50 w-64">
                          <div className="p-3 bg-[#2E2E38] text-white text-[10px] rounded-xl shadow-2xl">
                            The base URL of your Salesforce instance. Usually ends in ".my.salesforce.com".
                          </div>
                        </div>
                      </div>
                    </div>
                    <input 
                      type="text" 
                      placeholder="https://your-instance.my.salesforce.com"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={newCredUrl}
                      onChange={(e) => setNewCredUrl(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Client ID</label>
                    <input 
                      type="text" 
                      placeholder="Enter Salesforce Connected App Client ID"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={newCredClientId}
                      onChange={(e) => setNewCredClientId(e.target.value)}
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Client Secret</label>
                    <input 
                      type="password" 
                      placeholder="Enter Salesforce Connected App Client Secret"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={newCredClientSecret}
                      onChange={(e) => setNewCredClientSecret(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Username</label>
                    <input 
                      type="text" 
                      placeholder="Enter Salesforce Username"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={newCredUsername}
                      onChange={(e) => setNewCredUsername(e.target.value)}
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Password</label>
                    <input 
                      type="password" 
                      placeholder="Enter Salesforce Password"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={newCredPassword}
                      onChange={(e) => setNewCredPassword(e.target.value)}
                    />
                  </div>
                </div>
                <div className="bg-[#FFE600]/10 p-6 rounded-2xl border border-[#FFE600]/30">
                  <h4 className="text-blue-800 font-bold text-xs uppercase tracking-widest mb-3 flex items-center gap-2">
                    <i className="fas fa-shield-alt"></i>
                    OAuth 2.0 Client Credentials Flow
                  </h4>
                  <p className="text-blue-700 text-xs leading-relaxed">
                    This application uses the Client Credentials flow for secure, persistent org-to-org communication. 
                    Ensure your Connected App in the target org has the <strong>Client Credentials Flow</strong> enabled 
                    and a <strong>Run As</strong> user assigned.
                  </p>
                </div>
                <button 
                  onClick={async () => {
                    await saveNewCredential();
                  }}
                  disabled={isTestingConnection}
                  className={`w-full py-5 bg-[#FFE600] text-[#2E2E38] rounded-2xl font-bold hover:bg-[#E5CF00] transition-all shadow-xl shadow-[#FFE600]/30 uppercase tracking-widest text-xs flex items-center justify-center gap-3 ${isTestingConnection ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  {isTestingConnection ? (
                    <>
                      <i className="fas fa-circle-notch fa-spin"></i>
                      Establishing Connection...
                    </>
                  ) : (
                    'Save and Connect'
                  )}
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {targetCredentials.length === 0 ? (
                  <div className="text-center py-16 bg-slate-50 rounded-[32px] border-2 border-dashed border-slate-200">
                    <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
                      <i className="fas fa-database text-2xl text-slate-300"></i>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">No existing credentials</h3>
                    <p className="text-slate-500 mt-2 mb-8">You haven't saved any target orgs yet. Let's create one!</p>
                    <button 
                      onClick={() => setShowNewCredForm(true)}
                      className="px-8 py-4 bg-[#FFE600] text-[#2E2E38] rounded-2xl font-bold hover:bg-[#E5CF00] transition-all shadow-lg shadow-[#FFE600]/30 uppercase tracking-widest text-xs"
                    >
                      Create Your First Credential
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {targetCredentials
                      .filter(cred => !cred.instanceUrl.includes(orgData.instance))
                      .map((cred) => (
                      <div 
                        key={cred.id}
                        onClick={() => {
                          setTargetOrgConfig(cred);
                          initializeTargetService(cred);
                          setIsTargetConnected(true);
                        }}
                        className={`p-6 rounded-[28px] border-2 transition-all cursor-pointer group ${
                          targetOrgConfig?.id === cred.id 
                            ? 'border-[#FFE600] bg-[#FFE600]/10/50' 
                            : 'border-slate-100 hover:border-[#FFE600]/30 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-6">
                            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${
                              targetOrgConfig?.id === cred.id ? 'bg-[#FFE600] text-[#2E2E38]' : 'bg-slate-100 text-slate-500 group-hover:bg-blue-100 group-hover:text-[#2E2E38]'
                            }`}>
                              <i className="fas fa-server text-xl"></i>
                            </div>
                            <div>
                              <h3 className="font-bold text-slate-900 text-lg">{cred.name}</h3>
                              <p className="text-sm text-slate-500 font-medium">{cred.instanceUrl}</p>
                            </div>
                          </div>
                          {targetOrgConfig?.id === cred.id && (
                            <div className="w-8 h-8 bg-[#FFE600] rounded-full flex items-center justify-center shadow-lg shadow-[#FFE600]/30">
                              <i className="fas fa-check text-white text-xs"></i>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {isTargetConnected && (
                  <div className="mt-10 pt-10 border-t border-slate-100 flex items-center justify-between gap-4">
                    <button 
                      onClick={() => setCurrentStep('home')}
                      className="px-8 py-5 text-slate-500 font-bold hover:text-slate-900 transition-colors uppercase tracking-widest text-xs"
                    >
                      Back
                    </button>
                    <button 
                      onClick={() => setCurrentStep('prepare')}
                      className="flex-1 py-5 bg-[#2E2E38] text-white rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/20 uppercase tracking-widest text-xs flex items-center justify-center gap-3"
                    >
                      <i className="fas fa-arrow-right"></i>
                      <span>Next Step</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {currentStep === 'upload' && (
        <div className="bg-white rounded-[32px] p-12 border border-slate-200 shadow-sm">
          <div className="max-w-4xl mx-auto space-y-12">
            <div className="text-center space-y-4">
              <div className="w-20 h-20 bg-[#FFE600]/10 text-[#2E2E38] rounded-3xl flex items-center justify-center mx-auto mb-6">
                <i className="fas fa-cloud-upload-alt text-3xl"></i>
              </div>
              <h2 className="text-2xl font-bold text-slate-900">Upload your Data Files</h2>
              <p className="text-slate-500">Please upload exactly one file for the parent and one for each child object.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Parent File Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center">
                  <span className="w-6 h-6 rounded-full bg-[#FFE600] text-[#2E2E38] flex items-center justify-center text-[10px] mr-2">1</span>
                  Parent Object: {parentObject}
                </h3>
                <div className="relative group">
                  <input 
                    type="file" 
                    accept=".csv,.xlsx,.xls"
                    disabled={isParsing}
                    onChange={async (e) => {
                      if (!e.target.files?.[0]) return;
                      const file = e.target.files[0];
                      setIsParsing(true);
                      try {
                        const { data, fields } = await dataLoaderService.current.parseFile(file);
                        
                        if (!data || data.length === 0) {
                          addNotification('Empty File', 'Both the excelling uploaded is empty. Please populate some values and proceed for data creation.', 'error');
                          return;
                        }

                        const matchedObject = orgData.objects.find(o => o.name?.toLowerCase() === parentObject?.toLowerCase());
                        let sfFieldsList = matchedObject?.fields || [];
                        if (matchedObject && sfFieldsList.length === 0) {
                          sfFieldsList = await fetchObjectFields(matchedObject.name);
                        }

                        const fieldMapping: Record<string, string> = {};
                        if (sfFieldsList.length > 0) {
                          fields.forEach(header => {
                            const apiMatch = header?.match(/\(([^)]+)\)$/);
                            const apiName = apiMatch ? apiMatch[1] : header;
                            const sfField = sfFieldsList.find(f => 
                              f.name?.toLowerCase() === apiName?.toLowerCase() || 
                              f.name?.toLowerCase() === header?.toLowerCase() || 
                              f.label?.toLowerCase() === header?.toLowerCase()
                            );
                            if (sfField) fieldMapping[header] = sfField.name;
                          });
                        }

                        const newFile: DataLoaderFile = {
                          name: file.name,
                          data,
                          fields,
                          objectName: parentObject!,
                          externalIdField: fields.find(f => f?.toLowerCase() === 'external_id' || f?.toLowerCase() === 'id'),
                          fieldMapping
                        };
                        setFiles(prev => [newFile, ...prev.filter(f => f.objectName !== parentObject)]);
                        addNotification('File Uploaded', `${file.name} parsed successfully.`, 'success');
                      } catch (err: any) {
                        addNotification('Upload Failed', `Failed to parse ${file.name}: ${err.message}`, 'error');
                      } finally {
                        setIsParsing(false);
                      }
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
                  />
                  <div className={`p-8 border-2 border-dashed rounded-[32px] text-center transition-all ${
                    isParsing ? 'opacity-50' : ''
                  } ${
                    files.find(f => f.objectName === parentObject) 
                      ? 'bg-[#FFE600]/10 border-[#FFE600]/30' 
                      : 'bg-slate-50 border-slate-200 group-hover:border-[#FFE600]/30 group-hover:bg-[#FFE600]/10/30'
                  }`}>
                    {isParsing ? (
                      <div className="space-y-2">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#FFE600] mx-auto mb-2"></div>
                        <p className="text-sm font-semibold text-slate-600">Parsing file...</p>
                      </div>
                    ) : files.find(f => f.objectName === parentObject) ? (
                      <div className="space-y-2">
                        <i className="fas fa-check-circle text-[#2E2E38] text-2xl"></i>
                        <p className="text-sm font-bold text-slate-900">{files.find(f => f.objectName === parentObject)?.name}</p>
                        <p className="text-[10px] text-[#2E2E38] font-bold uppercase tracking-widest">File Ready</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <i className="fas fa-file-upload text-slate-300 text-2xl mb-2"></i>
                        <p className="text-sm font-semibold text-slate-600">Click or drag parent file</p>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">CSV or Excel</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Child Files Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center">
                    <span className="w-6 h-6 rounded-full bg-[#FFE600] text-[#2E2E38] flex items-center justify-center text-[10px] mr-2">2</span>
                    Child Objects ({childObjects.length})
                  </h3>
                  <div className="relative w-48">
                    <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]"></i>
                    <input 
                      type="text"
                      placeholder="Search children..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-full pl-8 pr-3 py-1.5 text-[10px] focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={uploadSearch}
                      onChange={(e) => setUploadSearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {childObjects
                    .filter(name => name?.toLowerCase().includes(uploadSearch?.toLowerCase()))
                    .map(objName => {
                    const uploadedFile = files.find(f => f.objectName === objName);
                    return (
                      <div key={objName} className="relative group">
                        <input 
                          type="file" 
                          accept=".csv,.xlsx,.xls"
                          disabled={isParsing}
                          onChange={async (e) => {
                            if (!e.target.files?.[0]) return;
                            const file = e.target.files[0];
                            setIsParsing(true);
                            try {
                              const { data, fields } = await dataLoaderService.current.parseFile(file);
                              
                              if (!data || data.length === 0) {
                                addNotification('Empty File', 'Both the excelling uploaded is empty. Please populate some values and proceed for data creation.', 'error');
                                return;
                              }

                              const matchedObject = orgData.objects.find(o => o.name?.toLowerCase() === objName?.toLowerCase());
                              let sfFieldsList = matchedObject?.fields || [];
                              if (matchedObject && sfFieldsList.length === 0) {
                                sfFieldsList = await fetchObjectFields(matchedObject.name);
                              }

                              const fieldMapping: Record<string, string> = {};
                              const parentRelationships: ParentRelationship[] = [];
                              
                              if (sfFieldsList.length > 0) {
                                fields.forEach(header => {
                                  const apiMatch = header?.match(/\(([^)]+)\)$/);
                                  const apiName = apiMatch ? apiMatch[1] : header;
                                  const sfField = sfFieldsList.find(f => 
                                    f.name?.toLowerCase() === apiName?.toLowerCase() || 
                                    f.name?.toLowerCase() === header?.toLowerCase() || 
                                    f.label?.toLowerCase() === header?.toLowerCase()
                                  );
                                  if (sfField) {
                                    fieldMapping[header] = sfField.name;
                                    
                                    // Find which object this lookup points to
                                    const targetObject = sfField.referenceTo?.[0];
                                    const targetFile = files.find(f => f.objectName === targetObject) || (targetObject === parentObject ? { objectName: parentObject } : null);
                                    
                                    if (targetFile) {
                                      parentRelationships.push({
                                        parentObject: targetFile.objectName,
                                        parentKeyField: 'External_ID',
                                        childLookupField: header,
                                        sfLookupField: sfField.name
                                      });
                                    }
                                  }
                                });
                              }

                              const newFile: DataLoaderFile = {
                                name: file.name,
                                data,
                                fields,
                                objectName: objName,
                                externalIdField: undefined, // Children don't need their own external ID unless they are parents
                                parentRelationships,
                                fieldMapping
                              };
                              setFiles(prev => [...prev.filter(f => f.objectName !== objName), newFile]);
                              addNotification('File Uploaded', `${file.name} parsed successfully.`, 'success');
                            } catch (err: any) {
                              addNotification('Upload Failed', `Failed to parse ${file.name}: ${err.message}`, 'error');
                            } finally {
                              setIsParsing(false);
                            }
                          }}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
                        />
                        <div className={`p-4 border-2 border-dashed rounded-2xl flex items-center justify-between transition-all ${
                          isParsing ? 'opacity-50' : ''
                        } ${
                          uploadedFile 
                            ? 'bg-[#FFE600]/10 border-[#FFE600]/30' 
                            : 'bg-slate-50 border-slate-200 group-hover:border-[#FFE600]/30 group-hover:bg-[#FFE600]/10/30'
                        }`}>
                          <div className="flex items-center space-x-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${uploadedFile ? 'bg-[#FFE600] text-[#2E2E38]' : 'bg-slate-200 text-slate-400'}`}>
                              {isParsing ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                              ) : (
                                <i className={`fas ${uploadedFile ? 'fa-check text-[10px]' : 'fa-plus text-[10px]'}`}></i>
                              )}
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-900 uppercase tracking-tight">{objName}</p>
                              <p className="text-[10px] text-slate-500 truncate max-w-[150px]">
                                {uploadedFile ? uploadedFile.name : 'Upload child data file'}
                              </p>
                            </div>
                          </div>
                          {!uploadedFile && !isParsing && <i className="fas fa-chevron-right text-slate-300 text-xs mr-2"></i>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="pt-8 border-t border-slate-100 flex items-center justify-between">
              <button onClick={() => setCurrentStep(mode === 'load' ? 'prepare' : 'home')} className="text-slate-500 font-semibold hover:text-slate-900 transition-colors">Back to Selection</button>
              <button 
                disabled={files.length !== (childObjects.length + 1)}
                onClick={() => setCurrentStep('fieldMapping')}
                className="px-10 py-4 bg-[#2E2E38] text-white font-bold rounded-2xl hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/20 uppercase tracking-widest text-[10px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue to Mapping ({files.length}/{childObjects.length + 1})
              </button>
            </div>
          </div>
        </div>
      )}

      {currentStep === 'fieldMapping' && (
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">
                {mode === 'move' ? 'Review Fields to Transfer' : 'Map CSV Headers to Salesforce Fields'}
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                {mode === 'move' 
                  ? 'Verify the fields that will be extracted from source and inserted into target.' 
                  : 'Ensure your CSV columns are correctly mapped to Salesforce fields.'}
              </p>
            </div>
            <div className="flex items-center space-x-4">
              {mode === 'move' && (
                <>
                  <button 
                    onClick={() => {
                      const newMappings = { ...fieldMappings };
                      [parentObject!, ...childObjects].forEach(objName => {
                        const obj = orgData.objects.find(o => o.name === objName);
                        if (obj) {
                          newMappings[objName] = (obj.fields || [])
                            .filter(f => f.createable)
                            .reduce((acc, f) => ({ ...acc, [f.name]: f.name }), {});
                        }
                      });
                      setFieldMappings(newMappings);
                    }}
                    className="px-4 py-2 text-[10px] font-bold text-[#2E2E38] uppercase tracking-widest border border-[#FFE600]/30 rounded-xl hover:bg-[#FFE600]/10 transition-colors"
                  >
                    Select All Fields
                  </button>
                  <button 
                    onClick={() => {
                      const newMappings = { ...fieldMappings };
                      [parentObject!, ...childObjects].forEach(objName => {
                        newMappings[objName] = {};
                      });
                      setFieldMappings(newMappings);
                    }}
                    className="px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    Unselect All Fields
                  </button>
                </>
              )}
              <button 
                onClick={() => setCurrentStep(mode === 'move' ? 'prepare' : 'upload')} 
                className="px-6 py-3 text-slate-500 font-semibold hover:text-slate-900 transition-colors"
              >
                Back
              </button>
              <button 
                onClick={() => setCurrentStep('visualize')}
                disabled={files.some(file => {
                  const objName = file.objectName;
                  if (mode === 'move') {
                    // In move mode, each object must have at least one field mapped
                    if (!fieldMappings[objName] || Object.keys(fieldMappings[objName]).length === 0) return true;
                    
                    // AND all required target fields must be mapped
                    const targetFields = targetOrgFields[objName] || [];
                    const requiredTargetFields = targetFields.filter(f => f.required && f.createable);
                    const missingRequired = requiredTargetFields.some(tf => {
                      const isMapped = Object.values(fieldMappings[objName] || {}).includes(tf.name);
                      const hasConstant = !!constantValues[objName]?.[tf.name];
                      return !isMapped && !hasConstant;
                    });
                    return missingRequired;
                  } else {
                    // In load mode, check virtual ID and lookups
                    if (file.objectName === parentObject) {
                      return !file.externalIdField;
                    } else {
                      const areLookupsMapped = file.parentRelationships?.every(rel => rel.childLookupField) ?? true;
                      return !areLookupsMapped;
                    }
                  }
                })}
                className="px-10 py-3 bg-[#FFE600] text-[#2E2E38] font-bold rounded-2xl hover:bg-[#E5CF00] transition-all shadow-xl shadow-[#FFE600]/30 uppercase tracking-widest text-[10px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue to Visualization
              </button>
            </div>
          </div>

          {mode === 'move' ? (
            <div className="grid grid-cols-1 gap-6">
              {[parentObject!, ...childObjects].map(objName => {
                const obj = orgData.objects.find(o => o.name === objName);
                const targetFields = targetOrgFields[objName] || [];
                const requiredTargetFields = targetFields.filter(f => f.required && f.createable);
                const missingRequiredFields = requiredTargetFields.filter(tf => !Object.values(fieldMappings[objName] || {}).includes(tf.name));

                return (
                  <div key={objName} className="bg-white rounded-[32px] p-8 border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-[#FFE600]/10 text-[#2E2E38] rounded-2xl flex items-center justify-center">
                          <i className="fas fa-table"></i>
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-slate-900">{obj?.label || objName}</h3>
                          <p className="text-xs text-slate-500">{objName}</p>
                          <div className="flex items-center gap-2 mt-2">
                            {(!obj?.fields || obj.fields.length === 0) ? (
                              <button 
                                onClick={async () => {
                                  addNotification('Fetching', `Retrieving fields for ${objName}...`, 'info');
                                  await fetchObjectFields(objName);
                                }}
                                className="text-[10px] font-bold text-[#2E2E38] uppercase tracking-widest hover:underline flex items-center gap-1"
                              >
                                <i className="fas fa-sync-alt"></i> Load Fields
                              </button>
                            ) : (
                              <>
                                <button 
                                  onClick={() => {
                                    const newMappings = { ...fieldMappings };
                                    newMappings[objName] = (obj?.fields || [])
                                      .filter(f => f.createable && targetFields.some(tf => tf.name === f.name))
                                      .reduce((acc, f) => ({ ...acc, [f.name]: f.name }), {});
                                    setFieldMappings(newMappings);
                                  }}
                                  className="text-[10px] font-bold text-[#2E2E38] uppercase tracking-widest hover:underline"
                                >
                                  Select All (Target Compatible)
                                </button>
                                <span className="text-slate-300">|</span>
                                <button 
                                  onClick={() => {
                                    const newMappings = { ...fieldMappings };
                                    if (!newMappings[objName]) newMappings[objName] = {};
                                    (obj?.fields || [])
                                      .filter(f => {
                                        const tf = targetFields.find(tf => tf.name === f.name);
                                        return tf && tf.required && tf.createable;
                                      })
                                      .forEach(f => {
                                        newMappings[objName][f.name] = f.name;
                                      });
                                    setFieldMappings(newMappings);
                                  }}
                                  className="text-[10px] font-bold text-red-600 uppercase tracking-widest hover:underline"
                                >
                                  Select All Required
                                </button>
                                <span className="text-slate-300">|</span>
                                <button 
                                  onClick={() => {
                                    const newMappings = { ...fieldMappings };
                                    newMappings[objName] = {};
                                    setFieldMappings(newMappings);
                                  }}
                                  className="text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:underline"
                                >
                                  Unselect All
                                </button>
                                <span className="text-slate-300">|</span>
                                <button 
                                  onClick={async () => {
                                    addNotification('Refreshing', `Updating fields for ${objName}...`, 'info');
                                    // Force refresh by clearing fields first is not easy with current structure, 
                                    // so we just call fetchObjectFields which will fetch if empty, 
                                    // but here we want to force it.
                                    try {
                                      const describe = await sfService.describeSObject(objName);
                                      const fields = (describe.fields || []).map((f: any) => ({
                                        name: f.name,
                                        label: f.label,
                                        type: f.type,
                                        referenceTo: f.referenceTo,
                                        updateable: f.updateable,
                                        createable: f.createable,
                                        calculated: f.calculated,
                                        queryable: f.queryable,
                                        required: f.nillable === false && f.type !== 'boolean' && f.defaultedOnCreate === false
                                      }));
                                      onOrgDataUpdate(prev => {
                                        if (!prev) return prev;
                                        return {
                                          ...prev,
                                          objects: prev.objects.map(o => 
                                            o.name?.toLowerCase() === objName?.toLowerCase() ? { ...o, fields } : o
                                          )
                                        };
                                      });
                                      addNotification('Success', `Fields for ${objName} refreshed.`, 'success');
                                    } catch (e) {
                                      addNotification('Error', `Failed to refresh fields for ${objName}`, 'error');
                                    }
                                  }}
                                  className="text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:underline"
                                  title="Refresh Metadata"
                                >
                                  <i className="fas fa-sync-alt"></i>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {missingRequiredFields.length > 0 && (
                        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl border border-red-100">
                          <i className="fas fa-exclamation-triangle text-xs"></i>
                          <span className="text-[10px] font-bold uppercase tracking-widest">
                            {missingRequiredFields.length} Required Fields Missing in Target
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      {(!obj?.fields || obj.fields.length === 0) ? (
                        <div className="flex flex-col items-center justify-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                          <i className="fas fa-info-circle text-slate-300 text-2xl mb-3"></i>
                          <p className="text-sm text-slate-500 font-medium">No fields loaded for this object.</p>
                          <button 
                            onClick={() => fetchObjectFields(objName)}
                            className="mt-4 px-6 py-2 bg-[#FFE600] text-[#2E2E38] text-[10px] font-bold rounded-xl uppercase tracking-widest hover:bg-[#E5CF00] transition-all"
                          >
                            Fetch Fields Now
                          </button>
                        </div>
                      ) : obj.fields.filter(f => f.createable).length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                          <i className="fas fa-exclamation-circle text-amber-400 text-2xl mb-3"></i>
                          <p className="text-sm text-slate-500 font-medium">No createable fields found for this object.</p>
                        </div>
                      ) : obj.fields.filter(f => f.createable).map(field => {
                        const targetField = targetFields.find(tf => tf.name === field.name);
                        const isMissingInTarget = !targetField;
                        const isRequiredInTarget = targetField?.required;

                        return (
                          <div key={field.name} className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${
                            isMissingInTarget ? 'bg-amber-50 border-amber-100' : 'bg-slate-50 border-slate-100'
                          }`}>
                            <div className="flex items-center gap-4">
                              <input 
                                type="checkbox" 
                                checked={!!fieldMappings[objName]?.[field.name]}
                                disabled={isMissingInTarget}
                                onChange={(e) => {
                                  const newMappings = { ...fieldMappings };
                                  if (!newMappings[objName]) newMappings[objName] = {};
                                  if (e.target.checked) {
                                    newMappings[objName][field.name] = field.name; // Default mapping
                                  } else {
                                    delete newMappings[objName][field.name];
                                  }
                                  setFieldMappings(newMappings);
                                }}
                              />
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="text-xs font-bold text-slate-700">{field.label}</p>
                                  {isRequiredInTarget && <span className="text-[9px] font-bold text-red-500 uppercase tracking-widest">* Required</span>}
                                  {isMissingInTarget && <span className="text-[9px] font-bold text-amber-600 uppercase tracking-widest flex items-center gap-1">
                                    <i className="fas fa-ghost"></i> Missing in Target
                                  </span>}
                                </div>
                                <p className="text-[10px] text-slate-400 font-mono">{field.name}</p>
                              </div>
                            </div>
                            {fieldMappings[objName]?.[field.name] && (
                              <div className="flex items-center gap-3">
                                <i className="fas fa-arrow-right text-slate-300 text-xs"></i>
                                <div className="flex flex-col gap-1">
                                  <label className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Target Field</label>
                                  <input 
                                    type="text"
                                    value={fieldMappings[objName][field.name]}
                                    onChange={(e) => {
                                      const newMappings = { ...fieldMappings };
                                      newMappings[objName][field.name] = e.target.value;
                                      setFieldMappings(newMappings);
                                    }}
                                    className="text-xs border rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                    placeholder="Target Field Name"
                                  />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Default Value</label>
                                  <input 
                                    type="text"
                                    value={fieldDefaultValues[objName]?.[field.name] || ''}
                                    onChange={(e) => {
                                      const newDefaults = { ...fieldDefaultValues };
                                      if (!newDefaults[objName]) newDefaults[objName] = {};
                                      newDefaults[objName][field.name] = e.target.value;
                                      setFieldDefaultValues(newDefaults);
                                    }}
                                    className="text-xs border rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                    placeholder="Optional Default"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Constant Values for Missing Required Fields */}
                      {missingRequiredFields.length > 0 && (
                        <div className="mt-8 space-y-4">
                          <h4 className="text-xs font-bold text-slate-900 flex items-center gap-2">
                            <i className="fas fa-plus-circle text-[#2E2E38]"></i>
                            Constant Values for Missing Required Fields
                          </h4>
                          <div className="grid grid-cols-1 gap-4">
                            {missingRequiredFields.map(tf => (
                              <div key={tf.name} className="flex items-center justify-between p-4 rounded-2xl border border-[#FFE600]/30 bg-[#FFE600]/10/30">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p className="text-xs font-bold text-slate-700">{tf.label}</p>
                                    <span className="text-[9px] font-bold text-red-500 uppercase tracking-widest">* Required</span>
                                  </div>
                                  <p className="text-[10px] text-slate-400 font-mono">{tf.name}</p>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Constant Value</label>
                                  <input 
                                    type="text"
                                    value={constantValues[objName]?.[tf.name] || ''}
                                    onChange={(e) => {
                                      const newConstants = { ...constantValues };
                                      if (!newConstants[objName]) newConstants[objName] = {};
                                      newConstants[objName][tf.name] = e.target.value;
                                      setConstantValues(newConstants);
                                    }}
                                    className="text-xs border rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                    placeholder="Enter Constant Value"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-6">
            {files.map((file, idx) => (
              <div key={idx} className="bg-white rounded-[32px] p-8 border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-[#FFE600]/10 text-[#2E2E38] rounded-xl flex items-center justify-center">
                      <i className="fas fa-table"></i>
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900">{file.name}</h3>
                      <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">{file.objectName}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    {file.objectName === parentObject && (
                      <div className="flex flex-col items-end">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Virtual ID Column (Parent)</label>
                        <select 
                          className={`bg-slate-50 border rounded-xl px-4 py-2 text-xs font-medium transition-all ${
                            !file.externalIdField ? 'border-red-300 ring-2 ring-red-500/10' : 'border-slate-200'
                          }`}
                          value={file.externalIdField || ''}
                          onChange={(e) => {
                            const newFiles = [...files];
                            newFiles[idx].externalIdField = e.target.value;
                            setFiles(newFiles);
                          }}
                        >
                          <option value="">Select Virtual ID...</option>
                          {file.fields.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                      </div>
                    )}
                    {file.objectName !== parentObject && (
                      <div className="flex flex-col items-end">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Parent Relationship</label>
                        <div className="flex space-x-2">
                          {file.parentRelationships?.map((rel, relIdx) => (
                            <div key={relIdx} className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1">
                              <span className="text-[10px] font-bold text-slate-500">{rel.sfLookupField}:</span>
                              <select
                                className="bg-transparent border-none text-[10px] font-medium focus:ring-0 p-0"
                                value={rel.childLookupField}
                                onChange={(e) => {
                                  const newFiles = [...files];
                                  if (newFiles[idx].parentRelationships) {
                                    newFiles[idx].parentRelationships![relIdx].childLookupField = e.target.value;
                                    setFiles(newFiles);
                                  }
                                }}
                              >
                                <option value="">Select CSV Column...</option>
                                {file.fields.map(f => <option key={f} value={f}>{f}</option>)}
                              </select>
                            </div>
                          ))}
                          {(!file.parentRelationships || file.parentRelationships.length === 0) && (
                            <button 
                              onClick={() => {
                                const newFiles = [...files];
                                const obj = orgData.objects.find(o => o.name === file.objectName);
                                const lookupFields = obj?.fields?.filter(f => f.type === 'reference') || [];
                                
                                if (lookupFields.length > 0) {
                                  newFiles[idx].parentRelationships = [{
                                    parentObject: parentObject!,
                                    parentKeyField: 'External_ID',
                                    childLookupField: '',
                                    sfLookupField: lookupFields[0].name
                                  }];
                                  setFiles(newFiles);
                                } else {
                                  addNotification('No Lookups', `No lookup fields found on ${file.objectName} to link to parent.`, 'warning');
                                }
                              }}
                              className="text-[10px] font-bold text-[#2E2E38] hover:text-blue-700 uppercase tracking-widest"
                            >
                              + Add Relationship
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">CSV Header</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sample Data</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Salesforce Field</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {file.fields
                        .filter(header => {
                          // Only show fields that have at least one populated value in the data
                          return file.data.some(row => row[header] !== undefined && row[header] !== null && row[header].toString().trim() !== '');
                        })
                        .map(header => {
                        const sfFields = orgData.objects.find(o => o.name?.toLowerCase() === file.objectName?.toLowerCase())?.fields || [];
                        const isVirtualId = header === file.externalIdField && file.objectName === parentObject;
                        const isLookup = file.parentRelationships?.some(rel => rel.childLookupField === header);
                        
                        return (
                          <tr key={header} className={isVirtualId || isLookup ? 'bg-[#FFE600]/10/30' : ''}>
                            <td className="px-4 py-3 text-sm font-semibold text-slate-700">
                              <div className="flex items-center space-x-2">
                                <span>{header}</span>
                                {isVirtualId && (
                                  <span className="px-2 py-0.5 bg-[#FFE600] text-[#2E2E38] text-[8px] font-bold rounded-full uppercase tracking-tighter">Virtual ID</span>
                                )}
                                {isLookup && (
                                  <div className="flex flex-col">
                                    <span className="px-2 py-0.5 bg-purple-600 text-white text-[8px] font-bold rounded-full uppercase tracking-tighter w-fit">Lookup</span>
                                    <span className="text-[8px] text-purple-600 font-medium mt-0.5">Matches Parent Virtual ID</span>
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500 italic truncate max-w-[200px]">
                              {file.data[0]?.[header]?.toString() || 'N/A'}
                            </td>
                            <td className="px-4 py-3">
                              <select 
                                className={`w-full bg-slate-50 border rounded-xl px-4 py-2 text-xs font-medium transition-all ${
                                  isLookup && !file.fieldMapping?.[header] 
                                    ? 'border-red-300 ring-2 ring-red-500/10' 
                                    : 'border-slate-200'
                                }`}
                                value={file.fieldMapping?.[header] || ''}
                                onChange={(e) => {
                                  const newFiles = [...files];
                                  newFiles[idx].fieldMapping = {
                                    ...(newFiles[idx].fieldMapping || {}),
                                    [header]: e.target.value
                                  };
                                  setFiles(newFiles);
                                }}
                              >
                                <option value="">{isLookup ? 'Select Required Field...' : isVirtualId ? 'Reference Only (Not Mapped)' : 'Ignore Field'}</option>
                                {sfFields.map(f => (
                                  <option key={f.name} value={f.name}>{f.label} ({f.name})</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )}

      {currentStep === 'visualize' && (
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Data Hierarchy Visualization</h2>
              <p className="text-sm text-slate-500 mt-1">Review the relationship structure and mapped fields before deployment.</p>
            </div>
            <div className="flex space-x-4">
              <button onClick={() => setCurrentStep(mode === 'move' ? 'prepare' : 'fieldMapping')} className="px-8 py-3 text-slate-500 font-semibold hover:text-slate-900 transition-colors">Back</button>
              <button 
                onClick={() => setCurrentStep('deploy')}
                className="px-10 py-3 bg-[#FFE600] text-[#2E2E38] font-bold rounded-2xl hover:bg-[#E5CF00] transition-all shadow-xl shadow-[#FFE600]/30 uppercase tracking-widest text-[10px]"
              >
                Proceed to Deployment
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <div className="lg:col-span-3 bg-white rounded-[40px] border border-slate-200 shadow-sm overflow-hidden relative min-h-[600px]">
              <div className="absolute top-6 left-6 z-10">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 rounded-full bg-[#FFE600]"></div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Parent</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 rounded-full bg-slate-200 border border-slate-300"></div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Child</span>
                  </div>
                </div>
              </div>
              <svg ref={svgRef} className="w-full h-full min-h-[600px]"></svg>
            </div>

            <div className="space-y-6">
              <div className="bg-[#2E2E38] rounded-[32px] p-8 text-white">
                <h3 className="text-lg font-semibold mb-6">Deployment Summary</h3>
                <div className="space-y-6">
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Records</p>
                    <p className="text-2xl font-bold">
                      {files.length > 0 
                        ? files.reduce((acc, f) => acc + (f.data?.length || 0), 0).toLocaleString()
                        : isFetchingSource ? 'Calculating...' : '0'}
                    </p>
                  </div>
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Objects Involved</p>
                    <p className="text-2xl font-bold">
                      {mode === 'load' ? files.length : (childObjects.length + 1)}
                    </p>
                  </div>
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Relationships</p>
                    <p className="text-2xl font-bold">
                      {mode === 'load' ? files.reduce((acc, f) => acc + (f.parentRelationships?.length || 0), 0) : childObjects.length}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-[#FFE600]/10 rounded-[32px] p-8 border border-[#FFE600]/30">
                <div className="flex items-center space-x-3 mb-4 text-[#2E2E38]">
                  <i className="fas fa-info-circle"></i>
                  <h4 className="font-bold text-sm uppercase tracking-widest">Pro Tip</h4>
                </div>
                <p className="text-xs text-blue-700 leading-relaxed">
                  {mode === 'move' 
                    ? 'In Org-to-Org mode, we use Bulk API V2 for high-performance data transfer. Relationships are maintained using external IDs.'
                    : 'The diagram shows how records will be linked. Parent records are created first, and their IDs are automatically mapped to child lookups.'}
                </p>
              </div>

              <div className="bg-white rounded-[32px] p-8 border border-slate-200 shadow-sm">
                <h3 className="text-lg font-semibold mb-6 text-slate-900">Selected Fields</h3>
                <div className="space-y-6 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {(mode === 'move' ? [parentObject!, ...childObjects] : files.map(f => f.objectName)).map(objName => {
                    const selectedFields = mode === 'move' 
                      ? Object.keys(fieldMappings[objName] || {})
                      : files.find(f => f.objectName === objName)?.fieldMapping ? Object.values(files.find(f => f.objectName === objName)!.fieldMapping!) : [];
                    
                    return (
                      <div key={objName} className="space-y-2">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{objName}</p>
                        <div className="flex flex-wrap gap-2">
                          {selectedFields.map(f => (
                            <span key={f} className="px-2 py-1 bg-slate-100 text-slate-600 text-[9px] font-medium rounded-lg border border-slate-200">
                              {f}
                            </span>
                          ))}
                          {selectedFields.length === 0 && <p className="text-[10px] text-red-500 italic">No fields selected!</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {currentStep === 'deploy' && (
        <div className="space-y-8">
          <div className="bg-white rounded-[32px] p-10 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Deployment Monitor</h2>
                <p className="text-slate-500 text-sm">
                  {mode === 'move' 
                    ? `Transferring data to ${targetOrgConfig?.instanceUrl || 'Target Org'} using Bulk API V2.`
                    : `Ready to deploy ${files.reduce((acc, f) => acc + f.data.length, 0)} records across ${files.length} objects.`}
                </p>
              </div>
              {!isDeploying && ((deploymentResults?.length || 0) === 0 || deploymentResults.some(r => r.failed > 0)) && (
                <div className="flex space-x-4">
                  <button onClick={() => setCurrentStep('visualize')} className="px-8 py-4 text-slate-500 font-semibold hover:text-slate-900 transition-colors">Back to Visualization</button>
                  <button 
                    onClick={() => {
                      setDeploymentResults([]);
                      if (mode === 'move') {
                        handleMoveDeployment();
                      } else {
                        startDeployment();
                      }
                    }}
                    className="px-10 py-4 bg-[#FFE600] text-[#2E2E38] font-bold rounded-2xl hover:bg-[#E5CF00] transition-all shadow-xl shadow-[#FFE600]/30 uppercase tracking-widest text-[10px]"
                  >
                    {deploymentResults.length > 0 ? 'Retry Deployment' : 'Start Deployment'}
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-4">
              {(mode === 'move' ? [parentObject, ...childObjects] : files.map(f => f.objectName)).map((objName, idx) => {
                const result = deploymentResults.find(r => r.objectName === objName);
                const isDone = result && ((result.success + result.failed) === result.total || (!isDeploying && result.total === 0));
                const isProcessing = isDeploying && result && !isDone;
                const isWaiting = isDeploying && !result;
                const hasError = result && result.failed > 0;

                return (
                  <div key={idx} className={`p-6 rounded-3xl border transition-all ${
                    isProcessing ? 'bg-[#FFE600]/10 border-[#FFE600]/30' : 
                    hasError && isDone ? 'bg-red-50 border-red-100' :
                    isDone ? 'bg-slate-50 border-slate-100' : 
                    'bg-white border-slate-100 opacity-50'
                  }`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-4">
                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
                          hasError && isDone ? 'bg-red-600 text-white' :
                          isDone ? 'bg-green-100 text-green-600' : 
                          isProcessing ? 'bg-[#FFE600] text-[#2E2E38]' : 
                          'bg-slate-100 text-slate-400'
                        }`}>
                          <i className={`fas ${hasError && isDone ? 'fa-exclamation-triangle' : isDone ? 'fa-check' : isProcessing ? 'fa-spinner fa-spin' : 'fa-clock'}`}></i>
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-900">{objName}</h3>
                          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">
                            {hasError && isDone ? 'Completed with errors' : isDone ? 'Completed' : isProcessing ? 'Processing...' : 'Waiting...'}
                          </p>
                        </div>
                      </div>
                      
                      {result && (
                        <div className="flex space-x-6 text-right">
                          <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Success</p>
                            <p className="text-lg font-bold text-green-600">{result.success}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Failed</p>
                            <p className={`text-lg font-bold ${result.failed > 0 ? 'text-red-500' : 'text-slate-300'}`}>{result.failed}</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {isDone && result.failed > 0 && (
                      <div className="mt-4 p-4 bg-white/50 rounded-2xl border border-red-100">
                        <p className="text-xs font-bold text-red-600 uppercase tracking-widest mb-2">Errors</p>
                        <ul className="space-y-1">
                          {result.errors.slice(0, 5).map((err, errIdx) => (
                            <li key={errIdx} className="text-xs text-red-500 flex items-start space-x-2">
                              <i className="fas fa-circle text-[4px] mt-1.5"></i>
                              <span>{typeof err === 'string' ? err : JSON.stringify(err)}</span>
                            </li>
                          ))}
                          {result.errors.length > 5 && (
                            <li className="text-[10px] text-slate-400 italic pl-3">... and {result.errors.length - 5} more errors</li>
                          )}
                        </ul>
                      </div>
                    )}

                    {isProcessing && result && (
                      <div className="mt-4 space-y-2">
                        <div className="flex justify-between text-[10px] font-bold text-[#2E2E38] uppercase tracking-widest">
                          <span>Progress</span>
                          <span>{Math.round(((result.success + result.failed) / result.total) * 100)}%</span>
                        </div>
                        <div className="w-full h-2 bg-blue-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-[#FFE600] transition-all duration-500" 
                            style={{ width: `${((result.success + result.failed) / result.total) * 100}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {((mode === 'move' && deploymentResults.length === (childObjects.length + 1)) || (mode === 'load' && deploymentResults.length === files.length)) && !isDeploying && !deploymentResults.some(r => r.failed > 0) && (
            <div className="bg-[#2E2E38] rounded-[32px] p-12 text-white text-center shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#FFE600] via-purple-500 to-pink-500"></div>
              
              <div className="absolute inset-0 pointer-events-none">
                {[...Array(20)].map((_, i) => (
                  <div 
                    key={i}
                    className="absolute w-2 h-2 rounded-full animate-ping"
                    style={{
                      top: `${Math.random() * 100}%`,
                      left: `${Math.random() * 100}%`,
                      backgroundColor: ['#3B82F6', '#8B5CF6', '#EC4899', '#10B981'][Math.floor(Math.random() * 4)],
                      animationDelay: `${Math.random() * 2}s`,
                      animationDuration: `${2 + Math.random() * 2}s`
                    }}
                  ></div>
                ))}
              </div>

              <div className="relative z-10">
                <div className="w-24 h-24 bg-[#FFE600] rounded-[32px] flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-[#FFE600]/30 rotate-12">
                  <i className="fas fa-rocket text-4xl"></i>
                </div>
                <h2 className="text-3xl font-bold tracking-tight mb-4">Deployment Successful!</h2>
                <p className="text-slate-400 font-medium mb-10 max-w-md mx-auto">
                  {mode === 'move' 
                    ? 'All records have been successfully transferred to the target org. Your data migration is complete.'
                    : 'All records have been successfully deployed to Salesforce. Your data hierarchy is now live.'}
                </p>
                <button 
                  onClick={() => {
                    setCurrentStep('home');
                    setFiles([]);
                    setDeploymentResults([]);
                    setParentObject(null);
                    setChildObjects([]);
                  }}
                  className="px-12 py-5 bg-white text-slate-900 font-bold rounded-2xl hover:bg-slate-50 transition-all shadow-xl shadow-white/10 uppercase tracking-widest text-[10px]"
                >
                  Return to Homepage
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default EnhancedDataLoader;
