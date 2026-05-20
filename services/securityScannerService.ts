
import { SalesforceOrgData, SecurityFinding, SecurityAuditResult, MetadataCategory, SecurityCheckPoint } from '../types';
import { GoogleGenAI } from "@google/genai";
import { PMD_RULES } from '../src/constants';
import { auth } from '../firebase';


export class SecurityScannerService {
  static async scanGuestSecurity(orgData: SalesforceOrgData, tileId?: string): Promise<SecurityFinding[]> {
    // ... existing scanGuestSecurity implementation ...
    return []; // Placeholder for now as we transition to scanSecurityHealthCheck
  }

  private static isActualObject(objName: string): boolean {
    if (!objName) return false;
    
    // 1. Custom objects are always actual objects
    if (objName.endsWith('__c')) return true;
    
    // 2. Explicitly exclude metadata/tooling suffixes
    const metadataSuffixes = [
      '__mdt', '__e', '__b', '__x', '__xo', '__kav',
      '__ChangeEvent', '__History', '__Share', '__Feed', '__Tag',
      '__DataCategorySelection', '__ViewStat', '__VoteStat',
    ];
    if (metadataSuffixes.some(s => objName.endsWith(s))) return false;
    
    // 3. Use an explicit allowlist of real standard data objects
    //    (objects that hold actual business data and appear in sharing settings)
    const standardDataObjects = new Set([
      'Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'Task', 'Event',
      'User', 'Asset', 'Campaign', 'CampaignMember', 'Contract', 'Order',
      'OrderItem', 'Product2', 'Pricebook2', 'PricebookEntry', 'Quote',
      'QuoteLineItem', 'OpportunityContactRole',
      'AccountContactRole', 'AccountTeamMember', 'CaseComment', 'CaseSolution',
      'Solution', 'Idea', 'IdeaComment', 'Vote',
      'WorkOrder', 'WorkOrderLineItem', 'ServiceAppointment',
      'ReturnOrder', 'ReturnOrderLineItem',
      'Entitlement', 'EntitlementContact', 'ServiceContract', 'ContractLineItem',
      'LiveChatTranscript', 'LiveChatVisitor',
      'MessagingSession', 'MessagingEndUser',
      'Location', 'ProductItem', 'ProductRequest', 'ProductTransfer',
      'Survey', 'SurveyInvitation', 'SurveyResponse', 'SurveySubject',
      'Image', 'Document', 'Attachment', 'Note', 'ContentDocument',
      'ContentVersion', 'ContentDocumentLink',
      'FeedItem', 'FeedComment', 'FeedLike',
      'CollaborationGroup', 'CollaborationGroupMember',
      'Site', 'Network'
    ]);
    
    if (standardDataObjects.has(objName)) return true;
    
    // 4. Explicitly exclude known tooling/setup objects that might have slipped through
    const toolingPrefixes = [
      'Apex', 'Aura', 'Lightning', 'Process', 'Assignment', 'QuickAction',
      'WebLink', 'CustomField', 'CustomObject', 'ValidationRule', 'Workflow',
      'EmailTemplate', 'Report', 'Dashboard', 'Folder', 'Group', 'Queue',
      'PermissionSet', 'Profile', 'UserRole', 'Territory', 'Brand', 'Content',
      'DataAssessment', 'Entity', 'FieldDefinition', 'FlexiPage', 'Layout',
      'ListView', 'NamedCredential', 'Organization', 'Package', 'Saml',
      'Scontrol', 'StaticResource', 'TabDefinition'
    ];
    if (toolingPrefixes.some(p => objName.startsWith(p))) return false;

    // 5. Everything else (tooling objects, setup objects, etc.) is excluded
    return false;
  }

