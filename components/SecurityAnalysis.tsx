
import React, { useState, useEffect } from 'react';
import { SalesforceOrgData, SecurityFinding, SecurityAuditResult, SecurityCheckPoint, GuestUserContext } from '../types';
import { motion, AnimatePresence } from 'framer-motion';
import { SecurityScannerService } from '../services/securityScannerService';
import { auth } from '../firebase';
import { useToast } from './Toast';
import { PMD_RULES } from '../src/constants';

interface SecurityAnalysisProps {
  orgData: SalesforceOrgData;
  sfService: any;
  onOrgDataUpdate?: (data: SalesforceOrgData | ((prev: SalesforceOrgData | null) => SalesforceOrgData | null)) => void;
}

const SecurityAnalysis: React.FC<SecurityAnalysisProps> = ({ orgData, sfService, onOrgDataUpdate }) => {
  const { toast } = useToast();
  const [findings, setFindings] = useState<SecurityFinding[]>([]);
  const [healthChecks, setHealthChecks] = useState<SecurityCheckPoint[]>([]);
  const [auditHistory, setAuditHistory] = useState<SecurityAuditResult[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [scannedTiles, setScannedTiles] = useState<Record<string, { status: 'secure' | 'risk' | 'none', count: number }>>({});
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [selectedHealthCheck, setSelectedHealthCheck] = useState<SecurityCheckPoint | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<'static' | 'guest' | 'portal' | null>(null);
  const [selectedRules, setSelectedRules] = useState<string[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedProfileName, setSelectedProfileName] = useState<string | null>(null);
  const [objectFilter, setObjectFilter] = useState<'all' | 'risky' | 'secure'>('all');
  const [objectSearch, setObjectSearch] = useState('');
  const [showDetailedModal, setShowDetailedModal] = useState(false);
  const [modalTab, setModalTab] = useState<'object' | 'field' | 'sharing' | 'apex'>('object');
  const [apexModalTab, setApexModalTab] = useState<'classes' | 'pages'>('classes');
  const [isModalLoading, setIsModalLoading] = useState(false);
  const [isRefreshingProfile, setIsRefreshingProfile] = useState(false);
  const [dbObjects, setDbObjects] = useState<any[]>([]);
  const [guestUserContexts, setGuestUserContexts] = useState<GuestUserContext[]>(orgData.guestUserContexts || []);
  const [selectedGuestUserId, setSelectedGuestUserId] = useState<string | null>(null);
  const [permSetMetadataCache, setPermSetMetadataCache] = useState<Record<string, any>>({});
  const [isFetchingPermSets, setIsFetchingPermSets] = useState(false);

  const [isHealthChecking, setIsHealthChecking] = useState(false);
  const [isStaticScanning, setIsStaticScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0, item: '' });

  const guestProfiles = orgData.profiles?.filter(p => {
    const licenseName = (p.UserLicense?.Name || p.UserLicense?.name || '').toLowerCase();
    const profileName = (p.name || '').toLowerCase();
    const profileLabel = (p.label || (p as any).Name || '').toLowerCase();
    const userType = (p.UserType || '').toLowerCase();
    
    return userType === 'guest' || 
           licenseName.includes('guest') || 
           profileName.includes('guest') || 
           profileLabel.includes('guest') ||
           profileName.includes('site') ||
           profileLabel.includes('site');
  }) || [];

  const portalProfiles = React.useMemo(() => {
    return orgData.profiles?.filter(p => {
      const licenseName = (p.UserLicense?.Name || p.UserLicense?.name || '').toLowerCase();
      const profileName = (p.name || '').toLowerCase();
      const profileLabel = (p.label || (p as any).Name || '').toLowerCase();
      const userType = (p.UserType || '').toLowerCase();
      
      return licenseName.includes('portal') || 
             licenseName.includes('community') ||
             profileName.includes('portal') || 
             profileName.includes('community') ||
             profileLabel.includes('portal') || 
             profileLabel.includes('community') ||
             userType.includes('portal') ||
             userType.includes('community') ||
             profileName.includes('customer') ||
             profileLabel.includes('customer');
    }) || [];
  }, [orgData.profiles]);

  const effectiveRights = React.useMemo(() => {
    if (!showDetailedModal || !selectedObjectId) return null;
    
    const sourceObjects = dbObjects.length > 0 ? dbObjects : (selectedHealthCheck?.drillDownData?.objects || []);
    const selectedObjRaw = sourceObjects.find((o: any) => o.name === selectedObjectId);
    if (!selectedObjRaw) return null;

    const activeProfile = selectedProfileName || (selectedCategory === 'guest' ? guestProfiles[0]?.name : portalProfiles[0]?.name);
    
    // Base Profile Permissions
    const permsArray = Array.isArray(selectedObjRaw.permissions) ? selectedObjRaw.permissions : (selectedObjRaw.permissions ? [selectedObjRaw.permissions] : []);
    const profilePerms = permsArray.find((p: any) => p.profile === activeProfile) || { read: false, create: false, edit: false, delete: false };
    
    // Base Field Permissions
    const profileFieldPerms = selectedObjRaw.fields?.filter((f: any) => !f.profile || f.profile === activeProfile) || [];

    // Selected Context - Only apply Permission Sets for Guest Users
    const activeUserId = selectedCategory === 'guest' ? (selectedGuestUserId || (guestUserContexts.find(c => c.profileName === activeProfile || c.profileId === guestProfiles.find(p => p.name === activeProfile)?.id)?.userId || null)) : null;
    const context = activeUserId ? guestUserContexts.find(c => c.userId === activeUserId) : null;
    const selectedPermSets = (selectedCategory === 'guest' && context) ? context.selectedPermSetIds.map(id => permSetMetadataCache[id]).filter(Boolean) : [];

    return SecurityScannerService.calculateEffectiveAccess(
      activeProfile,
      activeProfile, 
      [{ ...profilePerms, object: selectedObjectId }],
      profileFieldPerms.map((f: any) => ({ ...f, field: `${selectedObjectId}.${f.name}` })),
      selectedPermSets
    );
  }, [selectedObjectId, selectedProfileName, selectedGuestUserId, guestUserContexts, permSetMetadataCache, dbObjects, selectedHealthCheck, showDetailedModal, selectedCategory]);

  const analysisTiles = [
    { 
      id: 'pmd-official', 
      label: 'Static Code Analysis', 
      icon: 'fa-microchip', 
      description: 'AI-powered static code analysis for Apex classes.',
      explanation: 'Uses advanced AI to scan your Apex code against critical security rules like SOQL Injection, CRUD/FLS violations, and sharing rule bypasses. This provides a comprehensive, intelligent security audit.'
    }
  ];

  useEffect(() => {
    if (orgData.profiles?.length > 0) {
      console.log(`DEBUG: SecurityAnalysis - Total profiles: ${orgData.profiles.length}`);
      console.log(`DEBUG: SecurityAnalysis - Guest profiles identified: ${guestProfiles.length}`);
      guestProfiles.forEach(p => {
        console.log(`DEBUG:   - Guest Profile: ${p.name} (License: ${p.UserLicense?.Name || p.UserLicense?.name || 'Unknown'}, UserType: ${p.UserType || 'Unknown'})`);
      });
    }
  }, [orgData.profiles, guestProfiles.length]);

  const refreshProfileMetadata = async () => {
    if (!sfService || !selectedProfileName) return;
    
    const profiles = selectedCategory === 'guest' ? guestProfiles : portalProfiles;
    const profile = profiles.find(p => p.name === selectedProfileName);
    if (!profile) return;

    setIsRefreshingProfile(true);
    try {
      toast({ title: 'Refreshing Metadata', message: `Fetching full metadata for ${profile.label || profile.name}...`, type: 'info' });
      const details = await sfService.fetchMetadataContent('profiles', profile.id);
      
      // Update local orgData
      if (onOrgDataUpdate) {
        onOrgDataUpdate((prev: any) => {
          if (!prev) return prev;
          const updatedProfiles = prev.profiles.map((p: any) => 
            p.id === profile.id ? { ...p, ...details } : p
          );
          return { ...prev, profiles: updatedProfiles };
        });
      }

      // Re-run health checks to update the security report with new profile data
      const updatedCheckPoints = await SecurityScannerService.scanSecurityHealthCheck({
        ...orgData,
        profiles: orgData.profiles.map(p => p.id === profile.id ? { ...p, ...details } : p)
      });
      
      const objCheck = updatedCheckPoints.find(c => c.id === 'object-field-security');
      if (objCheck && objCheck.drillDownData?.objects) {
        // Extract objects for this specific profile
        const profileObjects = objCheck.drillDownData.objects.map((obj: any) => {
          const profilePerms = obj.permissions.find((p: any) => p.profile === profile.name);
          const profileFields = obj.fields.filter((f: any) => f.profile === profile.name);
          
          const hasSensitiveExposed = profileFields.some((f: any) => f.isSensitive && f.edit);
          const isRisky = obj.isRiskyOWD || hasSensitiveExposed;

          return {
            name: obj.name,
            label: obj.label,
            internalModel: obj.internalModel,
            externalModel: obj.externalModel,
            isRiskyOWD: obj.isRiskyOWD,
            permissions: profilePerms ? [profilePerms] : [],
            fields: profileFields,
            isRisky: isRisky
          };
        });

        // Store granularly
        await sfService.storeGranularSecurityResult(selectedCategory, profile.name, profileObjects);
        setDbObjects(profileObjects);
      }

      await runHealthChecks();
      
      toast({ title: 'Refresh Complete', message: `Metadata for ${profile.label || profile.name} has been updated.`, type: 'success' });
    } catch (e: any) {
      console.error('Profile refresh failed', e);
      toast({ title: 'Refresh Failed', message: e.message, type: 'error' });
    } finally {
      setIsRefreshingProfile(false);
    }
  };

  const togglePermSet = async (userId: string, permSetId: string) => {
    const updated = guestUserContexts.map(ctx => {
      if (ctx.userId === userId) {
        const isSelected = ctx.selectedPermSetIds.includes(permSetId);
        const newIds = isSelected 
          ? ctx.selectedPermSetIds.filter(id => id !== permSetId)
          : [...ctx.selectedPermSetIds, permSetId];
        return { ...ctx, selectedPermSetIds: newIds };
      }
      return ctx;
    });

    setGuestUserContexts(updated);
    if (onOrgDataUpdate) {
      onOrgDataUpdate(prev => prev ? { ...prev, guestUserContexts: updated } : prev);
    }

    // Lazy load metadata if needed
    const isSelectedNow = updated.find(c => c.userId === userId)?.selectedPermSetIds.includes(permSetId);
    if (isSelectedNow && !permSetMetadataCache[permSetId]) {
      setIsFetchingPermSets(true);
      try {
        const details = await sfService.fetchMetadataContent('permissionSets', permSetId);
        setPermSetMetadataCache(prev => ({ ...prev, [permSetId]: details }));
      } catch (e) {
        console.error("Failed to fetch permset metadata", e);
      } finally {
        setIsFetchingPermSets(false);
      }
    }
  };

  const clearAllPermSets = (userId: string) => {
    const updated = guestUserContexts.map(ctx => {
      if (ctx.userId === userId) {
        return { ...ctx, selectedPermSetIds: [] };
      }
      return ctx;
    });
    setGuestUserContexts(updated);
    if (onOrgDataUpdate) {
      onOrgDataUpdate(prev => prev ? { ...prev, guestUserContexts: updated } : prev);
    }
  };

  useEffect(() => {
    const loadGranularData = async () => {
      if (!showDetailedModal || !selectedProfileName || !selectedCategory || !sfService) return;
      
      setIsModalLoading(true);
      try {
        const objects = await sfService.fetchGranularSecurityResult(selectedCategory, selectedProfileName);
        if (objects && objects.length > 0) {
          setDbObjects(objects);
        } else {
          setDbObjects([]);
        }
      } catch (e) {
        console.error("Failed to load granular data", e);
      } finally {
        setIsModalLoading(false);
      }
    };
    
    loadGranularData();
  }, [showDetailedModal, selectedProfileName, selectedCategory]);

  useEffect(() => {
    const fetchUserContexts = async () => {
      if (!sfService) return;
      
      setIsHealthChecking(true);
      try {
        if (selectedCategory === 'guest') {
          // Only fetch if we don't have them yet or we are missing guest users
          const hasGuest = guestUserContexts.some(c => c.siteName && c.siteName !== 'Portal User');
          if (!hasGuest) {
            const contexts = await sfService.fetchGuestUserContext();
            
            // Merge with existing portal contexts if any exist
            const existingPortal = guestUserContexts.filter(c => c.siteName === 'Portal User');
            const merged = [...contexts, ...existingPortal];
            
            setGuestUserContexts(merged);
            if (onOrgDataUpdate) onOrgDataUpdate(prev => prev ? { ...prev, guestUserContexts: merged } : prev);
          }
        }
      } catch (e) {
        console.error("Failed to fetch User Contexts", e);
      } finally {
        setIsHealthChecking(false);
      }
    };
    fetchUserContexts();
  }, [selectedCategory, sfService, portalProfiles]);

  const syncProfiles = async () => {
    if (!sfService) return;
    setIsHealthChecking(true);
    try {
      toast({ title: 'Syncing Profiles', message: 'Fetching latest profile data from Salesforce...', type: 'info' });
      
      const promises: any[] = [sfService.fetchCategory('profiles')];
      
      if (selectedCategory === 'guest') {
        promises.push(sfService.fetchGuestUserContext().catch(() => []));
      }
      
      const [profiles, newContexts = []] = await Promise.all(promises);

      // Merge newly synced contexts with existing unrelated contexts
      const updatedContexts = selectedCategory === 'guest' 
        ? [...newContexts, ...guestUserContexts.filter(c => c.siteName === 'Portal User')]
        : guestUserContexts;

      setGuestUserContexts(updatedContexts);
      
      // Identify special profiles and fetch their full metadata for security analysis
      const specialProfiles = profiles.filter((p: any) => {
        const licenseName = (p.UserLicense?.Name || p.UserLicense?.name || '').toLowerCase();
        const profileName = (p.name || '').toLowerCase();
        const profileLabel = (p.label || p.Name || '').toLowerCase();
        const userType = (p.UserType || '').toLowerCase();
        
        return userType === 'guest' || 
               licenseName.includes('guest') || 
               profileName.includes('guest') || 
               profileLabel.includes('guest') ||
               profileName.includes('site') ||
               profileLabel.includes('site') ||
               licenseName.includes('portal') || 
               licenseName.includes('community') ||
               profileName.includes('portal') || 
               profileName.includes('community') ||
               profileLabel.includes('portal') || 
               profileLabel.includes('community') ||
               userType.includes('portal') ||
               userType.includes('community') ||
               profileName.includes('customer') ||
               profileLabel.includes('customer');
      });

      if (specialProfiles.length > 0) {
        toast({ title: 'Fetching Details', message: `Retrieving security details for ${specialProfiles.length} profiles...`, type: 'info' });
        await Promise.all(specialProfiles.map(async (gp: any) => {
          try {
            const details = await sfService.fetchMetadataContent('profiles', gp.id);
            Object.assign(gp, details);
          } catch (e) {
            console.warn(`Failed to fetch full metadata for profile ${gp.name}`, e);
          }
        }));
      }

      // Update local orgData
      if (onOrgDataUpdate) {
        onOrgDataUpdate((prev: any) => ({ ...prev, profiles }));
      }
      
      toast({ title: 'Sync Complete', message: `Successfully synced ${profiles.length} profiles. Re-running security scan...`, type: 'success' });
      
      // Re-run health checks to update the security report with new profile data
      await runHealthChecks();
      
    } catch (e: any) {
      console.error('Profile sync failed', e);
      toast({ title: 'Sync Failed', message: e.message, type: 'error' });
    } finally {
      setIsHealthChecking(false);
    }
  };

  useEffect(() => {
    if (selectedCategory && (selectedCategory === 'guest' || selectedCategory === 'portal')) {
      const profiles = selectedCategory === 'guest' ? guestProfiles : portalProfiles;
      if (profiles.length > 0) {
        // If current selected profile is not in the new category's list, reset it
        if (!selectedProfileName || !profiles.some(p => p.name === selectedProfileName)) {
          setSelectedProfileName(profiles[0].name);
        }
      } else {
        setSelectedProfileName(null);
      }
    }
  }, [selectedCategory, guestProfiles.length, portalProfiles.length]);

  useEffect(() => {
    if (showDetailedModal && !selectedProfileName) {
      const profiles = selectedCategory === 'guest' ? guestProfiles : portalProfiles;
      if (profiles.length > 0) {
        setSelectedProfileName(profiles[0].name);
      }
    }
  }, [showDetailedModal]);

  useEffect(() => {
    const checkAuthAndLoad = async () => {
      // Wait for Firebase auth to be ready
      let attempts = 0;
      while (!auth.currentUser && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
      }
      
      if (auth.currentUser) {
        fetchAuditHistory();
        loadStoredAnalysis();
      } else {
        console.warn("⚠️ Firebase authentication not ready, skipping stored analysis load.");
      }
    };
    
    checkAuthAndLoad();
  }, [orgData.orgId]);

  useEffect(() => {
    if (showDetailedModal && selectedHealthCheck?.id === 'object-field-security') {
      const objects = (selectedHealthCheck.drillDownData?.objects || [])
        .filter((obj: any) => {
          const label = (obj.label || '').toLowerCase();
          const name = (obj.name || '').toLowerCase();
          return !label.includes('missing label') && !name.includes('missing label');
        });

      if (objects.length > 0 && !selectedObjectId) {
        setSelectedObjectId(objects[0].name);
      }

      const hasData = selectedHealthCheck.drillDownData?.objects?.length > 0;
      if (!hasData) {
        setIsModalLoading(true);
        // If data is missing, we trigger a health check to populate it
        runHealthChecks().finally(() => {
          setIsModalLoading(false);
        });
      } else {
        // Even if we have data, show a brief spinner for "runtime retrieval" feel as requested
        setIsModalLoading(true);
        const timer = setTimeout(() => setIsModalLoading(false), 600);
        return () => clearTimeout(timer);
      }
    }
  }, [showDetailedModal, selectedHealthCheck?.id, selectedHealthCheck?.drillDownData?.objects?.length]);

  const loadStoredAnalysis = async () => {
    setIsHealthChecking(true);
    try {
      const storedData = await SecurityScannerService.getSecurityAnalysis(orgData.orgId);
      if (storedData) {
        const checksArray: SecurityCheckPoint[] = [];
        let pmdFindings: SecurityFinding[] = [];
        
        // Sort by timestamp to get latest for each ID
        const latestResults: Record<string, any> = {};
        Object.values(storedData).forEach((item: any) => {
          if (!latestResults[item.id] || new Date(item.timestamp) > new Date(latestResults[item.id].timestamp)) {
            latestResults[item.id] = item;
          }
        });

        Object.values(latestResults).forEach((item: any) => {
          if (item.id === 'pmd-official') {
            // Handle both formats: direct array or SecurityCheckPoint object
            if (Array.isArray(item.data)) {
              pmdFindings = item.data;
            } else if (item.data?.drillDownData?.findings) {
              pmdFindings = item.data.drillDownData.findings;
            }
          } else if (item.data && !Array.isArray(item.data)) {
            checksArray.push(item.data);
          }
        });

        // Construct Static Analysis checkpoint
        const aiCheck: SecurityCheckPoint = {
          id: 'pmd-official',
          title: 'Static Code Analysis',
          setupPath: 'Apex Classes',
          status: pmdFindings.length > 0 ? `${pmdFindings.length} Issues` : 'Secure',
          isRisky: pmdFindings.length > 0,
          description: 'AI-powered static code analysis to identify vulnerabilities in Apex code.',
          details: pmdFindings.length > 0 ? `Found ${pmdFindings.length} potential security issues in Apex classes.` : 'No security issues identified in scanned Apex classes.',
          drillDownData: { findings: pmdFindings }
        };

        // Filter out any existing pmd-official from checksArray just in case
        const filteredChecks = checksArray.filter(c => c.id !== 'pmd-official');
        setHealthChecks([aiCheck, ...filteredChecks]);
      }
    } catch (e) {
      console.error('Failed to load stored analysis', e);
    } finally {
      setIsHealthChecking(false);
    }
  };

  const fetchAuditHistory = async () => {
    try {
      const response = await fetch(`/api/security/analysis/${orgData.orgId}`);
      if (response.ok) {
        const data = await response.json();
        const historyArray = Object.values(data).map((item: any) => {
          const isStatic = item.id === 'pmd-official';
          let title = item.id.replace(/-/g, ' ');
          if (isStatic) {
            title = 'Static Code Analysis';
          } else if (item.data && item.data.title) {
            title = item.data.title;
          }
          
          return {
            id: item.id,
            title,
            orgId: item.orgId,
            timestamp: item.timestamp,
            type: isStatic ? 'static' : 'health-check',
            findings: isStatic ? item.data : undefined,
            healthChecks: isStatic ? undefined : [item.data],
            summary: item.summary || { riskyChecks: item.data.isRisky ? 1 : 0 }
          };
        });
        historyArray.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setAuditHistory(historyArray as any);
      }
    } catch (e) {
      console.error('Failed to fetch audit history', e);
    }
  };

  const runHealthChecks = async () => {
    setIsHealthChecking(true);
    try {
      // Ensure profiles are loaded if missing
      if (!orgData.profiles || orgData.profiles.length === 0) {
        toast({ title: 'Fetching Profiles', message: 'Profile data missing, retrieving from Salesforce...', type: 'info' });
        const profiles = await sfService.fetchCategory('profiles');
        
        // Identify special profiles and fetch their full metadata for security analysis
        const specialProfiles = profiles.filter((p: any) => {
          const licenseName = (p.UserLicense?.Name || p.UserLicense?.name || '').toLowerCase();
          const profileName = (p.name || '').toLowerCase();
          const profileLabel = (p.label || p.Name || '').toLowerCase();
          const userType = (p.UserType || '').toLowerCase();
          
          return userType === 'guest' || 
                 licenseName.includes('guest') || 
                 profileName.includes('guest') || 
                 profileLabel.includes('guest') ||
                 profileName.includes('site') ||
                 profileLabel.includes('site') ||
                 licenseName.includes('portal') || 
                 licenseName.includes('community') ||
                 profileName.includes('portal') || 
                 profileName.includes('community') ||
                 profileLabel.includes('portal') || 
                 profileLabel.includes('community') ||
                 userType.includes('portal') ||
                 userType.includes('community') ||
                 profileName.includes('customer') ||
                 profileLabel.includes('customer');
        });

        if (specialProfiles.length > 0) {
          toast({ title: 'Fetching Details', message: `Retrieving security details for ${specialProfiles.length} profiles...`, type: 'info' });
          await Promise.all(specialProfiles.map(async (gp: any) => {
            try {
              const details = await sfService.fetchMetadataContent('profiles', gp.id);
              Object.assign(gp, details);
            } catch (e) {
              console.warn(`Failed to fetch full metadata for profile ${gp.name}`, e);
            }
          }));
        }

        if (onOrgDataUpdate) {
          onOrgDataUpdate((prev: any) => ({ ...prev, profiles }));
        }
      }

      // Run config checks only
      const checks = await SecurityScannerService.scanSecurityHealthCheck(orgData);

      // Keep existing PMD check if it exists
      const existingPMD = healthChecks.find(c => c.id === 'pmd-official');
      const allChecks = existingPMD ? [existingPMD, ...checks] : checks;
      setHealthChecks(allChecks);

      // Store in the specific collection requested by user, per tile
      if (sfService) {
        for (const check of checks) {
          try {
            await sfService.storeSecurityAnalysisResult(
              check.id,
              check,
              { riskyChecks: check.isRisky ? 1 : 0 }
            );

            // If it's object security, store granularly for ALL guest and portal profiles
            if (check.id === 'object-field-security' && check.drillDownData?.objects) {
              const allRelevantProfiles = [...guestProfiles, ...portalProfiles];
              for (const p of allRelevantProfiles) {
                const category = guestProfiles.some(gp => gp.id === p.id) ? 'guest' : 'portal';
                const profileObjects = check.drillDownData.objects.map((obj: any) => {
                  const profilePerms = obj.permissions.find((perm: any) => perm.profile === p.name);
                  const profileFields = obj.fields.filter((f: any) => f.profile === p.name);
                  
                  const hasSensitiveExposed = profileFields.some((f: any) => f.isSensitive && f.edit);
                  const isRisky = obj.isRiskyOWD || hasSensitiveExposed;

                  return {
                    name: obj.name,
                    label: obj.label,
                    internalModel: obj.internalModel,
                    externalModel: obj.externalModel,
                    isRiskyOWD: obj.isRiskyOWD,
                    permissions: profilePerms ? [profilePerms] : [],
                    fields: profileFields,
                    isRisky: isRisky
                  };
                });
                
                await sfService.storeGranularSecurityResult(category, p.name, profileObjects);
                
                // If this is the currently selected profile, update the UI state
                if (p.name === selectedProfileName) {
                  setDbObjects(profileObjects);
                }
              }
            }
          } catch (e) {
            console.warn(`Failed to store result for ${check.id}`, e);
          }
        }
      }

      await fetchAuditHistory();
      
      toast({
        title: 'Health Check Complete',
        message: `Security configuration scan finished. Found ${checks.filter(c => c.isRisky).length} risky configurations.`,
        type: checks.some(c => c.isRisky) ? 'info' : 'success',
      });
    } catch (e) {
      console.error('Health checks failed', e);
      toast({
        title: 'Scan Failed',
        message: 'An error occurred during the security health check.',
        type: 'error',
      });
    } finally {
      setIsHealthChecking(false);
    }
  };

  const runStaticAnalysis = async () => {
    setIsStaticScanning(true);
    setScanProgress({ current: 0, total: 0, item: 'Initializing AI Static Analysis...' });
    try {
      const aiResults = await SecurityScannerService.runAISecurityScan(
        orgData, 
        sfService,
        (current, total, item) => setScanProgress({ current, total, item })
      );
      
      const aiCheck: SecurityCheckPoint = {
        id: 'pmd-official',
        title: 'AI Static Code Analysis',
        setupPath: 'Apex Classes',
        status: aiResults.length > 0 ? `${aiResults.length} Issues` : 'Secure',
        isRisky: aiResults.length > 0,
        description: 'AI-powered static code analysis to identify vulnerabilities in Apex code.',
        details: aiResults.length > 0 ? `Found ${aiResults.length} potential security issues in Apex classes.` : 'No security issues identified in scanned Apex classes.',
        drillDownData: { findings: aiResults }
      };

      // Update healthChecks with new Static Analysis result
      setHealthChecks(prev => {
        const filtered = prev.filter(c => c.id !== 'pmd-official');
        return [aiCheck, ...filtered];
      });

      if (selectedHealthCheck?.id === 'pmd-official') {
        setSelectedHealthCheck(aiCheck);
      }

      // Store Static Analysis result
      if (sfService) {
        try {
          await sfService.storeSecurityAnalysisResult(
            'pmd-official',
            aiCheck,
            { 
              critical: aiResults.filter(f => f.severity === 'Critical').length,
              high: aiResults.filter(f => f.severity === 'High').length,
              medium: aiResults.filter(f => f.severity === 'Medium').length,
              low: aiResults.filter(f => f.severity === 'Low').length,
            }
          );
        } catch (e) {
          console.warn("Failed to store static analysis result", e);
        }
      }

      await fetchAuditHistory();
      
      toast({
        title: 'Static Analysis Complete',
        message: `AI scan finished. Found ${aiResults.length} potential security issues in Apex classes.`,
        type: aiResults.length > 0 ? 'info' : 'success',
      });
    } catch (e) {
      console.error('AI Analysis failed', e);
      toast({
        title: 'Scan Failed',
        message: 'An error occurred during AI analysis. Please try again.',
        type: 'error',
      });
    } finally {
      setIsStaticScanning(false);
      setScanProgress({ current: 0, total: 0, item: '' });
    }
  };

  const handleBack = () => {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    if (selectedHealthCheck) {
      // If we're in static analysis, going back from the drill-down should take us to the landing page
      if (selectedCategory === 'static') {
        setSelectedCategory(null);
      }
      setSelectedHealthCheck(null);
      return;
    }
    if (selectedCategory) {
      setSelectedCategory(null);
      return;
    }
    window.history.back();
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'Critical': return 'text-red-600 bg-red-50 border-red-100';
      case 'High': return 'text-orange-600 bg-orange-50 border-orange-100';
      case 'Medium': return 'text-yellow-600 bg-yellow-50 border-yellow-100';
      case 'Low': return 'text-[#2E2E38] bg-[#FFE600]/10 border-[#FFE600]/30';
      default: return 'text-slate-600 bg-slate-50 border-slate-100';
    }
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={handleBack}
            className="w-10 h-10 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-all"
          >
            <i className="fas fa-chevron-left"></i>
          </button>
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Security Analysis</h1>
            <p className="text-slate-500 mt-1">Audit and analyze your Salesforce organization's security posture.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className="px-4 py-2 text-slate-600 font-bold rounded-xl hover:bg-slate-100 transition-all text-[10px] uppercase tracking-widest border border-slate-200"
          >
            <i className="fas fa-history mr-2"></i>
            {showHistory ? 'Hide History' : 'Audit History'}
          </button>
          <button 
            onClick={() => runHealthChecks()}
            disabled={isHealthChecking || isStaticScanning}
            className="px-6 py-3 bg-[#FFE600] text-[#2E2E38] font-bold rounded-2xl hover:bg-[#E5CF00] transition-all shadow-xl shadow-[#FFE600]/30 uppercase tracking-widest text-[10px] flex items-center gap-2 disabled:opacity-50"
          >
            <i className={`fas ${isHealthChecking ? 'fa-spinner fa-spin' : 'fa-shield-halved'}`}></i>
            {isHealthChecking ? 'Scanning...' : 'Run Health Check'}
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {showHistory ? (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <h2 className="text-xl font-bold text-slate-900">Audit History</h2>
            {auditHistory.length === 0 ? (
              <div className="p-12 text-center bg-white rounded-[32px] border border-slate-200">
                <p className="text-slate-400">No audit history found for this organization.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {auditHistory.map((audit) => (
                  <div key={audit.id} className="bg-white p-6 rounded-[32px] border border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-[#FFE600]/10 text-[#2E2E38]`}>
                        <i className={`fas fa-shield-halved`}></i>
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 capitalize">{audit.title || audit.id.replace(/-/g, ' ')}</p>
                        <p className="text-xs text-slate-500">{new Date(audit.timestamp).toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="flex gap-4 items-center">
                      <div className="flex gap-2">
                        {audit.type === 'health-check' ? (
                          <span className={`px-2 py-1 text-[10px] font-bold rounded-lg border ${audit.summary.riskyChecks && audit.summary.riskyChecks > 0 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-green-50 text-green-600 border-green-100'}`}>
                            {audit.summary.riskyChecks || 0} Risks Found
                          </span>
                        ) : (
                          <>
                            {audit.summary.critical > 0 && <span className="px-2 py-1 bg-red-50 text-red-600 text-[10px] font-bold rounded-lg border border-red-100">{audit.summary.critical} Critical</span>}
                            {audit.summary.high > 0 && <span className="px-2 py-1 bg-orange-50 text-orange-600 text-[10px] font-bold rounded-lg border border-orange-100">{audit.summary.high} High</span>}
                          </>
                        )}
                      </div>
                      <button 
                        onClick={() => {
                          if (audit.type === 'health-check' && audit.healthChecks) {
                            setHealthChecks(audit.healthChecks);
                          } else if (audit.findings) {
                            // Convert findings back to a health check point for display
                            const pmdCheck: SecurityCheckPoint = {
                              id: 'pmd-official',
                              title: 'Static Code Analysis (PMD)',
                              setupPath: 'Apex Classes',
                              status: audit.findings.length > 0 ? `${audit.findings.length} Issues` : 'Secure',
                              isRisky: audit.findings.length > 0,
                              description: 'Standardized security audit using PMD ruleset to identify vulnerabilities in Apex code.',
                              details: audit.findings.length > 0 ? `Found ${audit.findings.length} potential security issues in Apex classes.` : 'No security issues identified in scanned Apex classes.',
                              drillDownData: { findings: audit.findings }
                            };
                            setHealthChecks([pmdCheck]);
                          }
                          setShowHistory(false);
                        }}
                        className="p-2 hover:bg-slate-50 rounded-lg text-[#2E2E38]"
                      >
                        <i className="fas fa-chevron-right"></i>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="analysis"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-12"
          >
            {/* Main Content Area */}
            {selectedCategory === null ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {[
                  { 
                    id: 'static', 
                    title: 'Static Code Analysis', 
                    icon: 'fa-microchip', 
                    color: 'blue', 
                    desc: 'We use advanced AI to scan all your Apex classes against security rules to find coding errors. We check for things like SOQL injection and missing security checks. If we find issues, we will tell you exactly what to change to make your code safe.' 
                  },
                  { 
                    id: 'guest', 
                    title: 'Guest Authenticated Users Report', 
                    icon: 'fa-user-secret', 
                    color: 'red', 
                    desc: 'We check if your Guest users have too much power. We look at your sharing settings and profile permissions to make sure public users cannot see or change data they should not. We will show you if any private information is at risk.' 
                  },
                  { 
                    id: 'portal', 
                    title: 'Portal Users Report', 
                    icon: 'fa-users-rectangle', 
                    color: 'indigo', 
                    desc: 'We audit your Experience Cloud and Portal settings. We check if external users can see each other profiles or if anyone can register without approval. We make sure your community is a safe place for your customers.' 
                  }
                ].map((cat) => (
                  <motion.div
                    key={cat.id}
                    whileHover={{ y: -8, boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.15)" }}
                    onClick={() => {
                      setSelectedCategory(cat.id as any);
                      if (cat.id === 'static') {
                        const pmd = healthChecks.find(c => c.id === 'pmd-official');
                        if (pmd) setSelectedHealthCheck(pmd);
                      }
                    }}
                    className="bg-white p-10 rounded-[48px] border border-slate-200 shadow-sm hover:border-[#FFE600]/30 transition-all cursor-pointer group flex flex-col min-h-[480px]"
                  >
                    <div className={`w-20 h-20 rounded-[28px] bg-${cat.color}-50 text-${cat.color}-600 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform shadow-sm`}>
                      <i className={`fas ${cat.icon} text-3xl`}></i>
                    </div>
                    <h3 className="text-2xl font-bold text-slate-900 mb-4 group-hover:text-[#2E2E38] transition-colors leading-tight">{cat.title}</h3>
                    <p className="text-base text-slate-500 leading-relaxed mb-10 flex-grow">
                      {cat.desc}
                    </p>
                    <div className="flex items-center text-[#2E2E38] font-bold text-sm uppercase tracking-[0.2em] gap-3 pt-6 border-t border-slate-50">
                      Explore Analysis
                      <i className="fas fa-arrow-right transition-transform group-hover:translate-x-2"></i>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : selectedCategory === 'static' && !selectedHealthCheck ? (
              <div className="bg-white p-12 rounded-[40px] border border-slate-200 text-center space-y-6 shadow-sm">
                <div className="w-20 h-20 bg-[#FFE600]/10 text-[#2E2E38] rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <i className="fas fa-microchip text-3xl"></i>
                </div>
                <div className="max-w-md mx-auto">
                  <h3 className="text-2xl font-bold text-slate-900 tracking-tight">Static Code Analysis</h3>
                  <p className="text-slate-500 mt-2 leading-relaxed">
                    Run an AI-powered scan on your Apex classes to identify security vulnerabilities like SOQL Injection and CRUD/FLS violations.
                  </p>
                </div>
                <button 
                  onClick={runStaticAnalysis}
                  disabled={isStaticScanning}
                  className="px-8 py-4 bg-[#FFE600] text-[#2E2E38] font-bold rounded-2xl hover:bg-[#E5CF00] transition-all shadow-xl shadow-[#FFE600]/30 uppercase tracking-widest text-xs flex flex-col items-center gap-2 mx-auto disabled:opacity-50"
                >
                  <div className="flex items-center gap-2">
                    <i className={`fas ${isStaticScanning ? 'fa-spinner fa-spin' : 'fa-play'}`}></i>
                    {isStaticScanning ? 'Scanning Apex Code...' : 'Start AI Static Analysis'}
                  </div>
                  {isStaticScanning && scanProgress.total > 0 && (
                    <div className="w-full mt-2 space-y-1">
                      <div className="w-48 h-1 bg-blue-400/30 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-white transition-all duration-300" 
                          style={{ width: `${(scanProgress.current / scanProgress.total) * 100}%` }}
                        ></div>
                      </div>
                      <p className="text-[8px] opacity-80 lowercase">
                        {scanProgress.current} / {scanProgress.total} - {scanProgress.item}
                      </p>
                    </div>
                  )}
                </button>
              </div>
            ) : (
              <section className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                    <i className={`fas ${selectedCategory === 'static' ? 'fa-microchip text-[#2E2E38]' : selectedCategory === 'guest' ? 'fa-user-secret text-red-600' : 'fa-users-rectangle text-indigo-600'}`}></i>
                    {selectedCategory === 'static' ? 'Static Code Analysis' : selectedCategory === 'guest' ? 'Guest Authenticated Users Report' : 'Portal Users Report'}
                  </h2>
                  <div className="flex items-center gap-4">
                    {selectedHealthCheck && (
                      <button onClick={() => setSelectedHealthCheck(null)} className="text-xs text-[#2E2E38] font-bold hover:underline">
                        Back to {selectedCategory === 'static' ? 'Analysis' : 'All Checks'}
                      </button>
                    )}
                    <div className="flex items-center gap-3">
                      {selectedCategory === 'static' ? (
                        <button 
                          onClick={runStaticAnalysis} 
                          disabled={isStaticScanning} 
                          className="px-3 py-1.5 bg-[#FFE600]/10 text-[#2E2E38] text-[10px] font-bold rounded-lg hover:bg-blue-100 transition-all uppercase tracking-widest border border-[#FFE600]/30 flex flex-col items-center gap-1 disabled:opacity-50"
                        >
                          <div className="flex items-center gap-2">
                            <i className={`fas ${isStaticScanning ? 'fa-spinner fa-spin' : 'fa-rotate'}`}></i>
                            {isStaticScanning ? 'Scanning...' : 'Re-run AI Scan'}
                          </div>
                          {isStaticScanning && scanProgress.total > 0 && (
                            <div className="w-24 h-0.5 bg-blue-200 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-[#FFE600] transition-all duration-300" 
                                style={{ width: `${(scanProgress.current / scanProgress.total) * 100}%` }}
                              ></div>
                            </div>
                          )}
                        </button>
                      ) : (
                        <button 
                          onClick={runHealthChecks} 
                          disabled={isHealthChecking} 
                          className="px-3 py-1.5 bg-slate-50 text-slate-600 text-[10px] font-bold rounded-lg hover:bg-slate-100 transition-all uppercase tracking-widest border border-slate-200 flex items-center gap-2 disabled:opacity-50"
                        >
                          <i className={`fas fa-rotate ${isHealthChecking ? 'fa-spin' : ''}`}></i>
                          {isHealthChecking ? 'Scanning...' : 'Refresh Config'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {selectedHealthCheck ? (
                  <motion.div
                    key="health-check-detail"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="space-y-6"
                  >
                    {/* ... (Existing drill-down content remains same) ... */}
                    <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm">
                      <div className="flex items-start justify-between mb-6">
                        <div className="flex items-center gap-4">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${selectedHealthCheck.isRisky ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                            <i className={`fas ${selectedHealthCheck.isRisky ? 'fa-triangle-exclamation' : 'fa-circle-check'} text-xl`}></i>
                          </div>
                          <div>
                            <h2 className="text-2xl font-bold text-slate-900">{selectedHealthCheck.title}</h2>
                            <p className="text-slate-500 flex items-center gap-1">
                              <i className="fas fa-map-marker-alt text-xs"></i>
                              {selectedHealthCheck.setupPath}
                            </p>
                          </div>
                        </div>
                        <div className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-widest border ${selectedHealthCheck.isRisky ? 'bg-red-50 text-red-600 border-red-100' : 'bg-green-50 text-green-600 border-green-100'}`}>
                          {selectedHealthCheck.status}
                        </div>
                      </div>

                      <div className={(selectedHealthCheck.id === 'pmd-official' || selectedHealthCheck.id === 'object-field-security') ? 'space-y-6' : 'grid grid-cols-1 md:grid-cols-2 gap-8'}>
                        {selectedHealthCheck.id !== 'pmd-official' && selectedHealthCheck.id !== 'object-field-security' && (
                          <div className="space-y-4">
                            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Description</p>
                              <p className="text-sm text-slate-600 leading-relaxed">
                                {selectedHealthCheck.description}
                              </p>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Current State Summary</p>
                              <p className="text-sm text-slate-600 italic leading-relaxed">
                                {selectedHealthCheck.details || 'No specific details available.'}
                              </p>
                            </div>
                          </div>
                        )}

                        {selectedHealthCheck.id === 'object-field-security' && (
                          <div className="space-y-6">
                            <div className="p-8 bg-slate-50 rounded-[32px] border border-slate-100">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Current State Summary</p>
                              <p className="text-lg text-slate-700 font-medium leading-relaxed mb-6">
                                {selectedHealthCheck.details}
                              </p>
                              <button 
                                onClick={() => setShowDetailedModal(true)}
                                className="px-6 py-3 bg-[#FFE600] text-[#2E2E38] rounded-2xl font-bold text-sm hover:bg-[#E5CF00] transition-all shadow-lg shadow-blue-200 flex items-center gap-2"
                              >
                                <i className="fas fa-magnifying-glass-chart"></i>
                                View Detailed Findings
                              </button>
                            </div>
                          </div>
                        )}

                        <div className={(selectedHealthCheck.id === 'pmd-official' || selectedHealthCheck.id === 'object-field-security') ? 'w-full' : 'space-y-4'}>
                          {selectedHealthCheck.id !== 'object-field-security' && (
                            <div className="space-y-4">
                              <p className="text-sm font-bold text-slate-900 mb-4">{selectedHealthCheck.id === 'pmd-official' ? 'Security Audit Findings' : 'Detailed Findings'}</p>
                              <div className="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden">
                                {selectedHealthCheck.id === 'disable-public-apis' && selectedHealthCheck.drillDownData?.profiles && (
                              <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
                                {(() => {
                                  const filtered = selectedHealthCheck.drillDownData.profiles.filter((p: any) => {
                                    if (selectedCategory === 'guest') return p.type === 'Guest';
                                    if (selectedCategory === 'portal') return p.type === 'Portal';
                                    return true;
                                  });
                                  
                                  if (filtered.length === 0) {
                                    return (
                                      <div className="p-8 text-center text-slate-400 text-sm italic">
                                        No {selectedCategory} profiles identified with API access findings.
                                      </div>
                                    );
                                  }
                                  
                                  return filtered.map((p: any, i: number) => (
                                    <div key={`${p.id}-${i}`} className="p-4 flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-bold text-slate-900">{p.label || p.name}</p>
                                        <p className="text-[10px] text-slate-400">{p.type} Profile</p>
                                      </div>
                                      <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${p.apiEnabled ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                        API {p.apiEnabled ? 'Enabled' : 'Disabled'}
                                      </div>
                                    </div>
                                  ));
                                })()}
                              </div>
                            )}

                            {selectedHealthCheck.id === 'restrict-visibility' && (
                              <div className="divide-y divide-slate-100">
                                {(selectedHealthCheck.drillDownData?.settings || []).length > 0 ? (
                                  selectedHealthCheck.drillDownData.settings.map((s: any, i: number) => (
                                    <div key={i} className="p-4 flex items-center justify-between">
                                      <p className="text-sm font-bold text-slate-900">{s.name}</p>
                                      <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${s.isRisky ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                        {s.value ? 'On' : 'Off'}
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="p-8 text-center text-slate-400 text-sm italic">
                                    No visibility settings found in metadata.
                                  </div>
                                )}
                              </div>
                            )}

                            {selectedHealthCheck.id === 'self-registration' && (
                              <div className="divide-y divide-slate-100">
                                {(selectedHealthCheck.drillDownData?.sites || []).length > 0 ? (
                                  selectedHealthCheck.drillDownData.sites.map((s: any, i: number) => (
                                    <div key={i} className="p-4">
                                      <div className="flex items-center justify-between mb-2">
                                        <div>
                                          <p className="text-sm font-bold text-slate-900">{s.name}</p>
                                          <div className="flex gap-2 mt-1">
                                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 text-[9px] font-bold rounded uppercase tracking-widest">{s.siteType}</span>
                                            <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded uppercase tracking-widest ${s.status === 'Active' ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-500'}`}>{s.status}</span>
                                          </div>
                                        </div>
                                        <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${s.selfRegEnabled ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                          Self-Reg {s.selfRegEnabled ? 'Enabled' : 'Disabled'}
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-2 gap-4 mt-3">
                                        <div className="p-2 bg-white rounded-xl border border-slate-100">
                                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Guest Profile</p>
                                          <p className="text-xs text-slate-600 font-medium truncate">{s.guestProfile}</p>
                                        </div>
                                        {s.url && (
                                          <div className="p-2 bg-white rounded-xl border border-slate-100">
                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Site URL</p>
                                            <a href={s.url} target="_blank" rel="noreferrer" className="text-xs text-[#2E2E38] font-medium truncate block hover:underline">
                                              {s.url.replace('https://', '')}
                                            </a>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="p-8 text-center text-slate-400 text-sm italic">
                                    No portals or experience sites found.
                                  </div>
                                )}
                              </div>
                            )}

                            {(selectedHealthCheck.id === 'epim' || selectedHealthCheck.id === 'profile-filtering') && (
                              <div className="p-6 text-center">
                                <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 ${selectedHealthCheck.isRisky ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                  <i className={`fas ${selectedHealthCheck.isRisky ? 'fa-xmark' : 'fa-check'} text-xl`}></i>
                                </div>
                                <p className="text-sm font-bold text-slate-900">{selectedHealthCheck.drillDownData?.setting}</p>
                                <p className="text-xs text-slate-500 mt-1">This setting is currently {selectedHealthCheck.drillDownData?.value ? 'Enabled' : 'Disabled'}.</p>
                                
                                {selectedHealthCheck.id === 'epim' && selectedHealthCheck.drillDownData?.epimFields && selectedHealthCheck.drillDownData.epimFields.length > 0 && (
                                  <div className="mt-6 text-left">
                                    <h4 className="text-sm font-semibold text-slate-800 mb-3 border-b border-slate-100 pb-2">Masked Fields (personalInfo_EPIM)</h4>
                                    <div className="grid grid-cols-2 gap-2">
                                      {selectedHealthCheck.drillDownData.epimFields.map((field: any, idx: number) => (
                                        <div key={idx} className="bg-slate-50 rounded px-3 py-2 text-xs text-slate-600 flex items-center border border-slate-100">
                                          <i className="fas fa-shield-halved text-slate-400 mr-2"></i>
                                          {typeof field === 'string' ? field : field.field}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {selectedHealthCheck.id === 'show-nicknames' && (
                              <div className="divide-y divide-slate-100">
                                {(selectedHealthCheck.drillDownData?.sites || []).length > 0 ? (
                                  selectedHealthCheck.drillDownData.sites.map((s: any, i: number) => (
                                    <div key={i} className="p-4 flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-bold text-slate-900">{s.name}</p>
                                        {s.url && (
                                          <a href={s.url} target="_blank" rel="noreferrer" className="text-[10px] text-[#2E2E38] hover:underline block mt-0.5">
                                            {s.url.replace('https://', '')}
                                          </a>
                                        )}
                                      </div>
                                      <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${!s.showNicknames ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                        {s.showNicknames ? 'Nicknames On' : 'Real Names'}
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="p-8 text-center text-slate-400 text-sm italic">
                                    No experience sites found with nickname settings.
                                  </div>
                                )}
                              </div>
                            )}

                            {selectedHealthCheck.id === 'pmd-official' && (
                              <div className="space-y-6">
                                {(() => {
                                  const allFindings = selectedHealthCheck.drillDownData?.findings || [];
                                  const uniqueRules = Array.from(new Set(allFindings.map((f: any) => f.ruleName))).sort();
                                  
                                  return uniqueRules.length > 0 && (
                                    <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
                                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Filter by Security Rules</p>
                                      <div className="flex flex-wrap gap-2">
                                        {uniqueRules.map((rule: any) => (
                                          <button
                                            key={rule}
                                            onClick={() => {
                                              setSelectedRules(prev => 
                                                prev.includes(rule) 
                                                  ? prev.filter(r => r !== rule) 
                                                  : [...prev, rule]
                                              );
                                            }}
                                            className={`px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all border ${
                                              selectedRules.includes(rule)
                                                ? 'bg-[#FFE600] text-[#2E2E38] border-[#FFE600] shadow-md shadow-[#FFE600]/30'
                                                : 'bg-white text-slate-600 border-slate-200 hover:border-[#FFE600]/30'
                                            }`}
                                          >
                                            {rule}
                                          </button>
                                        ))}
                                        {selectedRules.length > 0 && (
                                          <button
                                            onClick={() => setSelectedRules([])}
                                            className="px-3 py-1.5 rounded-xl text-[10px] font-bold text-red-600 hover:bg-red-50 transition-all"
                                          >
                                            Clear All
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()}

                                <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                                  {(selectedHealthCheck.drillDownData?.findings || []).length > 0 ? (
                                    (() => {
                                      let findings = selectedHealthCheck.drillDownData.findings;
                                      
                                      // Apply rule filter
                                      if (selectedRules.length > 0) {
                                        findings = findings.filter((f: any) => selectedRules.includes(f.ruleName));
                                      }

                                      if (findings.length === 0) {
                                        return <div className="p-12 text-center text-slate-400 text-sm italic">No findings match the selected rule filters.</div>;
                                      }

                                      const classGroups: Record<string, any[]> = {};
                                      findings.forEach((f: any) => {
                                        const className = f.componentName || 'Unknown Class';
                                        if (!classGroups[className]) classGroups[className] = [];
                                        classGroups[className].push(f);
                                      });

                                      return Object.entries(classGroups).map(([className, classFindings], classIdx) => {
                                        // Sort findings by severity: Critical > High > Medium > Low
                                        const severityOrder: Record<string, number> = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
                                        const sortedFindings = [...classFindings].sort((a, b) => {
                                          const orderA = severityOrder[a.severity] ?? 99;
                                          const orderB = severityOrder[b.severity] ?? 99;
                                          return orderA - orderB;
                                        });

                                        return (
                                          <div key={classIdx} className="p-4 bg-slate-50/50">
                                            <div className="flex items-center justify-between mb-4">
                                              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                                <i className="fas fa-file-code text-[#2E2E38]"></i>
                                                {className}
                                              </h3>
                                              <span className="px-2 py-0.5 bg-red-100 text-red-600 text-[10px] font-bold rounded-full border border-red-200">
                                                {classFindings.length} {classFindings.length === 1 ? 'Violation' : 'Violations'}
                                              </span>
                                            </div>
                                            <div className="space-y-3">
                                              {sortedFindings.map((finding: any, idx: number) => {
                                                // Dynamically resolve URLs from constants if not present in finding (for legacy data)
                                                const ruleInfo = Object.values(PMD_RULES).find(r => r.name === finding.ruleName);
                                                const sfUrl = finding.sfUrl || ruleInfo?.sfUrl;
                                                const pmdUrl = finding.pmdUrl || ruleInfo?.pmdUrl;

                                                return (
                                                  <div key={idx} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
                                                <div className="flex items-start justify-between gap-4">
                                                  <div className="flex items-start gap-3">
                                                    <div className={`mt-0.5 px-2 py-1 rounded-lg text-[9px] font-bold border uppercase tracking-wider ${getSeverityColor(finding.severity)}`}>
                                                      {finding.severity}
                                                    </div>
                                                    <div>
                                                      <p className="text-sm font-bold text-slate-900">{finding.ruleName}</p>
                                                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">{finding.issue}</p>
                                                    </div>
                                                  </div>
                                                  <div className="flex gap-3">
                                                    {sfUrl && (
                                                      <a href={sfUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-2 py-1 bg-[#FFE600]/10 text-[#2E2E38] rounded-lg text-[10px] font-bold hover:bg-blue-100 transition-all border border-[#FFE600]/30" title="Salesforce Security Guide">
                                                        <i className="fab fa-salesforce"></i>
                                                        SF Ref
                                                      </a>
                                                    )}
                                                    {pmdUrl && (
                                                      <a href={pmdUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 text-slate-500 rounded-lg text-[10px] font-bold hover:bg-slate-100 transition-all border border-slate-200" title="PMD Documentation">
                                                        <i className="fas fa-external-link-alt"></i>
                                                        PMD Ref
                                                      </a>
                                                    )}
                                                  </div>
                                                </div>
                                              
                                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
                                                <div className="space-y-2">
                                                  <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest flex items-center gap-1.5">
                                                    <i className="fas fa-bug"></i>
                                                    Problematic Code
                                                  </p>
                                                  <div className="p-4 bg-red-50/50 rounded-2xl border border-red-100 font-mono text-[11px] text-red-700 overflow-x-auto whitespace-pre leading-relaxed">
                                                    {finding.snippet || '// Snippet not available'}
                                                  </div>
                                                </div>
                                                <div className="space-y-2">
                                                  <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest flex items-center gap-1.5">
                                                    <i className="fas fa-wand-magic-sparkles"></i>
                                                    Recommended Fix
                                                  </p>
                                                  <div className="relative group">
                                                    <div className="p-4 bg-green-50/50 rounded-2xl border border-green-100 font-mono text-[11px] text-green-700 overflow-x-auto whitespace-pre leading-relaxed">
                                                      {finding.recommendation}
                                                    </div>
                                                    <button 
                                                      onClick={() => {
                                                        navigator.clipboard.writeText(finding.recommendation);
                                                        toast({ title: 'Copied', message: 'Code fix copied to clipboard', type: 'success' });
                                                      }}
                                                      className="absolute top-3 right-3 p-2 bg-white rounded-lg border border-green-100 text-green-600 opacity-0 group-hover:opacity-100 transition-all shadow-sm hover:bg-green-50"
                                                      title="Copy Fix"
                                                    >
                                                      <i className="fas fa-copy"></i>
                                                    </button>
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                        </div>
                                      </div>
                                    );
                                  });
                                })()
                                ) : isHealthChecking || isStaticScanning ? (
                                  <div className="p-20 text-center">
                                    <div className="w-10 h-10 border-3 border-[#FFE600] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                                    <p className="text-sm text-slate-500 font-medium tracking-tight">Analyzing security findings...</p>
                                  </div>
                                ) : (
                                  <div className="p-12 text-center">
                                    <div className="w-12 h-12 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-3">
                                      <i className="fas fa-check text-xl"></i>
                                    </div>
                                    <p className="text-sm font-bold text-slate-900">No Issues Found</p>
                                    <p className="text-xs text-slate-500 mt-1">Your Apex code follows PMD security best practices.</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
                  <div className="space-y-8">
                    {/* Profile List Section */}
                    {(selectedCategory === 'guest' || selectedCategory === 'portal') && (
                      <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3 mb-6">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${selectedCategory === 'guest' ? 'bg-red-50 text-red-600' : 'bg-indigo-50 text-indigo-600'}`}>
                            <i className={`fas ${selectedCategory === 'guest' ? 'fa-user-secret' : 'fa-users-rectangle'} text-xl`}></i>
                          </div>
                          <div>
                            <h3 className="text-lg font-bold text-slate-900">
                              Available {selectedCategory === 'guest' ? 'Guest' : 'Portal'} Profiles
                            </h3>
                            <p className="text-xs text-slate-500">
                              Profiles identified based on user license and naming conventions.
                            </p>
                          </div>
                          {(selectedCategory === 'guest' || selectedCategory === 'portal') && (
                            <button 
                              onClick={syncProfiles}
                              disabled={isHealthChecking}
                              className="ml-auto px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[10px] font-bold text-slate-600 hover:text-[#2E2E38] hover:border-[#FFE600]/30 transition-all flex items-center gap-2"
                            >
                              <i className={`fas fa-sync-alt ${isHealthChecking ? 'fa-spin' : ''}`}></i>
                              Sync Profiles
                            </button>
                          )}
                        </div>
                        
                        {(() => {
                          const profiles = selectedCategory === 'guest' ? guestProfiles : portalProfiles;
                          if (profiles.length === 0) {
                            return (
                              <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-100">
                                <i className="fas fa-users-slash text-2xl text-slate-300 mb-3"></i>
                                <p className="text-sm text-slate-500 font-medium">No {selectedCategory} profiles found in this org.</p>
                              </div>
                            );
                          }
                          return (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {profiles.map((p, i) => {
                                const context = guestUserContexts.find(c => c.profileId === p.id || c.profileName === p.name);
                                return (
                                  <div 
                                    key={`${p.id}-${i}`} 
                                    className="p-5 bg-slate-50 rounded-[32px] border border-slate-100 flex flex-col hover:border-[#FFE600]/30 transition-colors group cursor-pointer"
                                    onClick={() => {
                                      setSelectedProfileName(p.name);
                                      if (context) setSelectedGuestUserId(context.userId);
                                      setShowDetailedModal(true);
                                    }}
                                  >
                                    <div className="flex items-start justify-between mb-2">
                                      <p className="text-sm font-bold text-slate-900 group-hover:text-[#2E2E38] transition-colors line-clamp-1" title={p.label || p.name}>{p.label || p.name}</p>
                                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedCategory === 'guest' ? 'bg-red-100 text-red-600' : 'bg-indigo-100 text-indigo-600'}`}>
                                        <i className={`fas ${selectedCategory === 'guest' ? 'fa-user-secret' : 'fa-users-rectangle'} text-xs`}></i>
                                      </div>
                                    </div>
                                    <p className="text-[10px] text-slate-500 font-mono mb-4 truncate" title={p.name}>{p.name}</p>
                                    
                                    {context && (
                                      <div className="mb-4">
                                        <div className="flex items-center gap-1.5 mb-2 bg-white/60 px-2 py-1 rounded-lg border border-slate-100">
                                          <i className="fas fa-globe text-[10px] text-[#2E2E38]"></i>
                                          <p className="text-[10px] font-bold text-slate-600 truncate">Site: {context.siteName}</p>
                                        </div>
                                      </div>
                                    )}

                                    <div className="mt-auto pt-3 border-t border-slate-200/60 flex items-center justify-between">
                                      <div className="flex flex-col">
                                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                                          User License
                                        </span>
                                        <span className="text-[10px] font-bold text-slate-600 truncate mt-0.5" title={p.UserLicense?.Name || p.UserLicense?.name || 'Unknown'}>
                                          {p.UserLicense?.Name || p.UserLicense?.name || 'Unknown'}
                                        </span>
                                      </div>
                                      <div className="w-8 h-8 rounded-full bg-white border border-slate-100 flex items-center justify-center text-slate-300 group-hover:text-[#2E2E38] group-hover:border-[#FFE600]/30 transition-all">
                                        <i className="fas fa-chevron-right text-xs"></i>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {healthChecks.filter(c => {
                        if (selectedCategory === 'static') return c.id === 'pmd-official';
                        return c.id !== 'pmd-official' && c.id !== 'apex-access';
                      }).map((check, idx) => (
                      <motion.div
                        key={check.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: idx * 0.05 }}
                        className="bg-white p-5 rounded-[32px] border border-slate-200 shadow-sm flex flex-col h-full hover:shadow-md transition-all cursor-pointer group hover:border-[#FFE600]/30"
                        onClick={() => setSelectedHealthCheck(check)}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className={`px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest border ${check.isRisky ? 'bg-red-50 text-red-600 border-red-100' : 'bg-green-50 text-green-600 border-green-100'}`}>
                            {check.status}
                          </div>
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${check.isRisky ? 'text-red-600' : 'text-green-600'}`}>
                            <i className={`fas ${check.isRisky ? 'fa-triangle-exclamation' : 'fa-circle-check'}`}></i>
                          </div>
                        </div>
                        
                        <h3 className="text-sm font-bold text-slate-900 mb-1 leading-tight group-hover:text-[#2E2E38] transition-colors">{check.title}</h3>
                        <p className="text-[10px] text-slate-400 font-medium mb-3 flex items-center gap-1">
                          <i className="fas fa-map-marker-alt text-[8px]"></i>
                          {check.setupPath}
                        </p>
                        
                        <p className="text-[11px] text-slate-600 leading-relaxed mb-4 flex-grow">
                          {check.description}
                        </p>

                        <div className="pt-3 border-t border-slate-50 flex items-center justify-between">
                          <div className="flex-grow">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Current State</p>
                            <p className="text-[11px] text-slate-500 italic leading-tight line-clamp-1">
                              {check.details || 'No specific details available.'}
                            </p>
                          </div>
                          <i className="fas fa-chevron-right text-slate-300 group-hover:text-[#FFE600] transition-colors ml-2"></i>
                        </div>
                      </motion.div>
                    ))}
                    </div>
                  </div>
                )}
              </section>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDetailedModal && selectedHealthCheck && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#2E2E38]/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-[40px] shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden border border-slate-200"
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-[#FFE600] flex items-center justify-center text-white shadow-lg shadow-blue-200">
                    <i className="fas fa-magnifying-glass-chart text-xl"></i>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Object and Field Level Security Analysis</h2>
                    <p className="text-xs text-slate-500">Comprehensive audit of object permissions, field-level security, and sharing settings.</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowDetailedModal(false)}
                  className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:border-slate-300 transition-all shadow-sm"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>

              {/* Filters & Profile Selector */}
              {(() => {
                const modalActiveProfile = selectedProfileName || (selectedCategory === 'guest' ? guestProfiles[0]?.name : portalProfiles[0]?.name);
                const modalActiveUserId = selectedGuestUserId || (selectedCategory === 'guest' ? guestUserContexts.find(c => c.profileName === modalActiveProfile || c.profileId === guestProfiles.find(p => p.name === modalActiveProfile)?.id)?.userId : null);

                return (
                  <div className="p-4 border-b border-slate-100 bg-white flex flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mr-2">Filter Objects:</p>
                        <div className="flex bg-slate-100 p-1 rounded-xl">
                          {[
                            { id: 'all', label: 'All Objects', icon: 'fa-list' },
                            { id: 'risky', label: 'Issues Only', icon: 'fa-triangle-exclamation' },
                            { id: 'secure', label: 'Secure Only', icon: 'fa-circle-check' }
                          ].map(f => (
                            <button
                              key={f.id}
                              onClick={() => setObjectFilter(f.id as any)}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-2 ${objectFilter === f.id ? 'bg-white text-[#2E2E38] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                              <i className={`fas ${f.icon}`}></i>
                              {f.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Selected Profile:</p>
                          <div className="flex items-center gap-2">
                            <select 
                              value={modalActiveProfile || ''} 
                              onChange={(e) => {
                                const newName = e.target.value;
                                setSelectedProfileName(newName);
                                const ctx = guestUserContexts.find(c => c.profileName === newName || c.profileId === (selectedCategory === 'guest' ? guestProfiles : portalProfiles).find(p => p.name === newName)?.id);
                                if (ctx) setSelectedGuestUserId(ctx.userId);
                              }}
                              className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all min-w-[250px]"
                            >
                              {(() => {
                                const profiles = selectedCategory === 'guest' ? guestProfiles : portalProfiles;
                                if (profiles.length === 0) return <option value="">No profiles found</option>;
                                return profiles.map(p => (
                                  <option key={p.id} value={p.name}>{p.label || p.name}</option>
                                ));
                              })()}
                            </select>
                            <button
                              onClick={refreshProfileMetadata}
                              disabled={isRefreshingProfile || !modalActiveProfile}
                              className="p-2 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-[#2E2E38] hover:border-[#FFE600]/30 transition-all shadow-sm disabled:opacity-50"
                              title="Refresh Profile Metadata"
                            >
                              <i className={`fas fa-sync-alt ${isRefreshingProfile ? 'fa-spin' : ''}`}></i>
                            </button>
                          </div>
                      </div>
                    </div>

                    {/* Permission Set Selection inside Modal */}
                    {selectedCategory === 'guest' && modalActiveUserId && (
                      <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-3 mb-2">
                          <i className="fas fa-shield-halved text-[#2E2E38] text-xs"></i>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex-1">Simulate Permission Sets for Guest User</p>
                          
                          {(() => {
                            const context = guestUserContexts.find(c => c.userId === modalActiveUserId);
                            return context && context.selectedPermSetIds.length > 0 ? (
                              <button
                                onClick={() => clearAllPermSets(context.userId)}
                                className="text-[9px] font-bold text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1 rounded-lg transition-colors border border-red-100 mr-2 uppercase tracking-widest"
                              >
                                Clear All
                              </button>
                            ) : null;
                          })()}
                          
                          {isFetchingPermSets && <i className="fas fa-circle-notch fa-spin text-xs text-[#2E2E38] ml-auto"></i>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(() => {
                            const context = guestUserContexts.find(c => c.userId === modalActiveUserId);
                            if (!context || !context.assignedPermSets || context.assignedPermSets.length === 0) {
                              return <p className="text-[10px] text-slate-400 italic">No permission sets assigned to this guest user.</p>;
                            }
                            return context.assignedPermSets.map(ps => (
                              <button
                                key={ps.Id}
                                onClick={() => togglePermSet(context.userId, ps.Id)}
                                className={`px-3 py-1.5 rounded-xl text-[10px] font-bold border transition-all flex items-center gap-2 ${
                                  context.selectedPermSetIds.includes(ps.Id)
                                    ? 'bg-[#FFE600] text-[#2E2E38] border-[#FFE600] shadow-md shadow-blue-200'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-[#FFE600]/30'
                                }`}
                              >
                                <i className={`fas ${context.selectedPermSetIds.includes(ps.Id) ? 'fa-check-circle' : 'fa-circle-plus opacity-40'}`}></i>
                                {ps.Label || ps.Name}
                              </button>
                            ));
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Main Content: Split Pane */}
              <div className="flex-1 flex overflow-hidden relative">
                {isModalLoading && (
                  <div className="absolute inset-0 z-50 bg-white/80 backdrop-blur-[2px] flex flex-col items-center justify-center">
                    <div className="w-12 h-12 border-4 border-[#FFE600] border-t-transparent rounded-full animate-spin mb-4"></div>
                    <p className="text-sm font-bold text-slate-600 animate-pulse">Retrieving Security Data...</p>
                    <p className="text-[10px] text-slate-400 mt-1">Fetching latest permissions and sharing settings</p>
                  </div>
                )}
                
                {/* Left: Object List */}
                <div className="w-1/3 lg:w-1/4 border-r border-slate-100 flex flex-col bg-white">
                  <div className="p-4 border-b border-slate-50 bg-slate-50/30">
                    <div className="relative">
                      <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]"></i>
                      <input 
                        type="text" 
                        placeholder="Search objects..."
                        value={objectSearch}
                        onChange={(e) => setObjectSearch(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-4 py-2 text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {(() => {
                      const sourceObjects = dbObjects.length > 0 ? dbObjects : (selectedHealthCheck?.drillDownData?.objects || []);
                      const modalActiveProfile = selectedProfileName || (selectedCategory === 'guest' ? guestProfiles[0]?.name : portalProfiles[0]?.name);
                      const modalActiveUserId = selectedGuestUserId || (guestUserContexts.find(c => c.profileName === modalActiveProfile || c.profileId === (selectedCategory === 'guest' ? guestProfiles : portalProfiles).find(p => p.name === modalActiveProfile)?.id)?.userId || null);
                      
                      const allFiltered = sourceObjects
                        .filter((obj: any) => {
                          const label = (obj.label || '').toLowerCase();
                          const name = (obj.name || '').toLowerCase();
                          return !label.includes('missing label') && !name.includes('missing label');
                        })
                        .filter((obj: any) => {
                          const search = objectSearch.toLowerCase();
                          return obj.label?.toLowerCase().includes(search) || obj.name?.toLowerCase().includes(search);
                        })
                        .filter((obj: any) => {
                          if (objectFilter === 'risky') return obj.isRisky;
                          if (objectFilter === 'secure') return !obj.isRisky;
                          return true;
                        });

                      const context = guestUserContexts.find(c => c.userId === modalActiveUserId) || null;
                      const selectedPermSets = context ? context.selectedPermSetIds.map(id => permSetMetadataCache[id]).filter(Boolean) : [];

                      const directObjects: any[] = [];
                      const flaggedObjects: any[] = [];

                      allFiltered.forEach((obj: any) => {
                        const permsArray = Array.isArray(obj.permissions) ? obj.permissions : (obj.permissions ? [obj.permissions] : []);
                        const profilePerms = permsArray.find((p: any) => p.profile === modalActiveProfile) || { read: false, create: false, edit: false, delete: false };
                        
                        const eff = SecurityScannerService.calculateEffectiveAccess(
                          modalActiveProfile, modalActiveProfile,
                          [{ ...profilePerms, object: obj.name }],
                          [], // Ignored for object-level calculation
                          selectedPermSets
                        );
                        
                        const objAccess = eff?.objects?.[obj.name];
                        const hasDirectAccess = objAccess && (objAccess.read || objAccess.create || objAccess.edit || objAccess.delete);

                        if (hasDirectAccess) {
                          directObjects.push(obj);
                        } else if (obj.isRiskyOWD) {
                          flaggedObjects.push(obj);
                        }
                      });

                      if (directObjects.length === 0 && flaggedObjects.length === 0) {
                        return (
                          <div className="p-12 text-center">
                            <div className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-300">
                              <i className="fas fa-box-open text-sm"></i>
                            </div>
                            <p className="text-[11px] text-slate-400 font-medium italic">No objects found</p>
                          </div>
                        );
                      }

                      const renderObjectItem = (obj: any, isFlagged: boolean = false) => (
                        <button
                          key={`${obj.name}-${isFlagged ? 'flagged' : 'direct'}`}
                          onClick={() => {
                            setSelectedObjectId(obj.name);
                          }}
                          className={`w-full text-left p-4 transition-all border-b border-slate-50 group relative ${selectedObjectId === obj.name ? (isFlagged ? 'bg-amber-50/40 shadow-[inset_0_0_15px_rgba(245,158,11,0.1)]' : 'bg-[#FFE600]/10/40') : 'hover:bg-slate-50/80'} ${isFlagged ? 'opacity-85' : ''}`}
                        >
                          {selectedObjectId === obj.name && (
                            <motion.div 
                              layoutId="active-object-indicator"
                              className={`absolute left-0 top-0 bottom-0 w-1 ${isFlagged ? 'bg-amber-500' : 'bg-[#FFE600]'}`}
                            />
                          )}
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className={`text-[11px] font-bold truncate leading-tight mb-0.5 ${selectedObjectId === obj.name ? (isFlagged ? 'text-amber-700' : 'text-blue-700') : 'text-slate-700'}`}>
                                {obj.label}
                                {isFlagged && <span className="ml-2 text-[8px] text-amber-500 font-black uppercase tracking-tighter bg-amber-50 px-1 rounded">Flagged</span>}
                              </p>
                              <p className="text-[9px] text-slate-400 truncate font-mono tracking-tight">{obj.name}</p>
                            </div>
                            <div className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${obj.isRisky ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]' : 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.3)]'}`}></div>
                          </div>
                          {isFlagged && selectedObjectId === obj.name && (
                            <div className="mt-2 p-2 bg-amber-50 rounded-lg border border-amber-100">
                              <p className="text-[8px] text-amber-700 font-bold leading-tight">
                                <i className="fas fa-triangle-exclamation mr-1"></i>
                                {obj.externalModel?.startsWith('ControlledBy') 
                                  ? `Inherited Risk: This object is controlled by its parent, which has a Public External OWD.`
                                  : `Public External OWD detected with no direct profile access.`}
                              </p>
                            </div>
                          )}
                        </button>
                      );

                      return (
                        <div className="pb-10">
                          {directObjects.length > 0 && (
                            <>
                              <div className="px-4 py-2 bg-slate-50/50 border-b border-slate-100">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Directly Accessed</p>
                              </div>
                              {directObjects.map(obj => renderObjectItem(obj, false))}
                            </>
                          )}
                          
                          {flaggedObjects.length > 0 && (
                            <>
                              <div className="px-4 py-2 bg-amber-50/50 border-b border-amber-100 mt-4">
                                <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">Flagged (Public OWD)</p>
                              </div>
                              {flaggedObjects.map(obj => renderObjectItem(obj, true))}
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Right: Details */}
                <div className="flex-1 overflow-y-auto bg-slate-50/30 p-6 lg:p-10 custom-scrollbar relative">
                  {(() => {
                    const sourceObjects = dbObjects.length > 0 ? dbObjects : (selectedHealthCheck.drillDownData?.objects || []);
                    const modalActiveProfile = selectedProfileName || (selectedCategory === 'guest' ? guestProfiles[0]?.name : portalProfiles[0]?.name);
                    const modalActiveUserId = selectedGuestUserId || (guestUserContexts.find(c => c.profileName === modalActiveProfile || c.profileId === (selectedCategory === 'guest' ? guestProfiles : portalProfiles).find(p => p.name === modalActiveProfile)?.id)?.userId || null);
                    
                    // Find the ApexAccess object for the profile-wide data
                    const apexAccessObj = sourceObjects.find((o: any) => o.type === 'ApexAccess');
                    
                    const objects = sourceObjects
                      .filter((obj: any) => {
                        const label = (obj.label || '').toLowerCase();
                        const name = (obj.name || '').toLowerCase();
                        return !label.includes('missing label') && !name.includes('missing label') && obj.type !== 'ApexAccess';
                      });
                    
                    const contextInner = guestUserContexts.find(c => c.userId === modalActiveUserId) || null;
                    const selectedPermSetsInner = contextInner ? contextInner.selectedPermSetIds.map(id => permSetMetadataCache[id]).filter(Boolean) : [];

                    const displayableObjects = objects.filter((obj: any) => {
                      if (objectFilter === 'risky' && !obj.isRisky) return false;
                      if (objectFilter === 'secure' && obj.isRisky) return false;
                      
                      const permsArray = Array.isArray(obj.permissions) ? obj.permissions : (obj.permissions ? [obj.permissions] : []);
                      const profilePerms = permsArray.find((p: any) => p.profile === modalActiveProfile) || { read: false, create: false, edit: false, delete: false };
                      
                      const eff = SecurityScannerService.calculateEffectiveAccess(
                        modalActiveProfile, modalActiveProfile,
                        [{ ...profilePerms, object: obj.name }],
                        [], 
                        selectedPermSetsInner
                      );
                      
                      const objAccess = eff?.objects?.[obj.name];
                      const hasDirectAccess = objAccess && (objAccess.read || objAccess.create || objAccess.edit || objAccess.delete);
                      return hasDirectAccess || obj.isRiskyOWD;
                    });
                    
                    const selectedObj = displayableObjects.find((o: any) => o.name === selectedObjectId) || displayableObjects[0];
                    
                    if (!selectedObj) return (
                      <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <i className="fas fa-mouse-pointer text-2xl mb-4 opacity-20"></i>
                        <p className="text-sm font-medium italic">Select an object from the list to view security details</p>
                      </div>
                    );

                    // Consolidate Fields for Top Tiles & Tab rendering
                    const uniqueFieldMapTop = new Map();
                    (selectedObj.fields || []).forEach((f: any) => {
                      if (!uniqueFieldMapTop.has(f.name)) {
                          uniqueFieldMapTop.set(f.name, { ...f });
                      }
                    });

                    if (effectiveRights?.fields) {
                      Object.keys(effectiveRights.fields).forEach(key => {
                        const fieldName = key.includes('.') ? key.split('.')[1] : key;
                        if (key.startsWith(`${selectedObj.name}.`) && !uniqueFieldMapTop.has(fieldName)) {
                          uniqueFieldMapTop.set(fieldName, { name: fieldName, label: fieldName, isSensitive: false });
                        }
                      });
                    }

                    const allFields = Array.from(uniqueFieldMapTop.values());
                    let exposedFieldsCount = 0;
                    let sensitiveRisksCount = 0;

                    allFields.forEach(f => {
                      const effField = effectiveRights?.fields[`${selectedObj.name}.${f.name}`] || effectiveRights?.fields[f.name] || { read: false, edit: false, sources: [] };
                      if (effField.read || effField.edit) {
                        exposedFieldsCount++;
                        if (f.isSensitive) {
                          sensitiveRisksCount++;
                        }
                      }
                    });

                    // Tabs for the details pane
                    const tabs = [
                      { id: 'object', label: 'Object Access', icon: 'fa-lock' },
                      { id: 'field', label: 'Field Access', icon: 'fa-table-list' },
                      { id: 'sharing', label: 'Sharing Rules', icon: 'fa-share-nodes' }
                    ];

                    return (
                      <div className="space-y-8 max-w-5xl mx-auto pb-20">
                        {/* Tab Navigation */}
                        <div className="flex bg-white p-1.5 rounded-2xl border border-slate-100 shadow-sm mb-8 z-10">
                          {tabs.map(t => (
                            <button
                              key={t.id}
                              onClick={() => setModalTab(t.id as any)}
                              className={`flex-1 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-3 ${modalTab === t.id ? 'bg-[#FFE600] text-[#2E2E38] shadow-lg shadow-blue-200' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                            >
                              <i className={`fas ${t.icon}`}></i>
                              {t.label}
                            </button>
                          ))}
                        </div>

                        {/* Object Header */}
                        <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm relative overflow-hidden group">
                              <div className="absolute top-0 right-0 p-8">
                                <div className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-sm border ${selectedObj.isRisky ? 'bg-red-50 text-red-600 border-red-100 animate-pulse' : 'bg-green-50 text-green-600 border-green-100'}`}>
                                  <i className={`fas ${selectedObj.isRisky ? 'fa-triangle-exclamation' : 'fa-circle-check'}`}></i>
                                  {selectedObj.isRisky ? 'Risk Identified' : 'Secure Configuration'}
                                </div>
                              </div>
                                
                                <div className="flex items-center gap-6 mb-8">
                                  <div className={`w-16 h-16 rounded-[24px] flex items-center justify-center text-2xl shadow-inner ${selectedObj.isRisky ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-500'}`}>
                                    <i className={`fas ${selectedObj.isRisky ? 'fa-shield-virus' : 'fa-shield'}`}></i>
                                  </div>
                                  <div>
                                    <h3 className="text-3xl font-black text-slate-900 tracking-tight leading-none mb-3">{selectedObj.label}</h3>
                                    <div className="flex flex-wrap items-center gap-3">
                                      <span className="text-[11px] text-slate-500 font-mono bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">{selectedObj.name}</span>
                                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                                      <span className="text-[11px] font-black text-[#2E2E38] uppercase tracking-widest bg-[#FFE600]/10 px-3 py-1 rounded-lg border border-[#FFE600]/30">{modalActiveProfile}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pt-8 border-t border-slate-50">
                                  <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Internal OWD</p>
                                    <p className="text-sm font-black text-slate-700">{selectedObj.internalModel}</p>
                                  </div>
                                  <div className={`p-4 rounded-2xl border ${selectedObj.isRiskyOWD ? 'bg-red-50 border-red-100' : 'bg-slate-50/50 border-slate-100'}`}>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">External OWD</p>
                                    <p className={`text-sm font-black ${selectedObj.isRiskyOWD ? 'text-red-600' : 'text-slate-700'}`}>{selectedObj.externalModel}</p>
                                  </div>
                                  <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Exposed Fields</p>
                                    <p className="text-sm font-black text-slate-700">{exposedFieldsCount}</p>
                                  </div>
                                  <div className={`p-4 rounded-2xl border ${sensitiveRisksCount > 0 ? 'bg-amber-50 border-amber-100' : 'bg-slate-50/50 border-slate-100'}`}>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Sensitive Risks</p>
                                    <p className={`text-sm font-black ${sensitiveRisksCount > 0 ? 'text-amber-600' : 'text-slate-700'}`}>{sensitiveRisksCount}</p>
                                  </div>
                                </div>
                              </div>

                            {modalTab === 'object' ? (
                              <div className="bg-white rounded-[32px] border border-slate-100 overflow-hidden shadow-sm">
                                {(() => {
                                  const permsArray = Array.isArray(selectedObj.permissions) ? selectedObj.permissions : (selectedObj.permissions ? [selectedObj.permissions] : []);
                                  const profilePerms = permsArray.find((p: any) => p.profile === modalActiveProfile);
                                  
                                  // Indirect access box removed as per user request
                                  return (
                                    <div className="p-6 bg-[#FFE600]/10/50 border-b border-[#FFE600]/30">
                                      <div className="flex items-start gap-3">
                                        <div className="w-8 h-8 rounded-xl bg-blue-100 text-[#2E2E38] flex items-center justify-center text-sm">
                                          <i className="fas fa-circle-info"></i>
                                        </div>
                                        <div>
                                          <p className="text-[11px] text-blue-800 leading-relaxed font-medium">
                                            Record-level access is determined by a combination of <span className="font-bold">Org-Wide Defaults (OWD)</span>, <span className="font-bold">Sharing Rules</span>, and <span className="font-bold">Role Hierarchy</span>. Profile permissions (below) define what actions can be performed on those records.
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })()}
                                <div className="px-8 py-5 border-b border-slate-50 bg-slate-50/30 flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-xl bg-[#FFE600]/100 flex items-center justify-center text-white text-xs shadow-sm shadow-blue-200">
                                      <i className="fas fa-lock"></i>
                                    </div>
                                    <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">Object Permissions</h4>
                                  </div>
                                </div>
                                <div className="p-0">
                                  <table className="w-full text-left border-collapse">
                                    <thead>
                                      <tr className="bg-slate-50/50 border-b border-slate-100">
                                        <th className="py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Permission Type</th>
                                        <th className="py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Access Status</th>
                                        <th className="py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Description</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                      {(() => {
                                        const effObj = effectiveRights?.objects[selectedObj.name] || { read: false, create: false, edit: false, delete: false, sources: [] };
                                        
                                        return [
                                          { label: 'Read', val: effObj.read, icon: 'fa-eye', desc: 'Ability to view records of this object' },
                                          { label: 'Create', val: effObj.create, icon: 'fa-plus', desc: 'Ability to create new records' },
                                          { label: 'Edit', val: effObj.edit, icon: 'fa-pen', desc: 'Ability to modify existing records' },
                                          { label: 'Delete', val: effObj.delete, icon: 'fa-trash', desc: 'Ability to remove records permanently' }
                                        ].map(p => (
                                          <tr key={p.label} className="group hover:bg-slate-50/50 transition-colors">
                                            <td className="py-5 px-8">
                                              <div className="flex items-center gap-4">
                                                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-sm shadow-inner ${p.val ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                                                  <i className={`fas ${p.icon}`}></i>
                                                </div>
                                                <div>
                                                  <span className="text-sm font-black text-slate-800 block">{p.label}</span>
                                                  <span className="text-[10px] text-slate-400 font-medium">{p.desc}</span>
                                                </div>
                                              </div>
                                            </td>
                                            <td className="py-5 px-8">
                                              <div className="flex justify-center relative group/source">
                                                <div className={`flex items-center gap-3 px-5 py-2 rounded-2xl text-[11px] font-black uppercase tracking-widest border shadow-sm transition-all ${
                                                  p.val 
                                                    ? 'bg-green-500 text-white border-green-400 shadow-green-100' 
                                                    : 'bg-red-600 text-white border-red-500 shadow-red-200 ring-4 ring-red-500/10'
                                                }`}>
                                                  <i className={`fas ${p.val ? 'fa-check-circle' : 'fa-circle-xmark text-lg'}`}></i>
                                                  {p.val ? 'Access Allowed' : 'Access Denied'}
                                                </div>
                                                
                                                {effObj.sources.length > 0 && (
                                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-[#2E2E38] text-white text-[10px] p-3 rounded-2xl opacity-0 group-hover/source:opacity-100 transition-all pointer-events-none z-50 shadow-xl border border-white/10 scale-95 group-hover/source:scale-100">
                                                    <div className="flex items-center gap-2 mb-2 border-b border-white/10 pb-2">
                                                      <i className="fas fa-fingerprint text-[#FFE600]"></i>
                                                      <p className="font-bold uppercase tracking-widest text-[9px]">Permission Sources</p>
                                                    </div>
                                                    <div className="space-y-1.5">
                                                      {effObj.sources.map((s: any, idx: number) => (
                                                        <div key={idx} className="flex items-center justify-between gap-4">
                                                          <div className="flex items-center gap-2 truncate">
                                                            <i className={`fas ${s.type === 'profile' ? 'fa-user-gear' : 'fa-shield-halved'} text-[8px] opacity-40`}></i>
                                                            <span className="truncate">{s.name}</span>
                                                          </div>
                                                          <div className="flex gap-1 shrink-0">
                                                            {s.grantsRead && <span className="px-1 bg-green-500/20 text-green-400 rounded text-[7px] font-bold">R</span>}
                                                            {s.grantsEdit && <span className="px-1 bg-[#FFE600]/100/20 text-[#FFE600] rounded text-[7px] font-bold">E</span>}
                                                          </div>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  </div>
                                                )}
                                              </div>
                                            </td>
                                            <td className="py-5 px-8">
                                              <div className={`px-4 py-2 rounded-xl text-[10px] font-bold ${p.val ? 'bg-amber-50 text-amber-700 border border-amber-100' : 'bg-slate-50 text-slate-400 border border-slate-100'}`}>
                                                {p.val ? (
                                                  <div className="flex items-center gap-2">
                                                    <i className="fas fa-triangle-exclamation animate-pulse"></i>
                                                    <span>Potential Security Risk</span>
                                                  </div>
                                                ) : (
                                                  <div className="flex items-center gap-2">
                                                    <i className="fas fa-shield-check"></i>
                                                    <span>Secure Configuration</span>
                                                  </div>
                                                )}
                                              </div>
                                            </td>
                                          </tr>
                                        ));
                                      })()}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ) : modalTab === 'field' ? (
                              <div className="bg-white rounded-[32px] border border-slate-100 overflow-hidden shadow-sm">
                                <div className="px-8 py-5 border-b border-slate-50 bg-slate-50/30 flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-xl bg-amber-500 flex items-center justify-center text-white text-xs shadow-sm shadow-amber-200">
                                      <i className="fas fa-table-list"></i>
                                    </div>
                                    <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">Field Level Security</h4>
                                  </div>
                                </div>
                                <div className="p-0">
                                  <table className="w-full text-left border-collapse">
                                    <thead>
                                      <tr className="bg-slate-50/50 border-b border-slate-100">
                                        <th className="py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Field Name</th>
                                        <th className="py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Read</th>
                                        <th className="py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Edit</th>
                                        <th className="py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Risk Level</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                      {(() => {
                                        const currentObj = dbObjects.find((o: any) => o.name === selectedObj.name) || selectedObj;
                                        
                                        const uniqueFieldMap = new Map();
                                        (currentObj.fields || []).forEach((f: any) => {
                                          if (!uniqueFieldMap.has(f.name)) {
                                              uniqueFieldMap.set(f.name, { ...f });
                                          }
                                        });

                                        // Also ensure fields purely in effectiveRights but missing in currentObj are included (can happen with perm sets)
                                        if (effectiveRights?.fields) {
                                          Object.keys(effectiveRights.fields).forEach(key => {
                                            const fieldName = key.includes('.') ? key.split('.')[1] : key;
                                            if (key.startsWith(`${currentObj.name}.`) && !uniqueFieldMap.has(fieldName)) {
                                              uniqueFieldMap.set(fieldName, { name: fieldName, label: fieldName, isSensitive: false });
                                            }
                                          });
                                        }

                                        const profileFields = Array.from(uniqueFieldMap.values());
                                        
                                        if (profileFields.length === 0) {
                                          return (
                                            <tr>
                                              <td colSpan={4} className="py-20 text-center">
                                                <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                                                  <i className="fas fa-eye-slash text-xl"></i>
                                                </div>
                                                <p className="text-sm font-medium text-slate-400 italic">No field permissions found for this object</p>
                                                <p className="text-[10px] text-slate-400 mt-2">Try clicking the refresh icon next to the profile selector to fetch full metadata.</p>
                                              </td>
                                            </tr>
                                          );
                                        }
                                        return profileFields.map((f: any) => {
                                          const effField = effectiveRights?.fields[`${currentObj.name}.${f.name}`] || effectiveRights?.fields[f.name] || { read: false, edit: false, sources: [] };
                                          const isSensitive = f.isSensitive;
                                          
                                          return (
                                            <tr key={f.name} className="group hover:bg-slate-50/50 transition-colors">
                                              <td className="py-4 px-8">
                                                <div className="flex flex-col">
                                                  <span className="text-xs font-bold text-slate-800">{f.label || f.name}</span>
                                                  <span className="text-[9px] text-slate-400 font-mono">{f.name}</span>
                                                </div>
                                              </td>
                                              <td className="py-4 px-8 text-center relative group/source">
                                                <i className={`fas ${effField.read ? 'fa-check-circle text-green-500' : 'fa-circle-xmark text-slate-200'} text-sm`}></i>
                                                {effField.sources.length > 0 && (
                                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-[#2E2E38] text-white text-[9px] p-2 rounded-xl opacity-0 group-hover/source:opacity-100 transition-all pointer-events-none z-50 shadow-xl border border-white/10 scale-95 group-hover/source:scale-100">
                                                    <p className="font-bold border-b border-white/10 pb-1.5 mb-1.5 uppercase tracking-widest text-[8px] text-slate-400">Sources</p>
                                                    <div className="space-y-1">
                                                      {effField.sources.map((s: any, idx: number) => (
                                                        <div key={idx} className="flex justify-between items-center gap-4">
                                                          <span className="truncate">{s.name}</span>
                                                          <span className={`font-black text-[7px] px-1 rounded ${s.grantsRead ? 'bg-green-500/20 text-green-400' : 'text-slate-500'}`}>R</span>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  </div>
                                                )}
                                              </td>
                                              <td className="py-4 px-8 text-center relative group/source">
                                                <i className={`fas ${effField.edit ? 'fa-check-circle text-green-500' : 'fa-circle-xmark text-slate-200'} text-sm`}></i>
                                                {effField.sources.length > 0 && (
                                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-[#2E2E38] text-white text-[9px] p-2 rounded-xl opacity-0 group-hover/source:opacity-100 transition-all pointer-events-none z-50 shadow-xl border border-white/10 scale-95 group-hover/source:scale-100">
                                                    <p className="font-bold border-b border-white/10 pb-1.5 mb-1.5 uppercase tracking-widest text-[8px] text-slate-400">Sources</p>
                                                    <div className="space-y-1">
                                                      {effField.sources.map((s: any, idx: number) => (
                                                        <div key={idx} className="flex justify-between items-center gap-4">
                                                          <span className="truncate">{s.name}</span>
                                                          <span className={`font-black text-[7px] px-1 rounded ${s.grantsEdit ? 'bg-[#FFE600]/100/20 text-[#FFE600]' : 'text-slate-500'}`}>E</span>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  </div>
                                                )}
                                              </td>
                                              <td className="py-4 px-8">
                                                {isSensitive ? (
                                                  <span className="px-3 py-1 bg-red-50 text-red-600 text-[9px] font-black uppercase tracking-widest rounded-lg border border-red-100">High Risk</span>
                                                ) : (
                                                  <span className="px-3 py-1 bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-widest rounded-lg border border-slate-100">Standard</span>
                                                )}
                                              </td>
                                            </tr>
                                          );
                                        });
                                      })()}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ) : modalTab === 'sharing' ? (
                              <div className="bg-white rounded-[32px] border border-slate-100 overflow-hidden shadow-sm">
                                <div className="px-8 py-5 border-b border-slate-50 bg-slate-50/30 flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-xl bg-orange-500 flex items-center justify-center text-white text-xs shadow-sm shadow-orange-200">
                                      <i className="fas fa-share-nodes"></i>
                                    </div>
                                    <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">Sharing Rules</h4>
                                  </div>
                                </div>
                                <div className="p-0">
                                  <table className="w-full text-left border-collapse">
                                    <thead>
                                      <tr className="bg-slate-50/50 border-b border-slate-100">
                                        <th className="py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Rule Name</th>
                                        <th className="py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Type</th>
                                        <th className="py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Access Level</th>
                                        <th className="py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                      {(() => {
                                        const rules = selectedObj.sharingRules || [];
                                        
                                        if (rules.length === 0) {
                                          return (
                                            <tr>
                                              <td colSpan={4} className="py-20 text-center">
                                                <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                                                  <i className="fas fa-share-nodes text-xl"></i>
                                                </div>
                                                <p className="text-sm font-medium text-slate-400 italic">No specific sharing rules found for this object</p>
                                                <p className="text-[10px] text-slate-400 mt-2">Only Criteria-based and Owner-based rules are listed here.</p>
                                              </td>
                                            </tr>
                                          );
                                        }
                                        return rules.map((r: any, idx: number) => (
                                          <tr key={`${r.id}-${idx}`} className="group hover:bg-slate-50/50 transition-colors">
                                            <td className="py-4 px-8">
                                              <div className="flex flex-col">
                                                <span className="text-xs font-bold text-slate-800">{r.name}</span>
                                                <span className="text-[9px] text-slate-400 font-mono">{r.id}</span>
                                              </div>
                                            </td>
                                            <td className="py-4 px-8">
                                              <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${
                                                r.type === 'Criteria' ? 'bg-purple-50 text-purple-600 border-purple-100' : 'bg-[#FFE600]/10 text-[#2E2E38] border-[#FFE600]/30'
                                              }`}>
                                                {r.type}
                                              </span>
                                            </td>
                                            <td className="py-4 px-8">
                                              <span className="text-[11px] font-bold text-slate-700">{r.accessLevel}</span>
                                            </td>
                                            <td className="py-4 px-8">
                                              <div className="flex items-center gap-2 text-green-600 text-[10px] font-bold">
                                                <i className="fas fa-check-circle"></i>
                                                <span>Active</span>
                                              </div>
                                            </td>
                                          </tr>
                                        ));
                                      })()}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ) : null}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SecurityAnalysis;