  static calculateEffectiveAccess(
    profileId: string,
    profileName: string,
    objectPerms: any[],
    fieldPerms: any[],
    selectedPermSets: any[]
  ) {
    const effective: any = {
      objects: {},
      fields: {}
    };

    // Layer 1: Base Profile
    objectPerms.forEach(op => {
      const obj = op.SobjectType || op.object || op.name;
      if (!obj) return;
      const grantsRead = !!(op.PermissionsRead || op.allowRead || op.read);
      const grantsCreate = !!(op.PermissionsCreate || op.allowCreate || op.create);
      const grantsEdit = !!(op.PermissionsEdit || op.allowEdit || op.edit);
      const grantsDelete = !!(op.PermissionsDelete || op.allowDelete || op.delete);
      
      effective.objects[obj] = {
        read: grantsRead,
        create: grantsCreate,
        edit: grantsEdit,
        delete: grantsDelete,
        sources: [{ name: `Profile: ${profileName}`, type: 'profile', grantsRead, grantsEdit }]
      };
    });

    fieldPerms.forEach(fp => {
      const field = fp.Field || fp.field || fp.name;
      if (!field) return;
      const grantsRead = !!(fp.PermissionsRead || fp.readable || fp.read);
      const grantsEdit = !!(fp.PermissionsEdit || fp.editable || fp.edit);
      
      effective.fields[field] = {
        read: grantsRead,
        edit: grantsEdit,
        sources: [{ name: `Profile: ${profileName}`, type: 'profile', grantsRead, grantsEdit }]
      };
    });

    // Layer 2: Selected Permission Sets (Most Permissive / OR logic)
    selectedPermSets.forEach(ps => {
      const psName = ps.Label || ps.label || ps.Name || ps.name;
      
      const psObjPerms = ps.ObjectPermissions || ps.Metadata?.objectPermissions || ps.relatedMetadata?.objectPermissions || [];
      psObjPerms.forEach((op: any) => {
        const obj = op.SobjectType || op.object;
        if (!obj) return;

        if (!effective.objects[obj]) {
          effective.objects[obj] = { read: false, create: false, edit: false, delete: false, sources: [] };
        }
        const grantsRead = !!(op.PermissionsRead || op.allowRead);
        const grantsEdit = !!(op.PermissionsEdit || op.allowEdit);
        
        effective.objects[obj].read = effective.objects[obj].read || grantsRead;
        effective.objects[obj].create = effective.objects[obj].create || !!(op.PermissionsCreate || op.allowCreate);
        effective.objects[obj].edit = effective.objects[obj].edit || grantsEdit;
        effective.objects[obj].delete = effective.objects[obj].delete || !!(op.PermissionsDelete || op.allowDelete);
        
        if (grantsRead || grantsEdit) {
          effective.objects[obj].sources.push({ name: `PermSet: ${psName}`, type: 'permset', grantsRead, grantsEdit });
        }
      });

      const psFieldPerms = ps.FieldPermissions || ps.Metadata?.fieldPermissions || ps.relatedMetadata?.fieldPermissions || [];
      psFieldPerms.forEach((fp: any) => {
        const field = fp.Field || fp.field;
        if (!field) return;

        if (!effective.fields[field]) {
          effective.fields[field] = { read: false, edit: false, sources: [] };
        }
        const grantsRead = !!(fp.PermissionsRead || fp.readable);
        const grantsEdit = !!(fp.PermissionsEdit || fp.editable);
        
        effective.fields[field].read = effective.fields[field].read || grantsRead;
        effective.fields[field].edit = effective.fields[field].edit || grantsEdit;
        
        if (grantsRead || grantsEdit) {
          effective.fields[field].sources.push({ name: `PermSet: ${psName}`, type: 'permset', grantsRead, grantsEdit });
        }
      });
    });

    return effective;
  }

  static async scanSecurityHealthCheck(orgData: SalesforceOrgData): Promise<SecurityCheckPoint[]> {
    const checkPoints: SecurityCheckPoint[] = [];
    
    const securityMetaRec = orgData.automation?.find(a => a.id === 'security_meta');
    const securityMeta = securityMetaRec?.details ? JSON.parse(securityMetaRec.details) : {};
    const { orgSettings, networkSettings, securitySettings, sharingSettingsMeta, userMgmtSettings, epimFieldSet, epimFieldSetMembers, classes = [], pages = [], customPerms = [], sharingCriteriaRules = [], sharingOwnerRules = [] } = securityMeta;

    const classMap: Record<string, string> = {};
    const pageMap: Record<string, string> = {};
    classes.forEach((c: any) => classMap[c.Id.substring(0, 15)] = c.Name);
    pages.forEach((p: any) => pageMap[p.Id.substring(0, 15)] = p.Name);

    // Identify Guest and Portal Profiles using UserLicense if available
    console.log(`DEBUG: Total profiles in orgData: ${orgData.profiles?.length || 0}`);
    const guestProfiles = orgData.profiles.filter(p => {
      const licenseName = (p.UserLicense?.Name || p.UserLicense?.name || '').toLowerCase();
      const profileName = (p.name || '').toLowerCase();
      const profileLabel = ((p as any).label || (p as any).Name || '').toLowerCase();
      const userType = ((p as any).UserType || '').toLowerCase();
    
      const isGuest = userType === 'guest' || 
             licenseName.includes('guest') || 
             profileName.includes('guest') || 
             profileLabel.includes('guest') ||
             profileName.includes('site') ||
             profileLabel.includes('site');
             
      if (isGuest) {
        console.log(`DEBUG: Identified Guest Profile: ${p.name} (${profileLabel}) - License: ${p.UserLicense?.Name || p.UserLicense?.name || 'Unknown'} - UserType: ${p.UserType || 'Unknown'}`);
      }
      return isGuest;
    });
    console.log(`DEBUG: Total Guest Profiles identified: ${guestProfiles.length}`);

    const portalProfiles = orgData.profiles.filter(p => {
      const licenseName = (p.UserLicense?.Name || p.UserLicense?.name || '').toLowerCase();
      const profileName = (p.name || '').toLowerCase();
      const profileLabel = ((p as any).label || (p as any).Name || '').toLowerCase();
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
    });

    // 1. Object and Field level security access
    const sharingSettings = orgData.sharingSettings || [];
    const sensitiveFields = ['Email', 'Phone', 'MobilePhone', 'Address', 'Birthdate'];

    // Map to store all security info per object
    const objectSecurityMap: Record<string, any> = {};

    // Initialize with sharing settings
    console.log(`DEBUG: Initializing objectSecurityMap with ${sharingSettings.length} sharing settings`);
    sharingSettings.forEach((ss: any) => {
      if (!this.isActualObject(ss.name)) return;
      
      objectSecurityMap[ss.name] = {
        name: ss.name,
        label: ss.label || ss.name,
        externalModel: ss.externalSharingModel,
        internalModel: ss.internalSharingModel,
        isRiskyOWD: ss.externalSharingModel !== 'Private' && !ss.externalSharingModel?.startsWith('ControlledBy'),
        permissions: [],
        fields: [],
        sharingRules: []
      };
    });

    // 1.1 Handle OWD inheritance for "ControlledBy" objects
    const parentMapping: Record<string, string> = {
      'CampaignMember': 'Campaign',
      'OrderItem': 'Order',
      'OpportunityContactRole': 'Opportunity',
      'PricebookEntry': 'Pricebook2',
      'AccountContactRole': 'Account',
      'CaseComment': 'Case',
      'IdeaComment': 'Idea'
    };

    Object.keys(objectSecurityMap).forEach(objName => {
      const obj = objectSecurityMap[objName];
      if (obj.externalModel?.startsWith('ControlledBy')) {
        const parentName = parentMapping[objName];
        if (parentName && objectSecurityMap[parentName]) {
          const parentOWD = objectSecurityMap[parentName].externalModel;
          // If parent is not Private, child is risky
          if (parentOWD !== 'Private' && !parentOWD?.startsWith('ControlledBy')) {
            obj.isRiskyOWD = true;
          }
        }
      }
    });

    // Process Sharing Rules
    sharingCriteriaRules.forEach((rule: any) => {
      const objName = rule.EntityDefinitionId;
      if (objectSecurityMap[objName]) {
        objectSecurityMap[objName].sharingRules.push({
          id: rule.Id,
          name: rule.DeveloperName,
          type: 'Criteria',
          accessLevel: rule.AccessLevel
        });
      }
    });

    sharingOwnerRules.forEach((rule: any) => {
      const objName = rule.EntityDefinitionId;
      if (objectSecurityMap[objName]) {
        objectSecurityMap[objName].sharingRules.push({
          id: rule.Id,
          name: rule.DeveloperName,
          type: 'Owner',
          accessLevel: rule.AccessLevel
        });
      }
    });
    console.log(`DEBUG: objectSecurityMap initialized with ${Object.keys(objectSecurityMap).length} actual objects`);

    // Get Object Permissions for Guest and Portal Profiles
    const securityRelevantProfiles = [...guestProfiles, ...portalProfiles];
    
    for (const p of securityRelevantProfiles) {
      const metadata = p as any;
      // Handle various metadata structures (Tooling API vs Metadata API)
      const objPerms = metadata.ObjectPermissions || 
                       metadata.Metadata?.objectPermissions || 
                       metadata.relatedMetadata?.objectPermissions || 
                       metadata.objectPermissions || [];
      
      console.log(`DEBUG: Processing ${objPerms.length} ObjectPermissions for profile ${p.name}`);
      const isGuest = guestProfiles.some(gp => gp.id === p.id);
      
      objPerms.forEach((op: any) => {
        const objName = op.SobjectType || op.object;
        if (!objName || !this.isActualObject(objName)) return;

        // Additional guard: skip objects that look like setup/tooling
        // even if isActualObject passed them through
        if (!objName.endsWith('__c') && objName.length > 30) return; // tooling objects tend to be long
        
        if (!objectSecurityMap[objName]) {
          objectSecurityMap[objName] = { 
            name: objName, 
            label: objName, 
            permissions: [], 
            fields: [], 
            externalModel: 'N/A', 
            internalModel: 'N/A', 
            isRiskyOWD: false 
          };
        }
        
        objectSecurityMap[objName].permissions.push({
          profile: p.name,
          profileLabel: p.label || p.name,
          isGuest: isGuest,
          read: !!(op.PermissionsRead || op.allowRead),
          create: !!(op.PermissionsCreate || op.allowCreate),
          edit: !!(op.PermissionsEdit || op.allowEdit),
          delete: !!(op.PermissionsDelete || op.allowDelete),
          viewAll: !!(op.PermissionsViewAllRecords || op.viewAllRecords),
          modifyAll: !!(op.PermissionsModifyAllRecords || op.modifyAllRecords)
        });
      });
      console.log(`DEBUG: objectSecurityMap now has ${Object.keys(objectSecurityMap).length} objects after processing ${p.name}`);

      // Get Field Permissions
      const fieldPermissions = metadata.FieldPermissions || 
                               metadata.Metadata?.fieldPermissions || 
                               metadata.relatedMetadata?.fieldPermissions || 
                               metadata.fieldPermissions || [];
                               
      fieldPermissions.forEach((fp: any) => {
        const fullFieldName = fp.Field || fp.field || '';
        const parts = fullFieldName.split('.');
        const objName = parts[0];
        const fieldName = parts[1];
        
        if (objName && fieldName && this.isActualObject(objName)) {
          if (!objectSecurityMap[objName]) {
            objectSecurityMap[objName] = { 
              name: objName, 
              label: objName, 
              permissions: [], 
              fields: [], 
              externalModel: 'N/A', 
              internalModel: 'N/A', 
              isRiskyOWD: false 
            };
          }
          
          const hasRead = !!(fp.PermissionsRead || fp.readable);
          const hasEdit = !!(fp.PermissionsEdit || fp.editable);
          
          if (hasRead || hasEdit) {
            objectSecurityMap[objName].fields.push({
              profile: p.name,
              profileLabel: p.label || p.name,
              isGuest: isGuest,
              name: fieldName,
              label: fieldName,
              field: fieldName,
              read: hasRead,
              edit: hasEdit,
              isSensitive: sensitiveFields.includes(fieldName)
            });
          }
        }
      });
    }

    const objects = Object.values(objectSecurityMap).map((obj: any) => {
      const hasSensitiveExposed = obj.fields.some((f: any) => f.isSensitive && f.edit);
      return {
        ...obj,
        isRisky: obj.isRiskyOWD || hasSensitiveExposed
      };
    });

    const riskyObjects = objects.filter(o => o.isRisky);
    const isRisky = riskyObjects.length > 0;

    checkPoints.push({
      id: 'object-field-security',
      title: 'Object and Field level security access',
      setupPath: 'Setup > Sharing Settings and Object Manager',
      status: isRisky ? 'Risky' : 'Secure',
      isRisky: isRisky,
      description: 'Review external org-wide defaults and field-level security on sensitive fields. Ensuring external OWDs are private and restricting FLS on sensitive fields (like PII) prevents unauthorized data exposure to unauthenticated guest users.',
      details: "This report provides a comprehensive analysis of object-level and field-level security configurations. It details the sharing settings, including Org-Wide Defaults (OWD), and evaluates the access controls for each object to identify potential security risks.",
      drillDownData: {
        objects: objects
      }
    });

    // Apex Class and Page Access
    const classAccessData: any[] = [];
    const pageAccessData: any[] = [];

    for (const p of securityRelevantProfiles) {
      const metadata = p as any;
      const setupEntityAccess = metadata.SetupEntityAccess || [];
      
      const profileClassAccess: string[] = [];
      const profilePageAccess: string[] = [];
      
      setupEntityAccess.forEach((sea: any) => {
        const entityId = (sea.SetupEntityId || '').substring(0, 15);
        if (sea.SetupEntityType === 'ApexClass' && classMap[entityId]) {
          profileClassAccess.push(classMap[entityId]);
        } else if (sea.SetupEntityType === 'ApexPage' && pageMap[entityId]) {
          profilePageAccess.push(pageMap[entityId]);
        }
      });
      
      classAccessData.push({
        profile: p.name,
        label: p.label || p.name,
        classes: profileClassAccess,
        isGuest: guestProfiles.some(gp => gp.id === p.id)
      });
      
      pageAccessData.push({
        profile: p.name,
        label: p.label || p.name,
        pages: profilePageAccess,
        isGuest: guestProfiles.some(gp => gp.id === p.id)
      });
    }

    const totalExposedClasses = classAccessData.reduce((acc, curr) => acc + curr.classes.length, 0);
    const totalExposedPages = pageAccessData.reduce((acc, curr) => acc + curr.pages.length, 0);

    checkPoints.push({
      id: 'apex-access',
      title: 'Apex Class and Page Access',
      setupPath: 'Setup > Profiles > [Profile] > Apex Class Access / Visualforce Page Access',
      status: (totalExposedClasses > 0 || totalExposedPages > 0) ? 'Risky' : 'Secure',
      isRisky: (totalExposedClasses > 0 || totalExposedPages > 0),
      description: 'Review which Apex Classes and Visualforce Pages are accessible to Guest and Portal users. Minimizing access to only necessary classes/pages reduces the attack surface.',
      details: `Found ${totalExposedClasses} class access entries and ${totalExposedPages} page access entries across ${securityRelevantProfiles.length} profiles.`,
      drillDownData: {
        classAccess: classAccessData,
        pageAccess: pageAccessData
      }
    });

    // 2. Disable Public APIs
    const apiEnabledProfiles: any[] = [];
    const allRelevantProfiles = [...guestProfiles, ...portalProfiles];
    
    for (const p of allRelevantProfiles) {
      const metadata = p as any;
      // Check both Tooling API field and Metadata API structure
      const hasApiEnabled = !!(metadata.PermissionsApiEnabled || 
        metadata.Metadata?.userPermissions?.some((perm: any) => perm.name === 'ApiEnabled' && perm.enabled) ||
        metadata.relatedMetadata?.userPermissions?.some((perm: any) => perm.name === 'ApiEnabled' && perm.enabled));
      
      apiEnabledProfiles.push({
        name: p.name,
        label: p.label,
        apiEnabled: hasApiEnabled,
        type: guestProfiles.some(gp => gp.id === p.id) ? 'Guest' : 'Portal'
      });
    }
    const apiEnabled = apiEnabledProfiles.some(p => p.apiEnabled);
    checkPoints.push({
      id: 'disable-public-apis',
      title: 'Disable Public APIs',
      setupPath: 'Site Settings and Guest User Profile > System Permissions',
      status: apiEnabled ? 'Enabled (Risky)' : 'Disabled (Secure)',
      isRisky: apiEnabled,
      description: 'Confirm public API access is off. Closing public APIs prevents unauthorized data extraction by unauthenticated users. If left enabled, malicious actors could potentially query your Salesforce data directly through standard API endpoints.',
      details: apiEnabled 
        ? 'One or more guest or portal profiles have "API Enabled" permission.'
        : 'API access is disabled for all identified guest and portal profiles.',
      drillDownData: {
        profiles: apiEnabledProfiles
      }
    });

    // 3. Restrict Visibility
    const sharingMeta = sharingSettingsMeta?.records?.[0]?.Metadata || sharingSettingsMeta?.Metadata || {};
    const portalVisibility = sharingMeta.enablePortalUserVisibility;
    const siteVisibility = sharingMeta.enableCommunityUserVisibility;
    const visibilityOn = portalVisibility || siteVisibility;
    checkPoints.push({
      id: 'restrict-visibility',
      title: 'Restrict Visibility',
      setupPath: 'Setup > Sharing Settings',
      status: visibilityOn ? 'On (Risky)' : 'Off (Secure)',
      isRisky: !!visibilityOn,
      description: 'Check portal and site user visibility. Limiting visibility stops guest and portal users from seeing internal users or other community members. This is crucial for maintaining data privacy and preventing user enumeration attacks within your Experience Cloud sites.',
      details: `Portal Visibility: ${portalVisibility ? 'On' : 'Off'}, Site Visibility: ${siteVisibility ? 'On' : 'Off'}`,
      drillDownData: {
        settings: [
          { name: 'Portal User Visibility', value: !!portalVisibility, isRisky: !!portalVisibility },
          { name: 'Site User Visibility', value: !!siteVisibility, isRisky: !!siteVisibility }
        ]
      }
    });

    // 4. Self-Registration
    const portals = orgData.portals || [];
    const allNetworks = networkSettings?.records || [];
    const sites = orgData.sites || [];
    const selfRegPortals = portals.filter((p: any) => p.IsSelfRegistrationActivated || p.isSelfRegistrationActivated);
    const selfRegNetworks = allNetworks.filter((n: any) => n.SelfRegistration === true || n.SelfRegistration === 'true');
    const selfRegEnabled = selfRegPortals.length > 0 || selfRegNetworks.length > 0;

    checkPoints.push({
      id: 'self-registration',
      title: 'Self-Registration',
      setupPath: 'Setup > All Sites > Login & Registration or Portal Settings',
      status: selfRegEnabled ? 'Enabled' : 'Disabled',
      isRisky: !!selfRegEnabled,
      description: 'Check if self-registration is on. If not needed, disabling prevents escalation from guest access. Open self-registration can lead to spam accounts and potential privilege escalation if default profiles are overly permissive.',
      details: selfRegEnabled 
        ? `Self-registration is active in ${selfRegPortals.length} portals and ${selfRegNetworks.length} sites.`
        : 'Self-registration is not active.',
      drillDownData: {
        sites: [
          ...portals.map((p: any) => ({
            name: p.name || p.Name,
            siteType: 'Portal',
            status: (p.IsSelfRegistrationActivated || p.isSelfRegistrationActivated) ? 'Active' : 'Not Active',
            selfRegEnabled: !!(p.IsSelfRegistrationActivated || p.isSelfRegistrationActivated),
            guestProfile: 'Not Specified'
          })),
          ...allNetworks.map((n: any) => {
            const matchingSite = sites.find((s: any) => s.name === n.Name || s.label === n.Name || s.UrlPathPrefix === n.UrlPathPrefix) as any;
            return {
              name: n.Name,
              siteType: 'Experience Site',
              status: (n.SelfRegistration === true || n.SelfRegistration === 'true') ? 'Active' : 'Not Active',
              selfRegEnabled: n.SelfRegistration === true || n.SelfRegistration === 'true',
              guestProfile: matchingSite?.GuestUser?.Profile?.Name || n.SelfRegProfileId || 'Not Specified',
              url: matchingSite?.url || (matchingSite?.Subdomain ? `https://${matchingSite.Subdomain}.my.site.com/${matchingSite.UrlPathPrefix || ''}` : undefined)
            };
          })
        ]
      }
    });

    // 5. EPIM
    const epimOn = userMgmtSettings?.records?.[0]?.Metadata?.enableEnhancedConcealPersonalInfo || false;
    
    let epimFields: any[] = [];
    if (epimOn) {
      // 1. Try Metadata.displayedFields from FieldSet (Tooling API)
      const fsWithMetadata = epimFieldSet?.records?.find((r: any) => 
        r.DeveloperName === 'PersonalInfo_EPIM' || r.DeveloperName === 'personalInfo_EPIM'
      );
      
      if (fsWithMetadata?.Metadata?.displayedFields) {
        epimFields = fsWithMetadata.Metadata.displayedFields.map((m: any) => ({
          field: m.field,
          label: m.field
        }));
      } 
      // 2. Try FieldSetMembers from the sub-query (if still present)
      else if (fsWithMetadata?.FieldSetMembers?.records) {
        epimFields = fsWithMetadata.FieldSetMembers.records.map((m: any) => ({
          field: m.FieldPath,
          label: m.Label || m.FieldPath
        }));
      } 
      // 3. Try the separate epimFieldSetMembers query
      else if (epimFieldSetMembers?.records?.length > 0) {
        epimFields = epimFieldSetMembers.records.map((r: any) => ({
          field: r.FieldPath || r.Name || r.DeveloperName,
          label: r.Label || r.Name || r.DeveloperName
        }));
      } 
      // 4. Fallback to existing logic
      else if (epimFieldSet?.records) {
        const fs = epimFieldSet.records.find((r: any) => 
          r.DeveloperName === 'personalInfo_EPIM' || 
          r.Name === 'personalInfo_EPIM' ||
          r.MasterLabel === 'personalInfo_EPIM' ||
          r.DeveloperName?.toLowerCase().includes('epim') ||
          r.MasterLabel?.toLowerCase().includes('personal info')
        );
        
        if (fs && fs.Metadata) {
          epimFields = fs.Metadata.displayedFields || fs.Metadata.availableFields || [];
        } else if (epimFieldSet.records[0]?.Metadata) {
          epimFields = epimFieldSet.records[0].Metadata.displayedFields || epimFieldSet.records[0].Metadata.availableFields || [];
        }
      }
      
      if (epimFields.length === 0) {
        // If EPIM is on but fieldset is missing, it might be because of query failure
        // We'll add a placeholder to indicate it's enabled but fields couldn't be retrieved
        epimFields = [{ field: 'Enabled (Fieldset retrieval failed)', label: 'Status' }];
      }
    }

    checkPoints.push({
      id: 'epim',
      title: 'EPIM',
      setupPath: 'Setup > User Management Settings',
      status: epimOn ? 'Active' : 'Inactive',
      isRisky: !epimOn,
      description: 'Check if Enhanced Personal Information Masking is on. EPIM protects sensitive user fields from guest access by masking PII (Personally Identifiable Information). This ensures compliance with privacy regulations and prevents data scraping.',
      details: epimOn ? 'EPIM is enabled in the organization.' : 'EPIM is not enabled. Sensitive user fields might be exposed.',
      drillDownData: {
        setting: 'Enhanced Personal Information Masking',
        value: !!epimOn,
        isRisky: !epimOn,
        epimFields: epimFields
      }
    });

    // 6. Profile Filtering
    const profileFilteringOn = userMgmtSettings?.records?.[0]?.Metadata?.enableProfileFiltering || false;
    checkPoints.push({
      id: 'profile-filtering',
      title: 'Profile Filtering',
      setupPath: 'Setup > User Management Settings',
      status: profileFilteringOn ? 'Enabled' : 'Disabled',
      isRisky: !profileFilteringOn,
      description: 'Verify profile filtering is on. Prevents guest users from accessing internal profiles and roles. Enabling this feature ensures that external users cannot query or view the organizational hierarchy and internal profile structures.',
      details: profileFilteringOn ? 'Profile filtering is active.' : 'Profile filtering is disabled. Guest users might see internal profiles.',
      drillDownData: {
        setting: 'Profile Filtering',
        value: !!profileFilteringOn,
        isRisky: !profileFilteringOn
      }
    });

    // 7. Show Nicknames
    const allSitesWithNicknames = allNetworks.map((n: any) => {
      const matchingSite = sites.find((s: any) => s.name === n.Name || s.label === n.Name || s.UrlPathPrefix === n.UrlPathPrefix) as any;
      return {
        name: n.Name,
        showNicknames: n.OptionsShowNicknames === true || n.OptionsShowNicknames === 'true',
        url: matchingSite?.url || (matchingSite?.Subdomain ? `https://${matchingSite.Subdomain}.my.site.com/${matchingSite.UrlPathPrefix || ''}` : undefined)
      };
    });
    const anySiteShowsRealNames = allSitesWithNicknames.some(s => !s.showNicknames);
    
    checkPoints.push({
      id: 'show-nicknames',
      title: 'Show Nicknames',
      setupPath: 'Experience Workspaces > Administration',
      status: anySiteShowsRealNames ? 'Real Names (Risky)' : 'Nicknames (Secure)',
      isRisky: anySiteShowsRealNames,
      description: 'Check if nicknames replace real names. Nicknames protect user identity from other site members and guest users. Displaying real names can inadvertently expose personal information and increase the risk of targeted social engineering.',
      details: anySiteShowsRealNames 
        ? `Found ${allSitesWithNicknames.filter(s => !s.showNicknames).length} sites showing real names instead of nicknames.`
        : 'All sites are configured to show nicknames.',
      drillDownData: {
        sites: allSitesWithNicknames
      }
    });

    return checkPoints;
  }

  private static getSafeOrgId(orgId: string): string {
    return String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
  }

  static async storeSecurityTileResult(orgId: string, tileId: string, data: any, summary?: any): Promise<void> {
    try {
      await fetch('/api/security/analysis/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          tileId,
          data,
          summary,
          timestamp: new Date().toISOString(),
          ownerUid: auth.currentUser?.uid
        })
      });
    } catch (e) {
      console.error(`Failed to store security tile result for ${tileId}`, e);
      throw e;
    }
  }

  static async getSecurityAnalysis(orgId: string): Promise<any> {
    try {
      const res = await fetch(`/api/security/analysis/${orgId}`);
      if (res.ok) {
        return await res.json();
      }
      return null;
    } catch (error) {
      console.error("Failed to fetch security analysis", error);
      return null;
    }
  }

  static async runAISecurityScan(
    orgData: SalesforceOrgData, 
    sfService?: any,
    onProgress?: (current: number, total: number, itemName: string) => void
  ): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];
    
    // Scan all classes as requested by the user
    let classesToScan = [...(orgData.classes || [])];

    // Sort to prioritize AuraEnabled, but scan everything
    classesToScan = classesToScan.sort((a, b) => {
      const aAura = a.content?.toLowerCase().includes('@auraenabled') ? 1 : 0;
      const bAura = b.content?.toLowerCase().includes('@auraenabled') ? 1 : 0;
      return bAura - aAura;
    });

    // Use a concurrency limit to avoid hitting rate limits while scanning all classes
    const CONCURRENCY_LIMIT = 3; // Reduced for better stability
    const total = classesToScan.length;
    
    // Fetch latest rules from DB to ensure correct URLs
    let currentRules = PMD_RULES;
    try {
      const rulesRes = await fetch('/api/security/rules');
      if (rulesRes.ok) {
        currentRules = await rulesRes.json();
      }
    } catch (e) {
      console.warn("Failed to fetch latest SCA rules, using defaults", e);
    }
    
    for (let i = 0; i < classesToScan.length; i += CONCURRENCY_LIMIT) {
      const chunk = classesToScan.slice(i, i + CONCURRENCY_LIMIT);
      const chunkPromises = chunk.map(async (apexClass, idx) => {
        const currentIdx = i + idx + 1;
        if (onProgress) onProgress(currentIdx, total, apexClass.name);

        let content = apexClass.content;
        
        // If content is missing, try to fetch it if sfService is provided
        if (!content && sfService) {
          try {
            const result = await sfService.fetchMetadataContent('classes', apexClass.id);
            content = result.content;
          } catch (e) {
            console.warn(`Failed to fetch content for ${apexClass.name} during scan`, e);
          }
        }

        if (!content) return [];
        
        try {
          return await this.callAISecurityScan(apexClass.name, content);
        } catch (e) {
          console.error(`AI scan failed for ${apexClass.name}`, e);
          return [];
        }
      });
      
      const chunkResults = await Promise.all(chunkPromises);
      chunkResults.forEach(res => {
        // Post-process findings to ensure correct severity and URLs from currentRules
        const processed = res.map(f => {
          const rule = (Object.values(currentRules) as any[]).find((r: any) => r.name.toLowerCase() === f.ruleName.toLowerCase());
          return {
            ...f,
            severity: (rule?.severity || f.severity || 'Medium') as any,
            pmdUrl: rule?.pmdUrl || f.pmdUrl || `https://pmd.github.io/pmd/pmd_rules_apex_security.html#${f.ruleName.toLowerCase()}`,
            sfUrl: rule?.sfUrl || f.sfUrl
          };
        });
        findings.push(...processed);
      });
    }

    return findings;
  }

  private static async callAISecurityScan(name: string, content: string): Promise<SecurityFinding[]> {
    const apiKeys = (process.env.VITE_GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').filter(key => key.trim() !== '');
    if (apiKeys.length === 0) return [];

    const prompt = `Perform a deep Static Code Analysis (AI-Powered) on the following Salesforce Apex Class: "${name}".
    
    CONTENT:
    ${content.substring(0, 15000)}
    
    SECURITY RULES TO ENFORCE:
    1. ApexBadCrypto: Check for use of weak cryptographic algorithms.
    2. ApexCRUDViolation: Check for DML/SOQL without isAccessible/isCreateable/isUpdateable/isDeletable checks.
    3. ApexCSRF: Check for potential CSRF vulnerabilities in Apex controllers.
    4. ApexDangerousMethods: Avoid using dangerous methods like 'untyped' JSON or dynamic DML without checks.
    5. ApexInsecureEndpoint: Check for hardcoded http:// endpoints.
    6. ApexOpenRedirect: Check for PageReference redirects using user-controlled input.
    7. ApexSharingViolations: Check for missing 'with sharing' or 'inherited sharing'.
    8. ApexSOQLInjection: Check for dynamic SOQL without String.escapeSingleQuotes.
    9. ApexSuggestUsingNamedCred: Suggest using named credentials for callouts.
    10. ApexXSSFromEmailTemplate: Check for potential XSS vulnerabilities in email templates.
    11. ApexXSSFromURLParam: Check for unescaped URL parameters in UI components.
    
    FORMAT YOUR RESPONSE AS A JSON ARRAY of objects:
    [
      {
        "ruleName": "Security Rule Name",
        "severity": "Critical|High|Medium|Low",
        "componentName": "${name}",
        "componentType": "ApexClass",
        "issue": "Detailed description of the violation",
        "snippet": "The EXACT problematic code snippet from the provided content",
        "recommendation": "A copy-pasteable code fix that resolves the issue",
        "pmdUrl": "Reference URL"
      }
    ]
    
    Return ONLY the JSON array. If no issues are found, return [].`;

    let currentKeyIndex = 0;
    while (currentKeyIndex < apiKeys.length) {
      const apiKey = apiKeys[currentKeyIndex].trim();
      const ai = new GoogleGenAI({ apiKey });

      try {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ parts: [{ text: prompt }] }],
        });
        const text = response.text || "[]";
        
        // Robust JSON extraction
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start !== -1 && end !== -1 && end >= start) {
          const jsonStr = text.substring(start, end + 1);
          return JSON.parse(jsonStr);
        }
        return [];
      } catch (e: any) {
        const isQuotaError = e.message?.includes("quota") || e.message?.includes("429") || e.message?.includes("RESOURCE_EXHAUSTED");
        if (isQuotaError) {
          currentKeyIndex++;
        } else {
          console.warn(`AI Security Analysis failed for ${name}`, e);
          return [];
        }
      }
    }
    return [];
  }

  static async scanPortalSecurity(orgData: SalesforceOrgData, tileId?: string): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];
    
    // Identify Portal Profiles
    const portalProfiles = orgData.profiles.filter(p => 
      p.UserLicense?.Name === 'High Volume Customer Portal' ||
      p.UserLicense?.Name === 'Customer Community Login' ||
      p.UserLicense?.Name === 'Customer Community Plus Login' ||
      p.UserLicense?.Name === 'Partner Community Login' ||
      p.UserLicense?.Name === 'Customer Community Plus' ||
      p.UserLicense?.Name === 'Partner Community' ||
      p.UserLicense?.Name === 'Customer Community' ||
      p.UserLicense?.Name === 'Overage High Volume Customer Portal'
    );

    // Similar logic to Guest but focused on Portal specific risks
    // (e.g., User Management, Sharing Sets)
    
    if (!tileId || tileId === 'user-mgmt') {
      for (const pp of portalProfiles) {
        const metadata = pp as any;
        const userPermissions = metadata.relatedMetadata?.userPermissions || [];
        
        if (userPermissions.some((p: any) => p.name === 'ManageUsers' && p.enabled)) {
          findings.push({
            ruleName: 'PortalUserManagement',
            severity: 'Critical',
            componentName: pp.name,
            componentType: 'Profile',
            issue: 'Portal user has "Manage Users" permission.',
            recommendation: 'Portal users should never have user management capabilities.'
          });
        }
      }
    }

    return findings;
  }


}
