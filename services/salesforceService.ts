import { SalesforceOrgData, SalesforceObject, SalesforceField, SalesforceUser, AuthResponse, GenericMetadata, MetadataCategory, ProxyProvider } from "../types";
import { auth } from "../firebase";

export class SalesforceService {
  private accessToken: string;
  private instanceUrl: string;
  private orgId: string | null = null;
  private useProxy: boolean;
  private proxyProvider: ProxyProvider;
  private ownerUid?: string;
  private refreshConfig?: {
    clientId: string;
    clientSecret: string;
    username?: string;
    password?: string;
    refreshToken?: string;
    onRefresh?: (newToken: string, newInstanceUrl: string) => void;
  };
  private preFetchedValidationRules: any[] = [];
  private preFetchedLayouts: any[] = [];
  private preFetchedFlexiPages: any[] = [];
  private preFetchedAutomation: any[] = [];
  private preFetchedButtons: any[] = [];
  private preFetchedQuickActions: any[] = [];
  private preFetchedAssignments: any[] = [];
  private preFetchedFlexiPageAssignments: any[] = [];
  private preFetchedFields: Record<string, any[]> = {};
  private preFetchedClasses: Record<string, string> = {};
  private preFetchedPages: Record<string, string> = {};
  private preFetchedCustomPermissions: Record<string, string> = {};

  constructor(accessToken: string, instanceUrl: string, useProxy: boolean = true, proxyProvider: ProxyProvider = 'allorigins', refreshConfig?: {
    clientId: string;
    clientSecret: string;
    username?: string;
    password?: string;
    refreshToken?: string;
    onRefresh?: (newToken: string, newInstanceUrl: string) => void;
  }) {
    this.accessToken = accessToken;
    this.instanceUrl = instanceUrl;
    this.useProxy = useProxy;
    this.proxyProvider = proxyProvider;
    this.refreshConfig = refreshConfig;
    this.ownerUid = auth.currentUser?.uid;
  }

  public setOrgId(id: string) {
    this.orgId = id;
  }

  public getOrgId(): string | null {
    return this.orgId;
  }

  private getProxyUrl(target: string): string {
    if (!this.useProxy || this.proxyProvider === 'none') return target;
    
    switch (this.proxyProvider) {
      case 'corsproxy':
        return `https://corsproxy.io/?${encodeURIComponent(target)}`;
      case 'allorigins':
        return `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`;
      case 'codetabs':
        return `https://api.codetabs.com/v1/proxy?url=${encodeURIComponent(target)}`;
      default:
        return target;
    }
  }

  public async request(endpoint: string, isTooling: boolean = false, method: string = 'GET', body?: any, retryCount: number = 0, contentType: string = 'application/json'): Promise<any> {
    const apiPath = isTooling ? '/services/data/v60.0/tooling' : '/services/data/v60.0';
    const targetUrl = endpoint.startsWith('http') 
      ? endpoint 
      : endpoint.startsWith('/services/data')
        ? `${this.instanceUrl}${endpoint}`
        : `${this.instanceUrl}${apiPath}${endpoint}`;
    
    try {
      let response: Response;

      if (this.useProxy) {
        response = await fetch('/api/sf/proxy', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: targetUrl,
            method: method,
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
              'Content-Type': contentType
            },
            body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
            ownerUid: this.ownerUid
          })
        });
      } else {
        // Direct Mode
        response = await fetch(targetUrl, {
          method: method,
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': contentType
          },
          body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Salesforce API Error (${response.status}): ${errorText.substring(0, 200)}`;
        
        // Only log as error if it's not a 400 (which might be expected for feature probing)
        const isCommonWarning = response.status === 400 || response.status === 404;
        const lowErrorText = errorText.toLowerCase();
        const isUnsupportedObject = lowErrorText.includes('not supported') || lowErrorText.includes('invalid_type') || lowErrorText.includes('not_found');

        if (response.status >= 500) {
          console.error(`❌ Salesforce Error (${response.status}) on ${endpoint}: ${errorText}`);
        } else if (!isCommonWarning || !isUnsupportedObject) {
          console.warn(`⚠️ Salesforce Warning (${response.status}) on ${endpoint}: ${errorText}`);
        }

        try {
          const errorJson = JSON.parse(errorText);
          if (Array.isArray(errorJson) && errorJson.length > 0 && errorJson[0].errorCode) {
            errorMessage = `Salesforce API Error (${response.status}): ${errorJson[0].message}`;
          }
        } catch (e) {
          // Not a JSON error
        }

        // Retry logic for 500 errors or rate limits (429) - max 2 retries
        if ((response.status === 500 || response.status === 429) && retryCount < 2) {
          const delay = Math.pow(2, retryCount) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.request(endpoint, isTooling, method, body, retryCount + 1, contentType);
        }

        // Handle 401 Unauthorized - Session Expired
        if (response.status === 401 && this.refreshConfig && retryCount < 1) {
          console.log(`🔄 Session expired (401) on ${endpoint}. Attempting to refresh token...`);
          try {
            const authResponse = await fetch('/api/sf/target/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                instanceUrl: this.instanceUrl,
                clientId: this.refreshConfig.clientId,
                clientSecret: this.refreshConfig.clientSecret,
                username: this.refreshConfig.username,
                password: this.refreshConfig.password,
                refreshToken: this.refreshConfig.refreshToken
              })
            });

            const authData = await authResponse.json();
            if (authResponse.ok && authData.access_token) {
              this.accessToken = authData.access_token;
              if (authData.instance_url) {
                this.instanceUrl = authData.instance_url;
              }
              console.log("✅ Token refreshed successfully. Retrying original request...");
              
              if (this.refreshConfig.onRefresh) {
                this.refreshConfig.onRefresh(this.accessToken, this.instanceUrl);
              }

              // Retry the original request with the new token
              return this.request(endpoint, isTooling, method, body, retryCount + 1, contentType);
            } else {
              console.error("❌ Token refresh failed:", authData);
              // If refresh failed, we throw the original 401 error
              throw new Error(`Session expired and refresh failed: ${JSON.stringify(authData)}`);
            }
          } catch (refreshErr) {
            console.error("❌ Error during token refresh:", refreshErr);
            throw refreshErr;
          }
        }

        throw new Error(errorMessage);
      }

      if (response.status === 204) return null;
      
      const text = await response.text();
      if (!text) return null;

      try {
        return JSON.parse(text);
      } catch (e) {
        return text;
      }
    } catch (err: any) {
      if (retryCount < 3 && (err.message.includes('fetch') || err.name === 'TypeError' || err.message.includes('500') || err.message.includes('403'))) {
        const delay = Math.pow(2, retryCount) * 2000; // Increased delay
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.request(endpoint, isTooling, method, body, retryCount + 1);
      }
      throw err;
    }
  }

  async query(soql: string, isTooling: boolean = false): Promise<any> {
    return this.request(`/query?q=${encodeURIComponent(soql)}`, isTooling);
  }

  async queryAll(soql: string, isTooling: boolean = false, onProgress?: (count: number, total: number) => void): Promise<any[]> {
    let allRecords: any[] = [];
    let response = await this.query(soql, isTooling);
    
    if (!response) return [];
    
    allRecords = [...allRecords, ...(response.records || [])];
    const totalSize = response.totalSize || allRecords.length;
    
    if (onProgress) onProgress(allRecords.length, totalSize);

    let nextUrl = response.nextRecordsUrl;
    while (nextUrl) {
      response = await this.request(nextUrl, isTooling);
      if (!response) break;
      
      allRecords = [...allRecords, ...(response.records || [])];
      nextUrl = response.nextRecordsUrl;
      
      if (onProgress) onProgress(allRecords.length, totalSize);
    }

    return allRecords;
  }

  async revokeToken(): Promise<void> {
    try {
      await fetch('/api/sf/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: this.accessToken,
          instanceUrl: this.instanceUrl
        })
      });
    } catch (e) {
      console.warn("Failed to revoke token", e);
    }
  }

  async createBulkQueryJob(query: string): Promise<string> {
    const res = await this.request('/jobs/query', false, 'POST', {
      operation: 'query',
      query: query
    });
    return res.id;
  }

  async getBulkQueryJobStatus(jobId: string): Promise<string> {
    const res = await this.request(`/jobs/query/${jobId}`, false, 'GET');
    return res.state;
  }

  async getBulkQueryJobResults(jobId: string): Promise<any[]> {
    const res = await this.request(`/jobs/query/${jobId}/results`, false, 'GET');
    // Bulk API V2 returns CSV, but our request helper handles JSON if possible.
    // If it's CSV, we might need a parser, but for now let's assume JSON or handled by proxy.
    return Array.isArray(res) ? res : (res.records || []);
  }

  async createBulkIngestJob(objectName: string, operation: 'insert' | 'update' | 'upsert' | 'delete', externalIdFieldName?: string): Promise<string> {
    const body: any = {
      object: objectName,
      operation: operation,
      contentType: 'CSV',
      lineEnding: 'LF'
    };
    if (externalIdFieldName) {
      body.externalIdFieldName = externalIdFieldName;
    }
    const res = await this.request('/jobs/ingest', false, 'POST', body);
    return res.id;
  }

  async uploadBulkData(jobId: string, csvData: string): Promise<void> {
    // Bulk API V2 ingest data upload requires text/csv content type
    await this.request(`/jobs/ingest/${jobId}/batches`, false, 'PUT', csvData, 0, 'text/csv');
  }

  async closeBulkIngestJob(jobId: string): Promise<void> {
    await this.request(`/jobs/ingest/${jobId}`, false, 'PATCH', { state: 'UploadComplete' });
  }

  async getBulkIngestJobStatus(jobId: string): Promise<any> {
    return this.request(`/jobs/ingest/${jobId}`, false, 'GET');
  }

  async getBulkIngestJobResults(jobId: string, type: 'successfulResults' | 'failedResults' | 'unprocessedRecords'): Promise<string> {
    return this.request(`/jobs/ingest/${jobId}/${type}`, false, 'GET');
  }

  async describeSObject(objName: string): Promise<any> {
    return this.request(`/sobjects/${objName}/describe`);
  }

  async fetchGuestUserContext(): Promise<any[]> {
    try {
      // 1. Fetch active guest users
      const userQuery = `SELECT Id, Name, ProfileId, Profile.Name, IsActive 
                         FROM User 
                         WHERE UserType = 'Guest' AND IsActive = true`;
      const userData = await this.request(`/query?q=${encodeURIComponent(userQuery)}`);
      const users = userData.records || [];

      if (users.length === 0) return [];

      const guestUserIds = users.map((u: any) => u.Id);

      // 2. Fetch sites to link them
      const sites = await this.fetchCategory('sites');
      const siteMap: Record<string, string> = {};
      sites.forEach((s: any) => {
        if (s.GuestUserId) {
          const id18 = s.GuestUserId;
          const id15 = id18.substring(0, 15);
          siteMap[id18] = s.name || s.label;
          siteMap[id15] = s.name || s.label;
        }
      });

      // 3. Fetch permission set assignments
      const psaQuery = `SELECT PermissionSetId, PermissionSet.Name, PermissionSet.Label, PermissionSet.IsOwnedByProfile, AssigneeId
                        FROM PermissionSetAssignment 
                        WHERE AssigneeId IN (${guestUserIds.map((id: string) => `'${id}'`).join(',')})
                        AND PermissionSet.IsOwnedByProfile = false`;
      const psaData = await this.request(`/query?q=${encodeURIComponent(psaQuery)}`);
      const assignments = psaData.records || [];

      return users.map((u: any) => ({
        userId: u.Id,
        userName: u.Name,
        profileId: u.ProfileId,
        profileName: u.Profile.Name,
        siteName: siteMap[u.Id] || siteMap[u.Id.substring(0, 15)] || 'Unknown Site',
        assignedPermSets: assignments
          .filter((a: any) => a.AssigneeId === u.Id)
          .map((a: any) => ({
            Id: a.PermissionSetId,
            Name: a.PermissionSet.Name,
            Label: a.PermissionSet.Label,
            IsOwnedByProfile: a.PermissionSet.IsOwnedByProfile
          })),
        selectedPermSetIds: []
      }));
    } catch (e) {
      console.error("Failed to fetch Guest User Context", e);
      return [];
    }
  }

  async fetchPortalUserContexts(profileNames: string[]): Promise<any[]> {
    if (!profileNames || profileNames.length === 0) return [];
    try {
      const userQuery = `SELECT Id, Name, ProfileId, Profile.Name 
                         FROM User 
                         WHERE IsActive = true AND Profile.Name IN (${profileNames.map(name => `'${name}'`).join(',')}) 
                         LIMIT 500`;
      const userData = await this.request(`/query?q=${encodeURIComponent(userQuery)}`);
      let users = userData.records || [];

      // We only need ONE representative user per portal profile to act as a simulation context
      const profileToUser = new Map<string, any>();
      users.forEach((u: any) => {
        if (u.Profile && u.Profile.Name && !profileToUser.has(u.Profile.Name)) {
          profileToUser.set(u.Profile.Name, u);
        }
      });
      
      // Extract unique user records
      const representativeUsers = Array.from(profileToUser.values());

      if (representativeUsers.length === 0) return [];

      const userIds = representativeUsers.map((u: any) => u.Id);

      // Fetch permission set assignments
      const psaQuery = `SELECT PermissionSetId, PermissionSet.Name, PermissionSet.Label, PermissionSet.IsOwnedByProfile, AssigneeId
                        FROM PermissionSetAssignment 
                        WHERE AssigneeId IN (${userIds.map((id: string) => `'${id}'`).join(',')})
                        AND PermissionSet.IsOwnedByProfile = false`;
      const psaData = await this.request(`/query?q=${encodeURIComponent(psaQuery)}`);
      const assignments = psaData.records || [];

      return representativeUsers.map((u: any) => ({
        userId: u.Id,
        userName: u.Name,
        profileId: u.ProfileId,
        profileName: u.Profile.Name,
        siteName: 'Portal User',
        selectedPermSetIds: assignments
          .filter((a: any) => a.AssigneeId === u.Id)
          .map((a: any) => ({
            Id: a.PermissionSetId,
            Name: a.PermissionSet.Name,
            Label: a.PermissionSet.Label,
            IsOwnedByProfile: a.PermissionSet.IsOwnedByProfile
          }))
      }));
    } catch (e) {
      console.error("Failed to fetch Portal User Context", e);
      return [];
    }
  }

  async getChildRelationships(objectApiName: string): Promise<any[]> {
    try {
      const describe = await this.describeSObject(objectApiName);
      return (describe.childRelationships || []).map((rel: any) => ({
        ChildSobject: rel.childSObject,
        Field: rel.field,
        RelationshipName: rel.relationshipName
      }));
    } catch (e) {
      console.error(`Failed to fetch child relationships for ${objectApiName}:`, e);
      return [];
    }
  }

  async fetchFullMetadata(type: string, id: string): Promise<any> {
    const endpoint = `/sobjects/${type}/${id}`;
    return this.request(endpoint, true);
  }

  async fetchLargeDataset(query: string): Promise<any[]> {
    const jobId = await this.createBulkQueryJob(query);
    
    let state = 'Open';
    while (state !== 'JobComplete' && state !== 'Failed') {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds between polls
      state = await this.getBulkQueryJobStatus(jobId);
    }

    if (state === 'Failed') {
      throw new Error('Bulk API Job failed');
    }

    return await this.getBulkQueryJobResults(jobId);
  }

  async getUserInfo(identityUrl: string): Promise<SalesforceUser> {
    const data = await this.request(identityUrl);
    return {
      name: data.display_name,
      title: data.user_type || 'User',
      username: data.username
    };
  }

  async fetchCategory(category: MetadataCategory): Promise<any[]> {
    let query = '';
    let isTooling = false;

    switch(category) {
      case 'objects':
        query = "SELECT QualifiedApiName, Label FROM EntityDefinition WHERE IsQueryable = true AND IsIdEnabled = true AND Label != null ORDER BY Label LIMIT 50000";
        const objData = await this.request(`/query?q=${encodeURIComponent(query)}`);
        
        return (objData?.records || [])
          .filter((r: any) => {
            if (!r.Label) return false;
            const lbl = r.Label.toLowerCase();
            if (lbl.includes('propertyfile') || lbl.includes('standardfeedlabel') || lbl.includes('standardlabel')) return false;
            return true;
          })
          .map((r: any) => ({
            id: r.QualifiedApiName,
            name: r.QualifiedApiName,
            label: r.Label,
            isCustom: r.QualifiedApiName.endsWith('__c'),
            fields: []
          }));

      case 'classes': 
        query = "SELECT Id, Name, ApiVersion, Status, LengthWithoutComments FROM ApexClass WHERE ManageableState = 'unmanaged' LIMIT 5000"; 
        isTooling = true; 
        break;
      case 'triggers': query = "SELECT Id, Name, Status, TableEnumOrId FROM ApexTrigger LIMIT 5000"; isTooling = true; break;
      case 'vfPages': query = "SELECT Id, Name, ApiVersion FROM ApexPage LIMIT 5000"; isTooling = true; break;
      case 'lwcs': query = "SELECT Id, DeveloperName, MasterLabel FROM LightningComponentBundle LIMIT 5000"; isTooling = true; break;
      case 'flows': 
        query = "SELECT Id, MasterLabel, Status, ProcessType, VersionNumber FROM Flow WHERE ProcessType != 'Workflow' LIMIT 5000"; 
        isTooling = true; 
        break;
      case 'processBuilders': 
        query = "SELECT Id, MasterLabel, Status, VersionNumber FROM Flow WHERE ProcessType = 'Workflow' LIMIT 5000"; 
        isTooling = true; 
        break;
      case 'permissionSets': query = "SELECT Id, Name, Label, Description FROM PermissionSet LIMIT 5000"; break;
      case 'profiles': query = "SELECT Id, Name, Description, UserLicense.Name, UserLicenseId FROM Profile LIMIT 5000"; break;
      case 'userManagementSettings':
        // Fetch UserManagementSettings via Tooling API if possible, or Organization
        try {
          const orgData = await this.request('/query?q=' + encodeURIComponent('SELECT Id, Name, DefaultAccountAccess, DefaultContactAccess, DefaultOpportunityAccess, DefaultLeadAccess, DefaultCaseAccess, DefaultCalendarAccess, DefaultPricebookAccess FROM Organization LIMIT 1'));
          return [{
            id: 'user_mgmt_meta',
            name: 'User Management Settings',
            details: JSON.stringify(orgData.records?.[0] || {})
          }];
        } catch (e) {
          console.warn("Failed to fetch UserManagementSettings", e);
          return [];
        }
      case 'tabs': query = "SELECT DurableId, Label, IsCustom FROM TabDefinition LIMIT 5000"; break;
      case 'layouts': query = "SELECT Id, Name, TableEnumOrId FROM Layout LIMIT 5000"; isTooling = true; break;
      case 'recordTypes': query = "SELECT Id, Name, DeveloperName, SobjectType FROM RecordType LIMIT 5000"; break;
      case 'emailTemplates': query = "SELECT Id, Name, DeveloperName, TemplateType FROM EmailTemplate LIMIT 5000"; break;
      case 'staticResources': query = "SELECT Id, Name, ContentType FROM StaticResource LIMIT 5000"; break;
      case 'labels': query = "SELECT Id, Name, Value, MasterLabel FROM CustomLabel LIMIT 5000"; isTooling = true; break;
      case 'workflowRules': query = "SELECT Id, Name, TableEnumOrId FROM WorkflowRule LIMIT 5000"; isTooling = true; break;
      case 'customMetadata':
        query = "SELECT QualifiedApiName, MasterLabel FROM EntityDefinition WHERE QualifiedApiName LIKE '%__mdt' LIMIT 5000";
        break;
      case 'validationRules':
        query = "SELECT Id, ValidationName, EntityDefinitionId, Active, Description FROM ValidationRule LIMIT 2000";
        break;
      case 'flexiPages':
        query = "SELECT Id, DeveloperName, MasterLabel, Type, EntityDefinitionId FROM FlexiPage LIMIT 5000";
        isTooling = true;
        break;
      case 'dashboards':
        query = "SELECT Id, Title, DeveloperName, FolderName FROM Dashboard LIMIT 5000";
        break;
      case 'quickActions':
        query = "SELECT Id, DeveloperName, MasterLabel, SobjectType FROM QuickActionDefinition LIMIT 5000";
        isTooling = true;
        break;
      case 'buttons':
        query = "SELECT Id, Name, DisplayType, LinkType, EntityDefinitionId FROM WebLink LIMIT 5000";
        isTooling = true;
        break;
      case 'compactLayouts':
        query = "SELECT Id, DeveloperName, TableEnumOrId FROM CompactLayout LIMIT 5000";
        isTooling = true;
        break;
      case 'sharingSettings':
        query = `SELECT QualifiedApiName, Label, InternalSharingModel, ExternalSharingModel 
                 FROM EntityDefinition 
                 WHERE IsQueryable = true 
                 AND IsIdEnabled = true 
                 AND IsCustomSetting = false
                 AND IsCustomizable = true
                 AND Label != null 
                 ORDER BY Label`;
        const ssRecords = await this.queryAll(query);
        return ssRecords
          .filter((r: any) => {
            const name = r.QualifiedApiName || '';
            // Keep custom objects
            if (name.endsWith('__c')) return true;
            // Exclude metadata types
            if (name.includes('__')) return false;
            // For standard objects, only keep ones with actual sharing models set
            // (tooling/setup objects usually have null or ReadWrite fixed sharing)
            return r.InternalSharingModel != null && r.ExternalSharingModel != null;
          })
          .map((r: any) => ({
            id: r.QualifiedApiName,
            name: r.QualifiedApiName,
            label: r.Label,
            internalSharingModel: r.InternalSharingModel,
            externalSharingModel: r.ExternalSharingModel
          }));
      case 'licenses':
        query = "SELECT Id, Name, TotalLicenses, UsedLicenses, Status FROM UserLicense LIMIT 100";
        break;
      case 'objectLimits':
        return [];
      case 'approvalProcesses':
        return [];
      case 'sites':
        query = "SELECT Id, Name, MasterLabel, Status, SiteType, GuestRecordDefaultOwnerId, GuestUserId, GuestUser.ProfileId, GuestUser.Profile.Name, Subdomain, UrlPathPrefix FROM Site LIMIT 100";
        break;
      case 'networks':
        try {
          const networkData = await this.request('/query?q=' + encodeURIComponent("SELECT Id, Name, Status, UrlPathPrefix, SelfRegProfileId FROM Network LIMIT 100"));
          return (networkData?.records || []).map((r: any) => ({
            id: r.Id,
            name: r.Name,
            status: r.Status,
            selfRegProfileId: r.SelfRegProfileId,
            optionsShowNicknames: false
          }));
        } catch (e) {
          console.warn("Network object not supported or fields invalid", e);
          return [];
        }
      case 'portals':
        // Portal object is unsupported in this org.
        return [];
      case 'automation':
        // Fetching extra settings for security analysis
        try {
          const [orgSettings, networkSettings, securitySettings, sharingSettingsMeta, userMgmtSettings, epimFieldSet, epimFieldSetMembers, classes, pages, customPerms] = await Promise.all([
            this.request('/query?q=' + encodeURIComponent('SELECT Id, Name, DefaultAccountAccess, DefaultContactAccess, DefaultOpportunityAccess, DefaultLeadAccess, DefaultCaseAccess, DefaultCalendarAccess, DefaultPricebookAccess FROM Organization LIMIT 1')).catch(() => ({ records: [] })),
            this.request('/query?q=' + encodeURIComponent('SELECT Id, Name, Status, UrlPathPrefix, SelfRegProfileId FROM Network LIMIT 100')).catch(() => ({ records: [] })),
            this.request('/query?q=' + encodeURIComponent('SELECT Metadata FROM SecuritySettings'), true).catch(() => null),
            this.request('/query?q=' + encodeURIComponent('SELECT Metadata FROM SharingSettings'), true).catch(() => null),
            this.request('/query?q=' + encodeURIComponent('SELECT Metadata FROM UserManagementSettings'), true).catch(() => null),
            this.request('/tooling/query?q=' + encodeURIComponent("SELECT Metadata, DeveloperName, MasterLabel FROM FieldSet WHERE EntityDefinitionId = 'User' AND DeveloperName = 'PersonalInfo_EPIM'"), true).catch(() => null),
            this.request('/tooling/query?q=' + encodeURIComponent("SELECT Id, FieldPath, Label FROM FieldSetMember WHERE FieldSet.DeveloperName = 'PersonalInfo_EPIM'"), true).catch(() => ({ records: [] })),
            this.queryAll("SELECT Id, Name FROM ApexClass"),
            this.queryAll("SELECT Id, Name FROM ApexPage"),
            this.queryAll("SELECT Id, DeveloperName FROM CustomPermission")
          ]);
          classes.forEach((c: any) => this.preFetchedClasses[c.Id.substring(0, 15)] = c.Name);
          pages.forEach((p: any) => this.preFetchedPages[p.Id.substring(0, 15)] = p.Name);
          customPerms.forEach((cp: any) => this.preFetchedCustomPermissions[cp.Id.substring(0, 15)] = cp.DeveloperName);

          return [{
            id: 'security_meta',
            name: 'Security Metadata',
            details: JSON.stringify({ 
              orgSettings, networkSettings, securitySettings, sharingSettingsMeta, userMgmtSettings, epimFieldSet, epimFieldSetMembers,
              classes, pages, customPerms
            })
          }];
        } catch (e) {
          console.warn("Failed to fetch security metadata", e);
          return [];
        }
    }

    let data: any;
    try {
      data = await this.request(`/query?q=${encodeURIComponent(query)}`, isTooling);
    } catch (e: any) {
      console.error(`Failed to fetch category ${category}`, e);
      // For some categories, we can just return empty instead of failing
      if (['layouts', 'compactLayouts', 'quickActions', 'buttons', 'validationRules'].includes(category)) {
        return [];
      }
      throw e;
    }
    
    let records = (data?.records || []).map((r: any) => ({
      id: r.Id || r.id || r.DurableId || r.QualifiedApiName || r.EntityDefinitionId || r.Name || r.name,
      name: r.Name || r.name || r.QualifiedApiName || r.DeveloperName || r.MasterLabel || r.ValidationName || r.Title || r.DurableId || r.Type,
      label: r.Label || r.label || r.MasterLabel || r.Title || r.ValidationName || r.Name || r.name || r.DeveloperName || r.Type,
      type: r.ProcessType || r.SobjectType || r.TemplateType || r.ContentType || r.TableEnumOrId || r.Type || r.EntityDefinitionId || r.FolderName,
      status: r.Status || r.status || (r.Active !== undefined ? (r.Active ? 'Active' : 'Inactive') : undefined),
      details: r.ApiVersion ? `API v${r.ApiVersion}` : (r.TotalLicenses ? `Used: ${r.UsedLicenses}/${r.TotalLicenses}` : r.Value || r.value),
      version: r.VersionNumber || r.versionNumber,
      apiVersion: r.ApiVersion || r.apiVersion,
      size: r.LengthWithoutComments || r.lengthWithoutComments,
      UserType: r.UserType || r.userType,
      UserLicense: r.UserLicense || r.userLicense,
      ErrorMessage: r.ErrorMessage || r.errorMessage || r.Metadata?.errorMessage,
      ErrorDisplayField: r.ErrorDisplayField || r.errorDisplayField || r.Metadata?.errorDisplayField,
      ErrorConditionFormula: r.ErrorConditionFormula || r.errorConditionFormula || r.Metadata?.errorConditionFormula
    }));

    if (category === 'flows' || category === 'processBuilders') {
      const latestMap = new Map<string, any>();
      records.forEach((rec: any) => {
        const existing = latestMap.get(rec.label);
        if (!existing || rec.version > existing.version) {
          latestMap.set(rec.label, rec);
        }
      });
      records = Array.from(latestMap.values());
    }

    return records;
  }

  private escapeXml(unsafe: string): string {
    if (!unsafe) return "";
    return unsafe.replace(/[<>&"']/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '"': return '&quot;';
        case "'": return '&apos;';
        default: return c;
      }
    });
  }

  private async resolveMetadataId(category: MetadataCategory, id: string): Promise<string> {
    if (['classes', 'triggers', 'vfPages', 'lwcs'].includes(category) && !/^([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/.test(id)) {
      try {
        let table = '';
        let nameField = 'Name';
        
        switch(category) {
          case 'classes': table = 'ApexClass'; break;
          case 'triggers': table = 'ApexTrigger'; break;
          case 'vfPages': table = 'ApexPage'; break;
          case 'lwcs': 
            table = 'LightningComponentBundle'; 
            nameField = 'DeveloperName';
            break;
        }

        let query = `SELECT Id FROM ${table} WHERE ${nameField} = '${id}' LIMIT 1`;
        
        // Handle namespace prefix if present in the ID string
        if (id.includes('__')) {
          const parts = id.split('__');
          if (parts.length === 2) {
            query = `SELECT Id FROM ${table} WHERE ${nameField} = '${parts[1]}' AND NamespacePrefix = '${parts[0]}' LIMIT 1`;
          }
        }

        let res = await this.request(`/query?q=${encodeURIComponent(query)}`, true);
        if (res.records && res.records.length > 0) {
          return res.records[0].Id;
        } else {
          // Fallback: try case-insensitive or developer name
          const fallbackQuery = `SELECT Id FROM ${table} WHERE ${nameField} LIKE '${id}' LIMIT 1`;
          res = await this.request(`/query?q=${encodeURIComponent(fallbackQuery)}`, true);
          if (res.records && res.records.length > 0) {
            return res.records[0].Id;
          }
        }
      } catch (e) {
        console.warn(`Failed to resolve ID for ${category} name: ${id}`, e);
      }
    }
    return id;
  }

  async deployMetadata(category: MetadataCategory, id: string, content: string, lwcFiles?: { html?: string, js?: string, css?: string }): Promise<void> {
    let endpoint = '';
    let isTooling = true;
    let body: any = {};

    // Resolve ID if it's a name
    id = await this.resolveMetadataId(category, id);

    switch(category) {
      case 'classes':
        endpoint = `/sobjects/ApexClass/${id}`;
        body = { Body: content };
        break;
      case 'triggers':
        endpoint = `/sobjects/ApexTrigger/${id}`;
        body = { Body: content };
        break;
      case 'vfPages':
        endpoint = `/sobjects/ApexPage/${id}`;
        body = { Markup: content };
        break;
      case 'lwcs':
        if (!/^([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/.test(id)) {
          throw new Error(`Could not resolve Lightning Component Bundle for name: ${id}`);
        }
        // For LWCs, we need to update individual resources
        const resources = await this.request(`/query?q=SELECT+Id,FilePath+FROM+LightningComponentResource+WHERE+LightningComponentBundleId='${id}'`, true);
        for (const res of resources.records) {
          let newSource = '';
          if (res.FilePath.endsWith('.html') && lwcFiles?.html) newSource = lwcFiles.html;
          if (res.FilePath.endsWith('.js') && lwcFiles?.js) newSource = lwcFiles.js;
          if (res.FilePath.endsWith('.css') && lwcFiles?.css) newSource = lwcFiles.css;

          if (newSource) {
            await this.request(`/sobjects/LightningComponentResource/${res.Id}`, true, 'PATCH', { Source: newSource });
          }
        }
        return;
      case 'validationRules':
        endpoint = `/sobjects/ValidationRule/${id}`;
        try {
          body = { Metadata: JSON.parse(content) };
        } catch (e) {
          throw new Error("Validation Rule deployment requires JSON format in this version.");
        }
        break;
      case 'flexiPages':
        endpoint = `/sobjects/FlexiPage/${id}`;
        try {
          body = { Metadata: JSON.parse(content) };
        } catch (e) {
          throw new Error("FlexiPage deployment requires JSON format in this version.");
        }
        break;
      case 'permissionSets':
        endpoint = `/sobjects/PermissionSet/${id}`;
        throw new Error("Deployment of Permission Sets via XML is not supported in this version. Please use the Metadata API.");
      case 'profiles':
        endpoint = `/sobjects/Profile/${id}`;
        throw new Error("Deployment of Profiles via XML is not supported in this version. Please use the Metadata API.");
      case 'quickActions':
        endpoint = `/sobjects/QuickActionDefinition/${id}`;
        // QuickActions often need Metadata object
        try {
          body = { Metadata: JSON.parse(content) };
        } catch (e) {
          throw new Error("QuickAction content must be valid JSON for deployment.");
        }
        break;
      case 'buttons':
        endpoint = `/sobjects/WebLink/${id}`;
        try {
          body = { Metadata: JSON.parse(content) };
        } catch (e) {
          throw new Error("Button content must be valid JSON for deployment.");
        }
        break;
      default:
        throw new Error(`Deployment not implemented for category: ${category}`);
    }

    await this.request(endpoint, isTooling, 'PATCH', body);
  }

  private objectToXml(obj: any, rootTag: string): string {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<${rootTag} xmlns="http://soap.sforce.com/2006/04/metadata">\n`;
    
    const processNode = (node: any, indent: string): string => {
      let nodeXml = '';
      for (const key in node) {
        if (node[key] === null || node[key] === undefined) continue;
        
        if (Array.isArray(node[key])) {
          node[key].forEach((item: any) => {
            if (typeof item === 'object') {
              nodeXml += `${indent}<${key}>\n${processNode(item, indent + '    ')}${indent}</${key}>\n`;
            } else {
              nodeXml += `${indent}<${key}>${this.escapeXml(String(item))}</${key}>\n`;
            }
          });
        } else if (typeof node[key] === 'object') {
          nodeXml += `${indent}<${key}>\n${processNode(node[key], indent + '    ')}${indent}</${key}>\n`;
        } else {
          nodeXml += `${indent}<${key}>${this.escapeXml(String(node[key]))}</${key}>\n`;
        }
      }
      return nodeXml;
    };

    xml += processNode(obj, '    ');
    xml += `</${rootTag}>`;
    return xml;
  }

  async fetchMetadataContent(category: MetadataCategory, id: string, preFetched?: { 
    validationRules: any[], 
    layouts: any[], 
    flexiPages: any[],
    automation: any[],
    buttons: any[],
    quickActions: any[]
  }): Promise<{ 
    content: string; 
    metaXml?: string; 
    lwcFiles?: { html?: string; js?: string; css?: string }; 
    objectPermissions?: any[];
    fieldPermissions?: any[];
    assignedUsers?: any[];
    objectLimits?: any[];
    recordTypeUsage?: any[];
    automation?: any[];
    quickActions?: any[];
    buttons?: any[];
    validationRules?: any[];
    layouts?: any[];
    flexiPages?: any[];
    compactLayouts?: any[];
    allAssignments?: any[];
    allFlexiPageAssignments?: any[];
    fields?: any[];
    Metadata?: any;
    UserType?: string;
    UserLicense?: any;
    ErrorMessage?: string;
    ErrorConditionFormula?: string;
    Active?: boolean;
    apiVersion?: string | number;
  }> {
    if (!id) throw new Error(`Missing ID for metadata category: ${category}`);
    let endpoint = '';
    let isTooling = false;
    let content = '';
    let metaXml = '';
    let lwcFiles: { html?: string; js?: string; css?: string } | undefined;
    let data: any;

    // Resolve ID if it's a name
    id = await this.resolveMetadataId(category, id);

    if (category === 'lwcs') {
      if (!/^([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/.test(id)) {
        throw new Error(`Could not resolve Lightning Component Bundle for name: ${id}`);
      }
      const resources = await this.request(`/query?q=SELECT+FilePath,Format,Source+FROM+LightningComponentResource+WHERE+LightningComponentBundleId='${id}'`, true);
      lwcFiles = {};
      resources.records.forEach((res: any) => {
        if (res.FilePath.endsWith('.html')) lwcFiles!.html = res.Source;
        if (res.FilePath.endsWith('.js')) lwcFiles!.js = res.Source;
        if (res.FilePath.endsWith('.css')) lwcFiles!.css = res.Source;
      });
      // Construct comprehensive content for LLM
      content = '';
      if (lwcFiles.js) content += `/* --- ${id}.js --- */\n${lwcFiles.js}\n\n`;
      if (lwcFiles.html) content += `<!-- --- ${id}.html --- -->\n${lwcFiles.html}\n\n`;
      if (lwcFiles.css) content += `/* --- ${id}.css --- */\n${lwcFiles.css}\n`;
      
      if (!content) content = '';
    }

    switch(category) {
      case 'classes':
        // Fallback for names: if resolution failed, try querying Body directly
        if (!/^([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/.test(id)) {
          try {
            const res = await this.request(`/query?q=${encodeURIComponent(`SELECT Body, ApiVersion, Status, LengthWithoutComments FROM ApexClass WHERE Name = '${id}' LIMIT 1`)}`, true);
            if (res.records && res.records.length > 0) {
              return {
                content: res.records[0].Body || '',
                Active: res.records[0].Status === 'Active',
                apiVersion: res.records[0].ApiVersion
              };
            }
          } catch (e) {
            console.warn(`Direct Body query failed for ${id}`, e);
          }
        }
        endpoint = `/sobjects/ApexClass/${id}`;
        isTooling = true;
        break;
      case 'triggers':
        if (!/^([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/.test(id)) {
          try {
            const res = await this.request(`/query?q=${encodeURIComponent(`SELECT Body, ApiVersion, Status FROM ApexTrigger WHERE Name = '${id}' LIMIT 1`)}`, true);
            if (res.records && res.records.length > 0) {
              return {
                content: res.records[0].Body || '',
                Active: res.records[0].Status === 'Active',
                apiVersion: res.records[0].ApiVersion
              };
            }
          } catch (e) {
            console.warn(`Direct Body query failed for ${id}`, e);
          }
        }
        endpoint = `/sobjects/ApexTrigger/${id}`;
        isTooling = true;
        break;
      case 'vfPages':
        if (!/^([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/.test(id)) {
          try {
            const res = await this.request(`/query?q=${encodeURIComponent(`SELECT Markup, ApiVersion FROM ApexPage WHERE Name = '${id}' LIMIT 1`)}`, true);
            if (res.records && res.records.length > 0) {
              return {
                content: res.records[0].Markup || '',
                apiVersion: res.records[0].ApiVersion
              };
            }
          } catch (e) {
            console.warn(`Direct Markup query failed for ${id}`, e);
          }
        }
        endpoint = `/sobjects/ApexPage/${id}`;
        isTooling = true;
        break;
      case 'lwcs':
        endpoint = `/sobjects/LightningComponentBundle/${id}`;
        isTooling = true;
        break;
      case 'flows':
      case 'processBuilders':
        if (!/^([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/.test(id)) {
          try {
            const query = `SELECT Id FROM Flow WHERE MasterLabel = '${id}' ORDER BY VersionNumber DESC LIMIT 1`;
            const res = await this.request(`/query?q=${encodeURIComponent(query)}`, true);
            if (res.records && res.records.length > 0) {
              endpoint = `/sobjects/Flow/${res.records[0].Id}`;
            } else {
              // Replace underscores with % for LIKE operator to handle special characters (e.g. ' - ')
              const labelGuess = id.replace(/_+/g, '%');
              const query2 = `SELECT Id FROM Flow WHERE MasterLabel LIKE '${labelGuess}' ORDER BY VersionNumber DESC LIMIT 1`;
              const res2 = await this.request(`/query?q=${encodeURIComponent(query2)}`, true);
              if (res2.records && res2.records.length > 0) {
                endpoint = `/sobjects/Flow/${res2.records[0].Id}`;
              } else {
                endpoint = `/sobjects/Flow/${id}`;
              }
            }
          } catch(e) {
            console.warn(`Query failed for flow ID resolution: ${id}`, e);
            endpoint = `/sobjects/Flow/${id}`;
          }
        } else {
          endpoint = `/sobjects/Flow/${id}`;
        }
        isTooling = true;
        break;
      case 'objects':
        endpoint = `/sobjects/${id}/describe`;
        break;
      case 'layouts':
        if (id.startsWith('00h')) {
          endpoint = `/sobjects/Layout/${id}`;
        } else {
          // If it's a name, we need to find the ID first or use the name-based endpoint if possible
          // For Layouts, the tooling API allows querying by Name
          try {
            // Try searching by FullName or Name
            const query = `SELECT Id FROM Layout WHERE Name = '${id}' OR Name = '${id.split('-').pop()}' OR TableEnumOrId = '${id.split('-')[0]}' LIMIT 1`;
            const res = await this.request(`/query?q=${encodeURIComponent(query)}`, true);
            if (res.records && res.records.length > 0) {
              endpoint = `/sobjects/Layout/${res.records[0].Id}`;
            } else {
              // If we can't find an ID, don't just use the name as ID as it often causes 500s
              // Try to find it via a different query if it's a standard object
              const objName = id.split('-')[0];
              if (objName) {
                const query2 = `SELECT Id FROM Layout WHERE TableEnumOrId = '${objName}' LIMIT 1`;
                const res2 = await this.request(`/query?q=${encodeURIComponent(query2)}`, true);
                if (res2.records && res2.records.length > 0) {
                   endpoint = `/sobjects/Layout/${res2.records[0].Id}`;
                } else {
                   return { content: `Could not find layout ID for ${id}. This object may not have a layout accessible via the Tooling API.` };
                }
              } else {
                return { content: `Could not find layout ID for ${id}.` };
              }
            }
          } catch (e: any) {
             console.warn(`Failed to find layout ID for ${id}`, e);
             return { content: `Layout retrieval failed for ${id}: ${e.message}. This is often due to Salesforce API limitations for certain objects.` };
          }
        }
        isTooling = true;
        break;
      case 'validationRules':
        let vrId = id;
        if (!id.startsWith('03d')) {
          try {
            const query = `SELECT Id FROM ValidationRule WHERE ValidationName = '${id}' LIMIT 1`;
            const res = await this.request(`/query?q=${encodeURIComponent(query)}`, true);
            if (res.records && res.records.length > 0) {
              vrId = res.records[0].Id;
            }
          } catch (e) {
            console.warn(`Failed to find VR ID for ${id}`, e);
          }
        }
        endpoint = `/sobjects/ValidationRule/${vrId}`;
        isTooling = true;
        break;
      case 'flexiPages':
        try {
          const query = `SELECT Metadata FROM FlexiPage WHERE Id = '${id}'`;
          const res = await this.request(`/query?q=${encodeURIComponent(query)}`, true);
          if (res.records && res.records.length > 0) {
            data = res.records[0];
          }
        } catch (e) {
          console.warn(`Tooling query for FlexiPage Metadata failed`, e);
        }
        endpoint = `/sobjects/FlexiPage/${id}`;
        isTooling = true;
        break;
      case 'workflowRules':
        try {
          const query = `SELECT Metadata FROM WorkflowRule WHERE Id = '${id}'`;
          const res = await this.request(`/query?q=${encodeURIComponent(query)}`, true);
          if (res.records && res.records.length > 0) {
            data = res.records[0];
          } else {
            return { content: `Workflow Rule not found or not accessible via Tooling API.` };
          }
        } catch (e) {
          console.warn(`Tooling query for WorkflowRule Metadata failed`, e);
          return { content: `Failed to retrieve Workflow Rule: ${e instanceof Error ? e.message : String(e)}` };
        }
        // We already have the data, no need to set endpoint to /sobjects/WorkflowRule/Id
        // which causes 404s in Tooling API.
        endpoint = '';
        isTooling = true;
        break;
      case 'approvalProcesses':
        endpoint = `/sobjects/ProcessDefinition/${id}`;
        isTooling = true;
        break;
      case 'sharingSettings':
        endpoint = `/sobjects/Organization/${id}`;
        break;
      case 'automation':
        // For our special security meta, we just return the details we already have
        const meta = preFetched?.automation?.find((a: any) => a.id === id);
        return { content: meta?.details || '{}' };
      case 'licenses':
        endpoint = `/sobjects/UserLicense/${id}`;
        break;
      case 'objectLimits':
        return { content: "Object limits are displayed in the summary view." };
      case 'quickActions':
        endpoint = `/sobjects/QuickActionDefinition/${id}`;
        isTooling = true;
        break;
      case 'buttons':
        endpoint = `/sobjects/WebLink/${id}`;
        isTooling = true;
        break;
      case 'compactLayouts':
        endpoint = `/sobjects/CompactLayout/${id}`;
        isTooling = true;
        break;
      case 'profiles':
      case 'permissionSets':
        // Try Tooling API query first to get the Metadata field
        try {
          // If ID looks like a name (no digits or not 15/18 chars), try to find the ID first
          let actualId = id;
          if (id && !/^[a-zA-Z0-9]{15,18}$/.test(id)) {
            console.log(`DEBUG: ID ${id} looks like a name, searching for actual ID...`);
            const entity = category === 'profiles' ? 'Profile' : 'PermissionSet';
            
            // Try exact match first
            let searchRes = await this.request(`/query?q=${encodeURIComponent(`SELECT Id FROM ${entity} WHERE Name = '${id}'`)}`);
            
            // If no match and contains underscores, try replacing with spaces
            if ((!searchRes.records || searchRes.records.length === 0) && id.includes('_')) {
              const spaceName = id.replace(/_/g, ' ');
              console.log(`DEBUG: No match for ${id}, trying with spaces: ${spaceName}`);
              searchRes = await this.request(`/query?q=${encodeURIComponent(`SELECT Id FROM ${entity} WHERE Name = '${spaceName}'`)}`);
            }

            if (searchRes.records && searchRes.records.length > 0) {
              actualId = searchRes.records[0].Id;
              console.log(`DEBUG: Found actual ID: ${actualId}`);
            } else {
              // If still not found, we can't proceed with a name that isn't an ID
              throw new Error(`Could not find Salesforce ID for ${entity} name: ${id}`);
            }
          }

          // Some orgs don't support Metadata column in query for PermissionSet/Profile
          // Include UserLicense for profiles to ensure they are preserved during sync
          const query = category === 'profiles' 
            ? `SELECT Id, UserLicense.Name, UserLicenseId FROM Profile WHERE Id = '${actualId}'`
            : `SELECT Id FROM PermissionSet WHERE Id = '${actualId}'`;
          
          const res = await this.request(`/query?q=${encodeURIComponent(query)}`, true);
          if (res.records && res.records.length > 0) {
            const record = res.records[0];
            // Fetch the full record to get Metadata
            try {
              const fullRecord = await this.request(`/sobjects/${category === 'profiles' ? 'Profile' : 'PermissionSet'}/${actualId}`, true);
              data = {
                ...fullRecord,
                UserLicense: record.UserLicense
              };
            } catch (err: any) {
              console.warn(`Failed to fetch full record for ${category} ${actualId}, using query record`, err);
              data = { ...record };
            }
          }
          
          // Use the actualId for subsequent calls
          id = actualId;
        } catch (e) {
          console.warn(`Tooling fetch for ${category} Metadata failed`, e);
        }
        
        // Fetch permissions and assigned users
        try {
          let parentId = id;
          if (category === 'profiles') {
            const psRes = await this.request(`/query?q=SELECT+Id+FROM+PermissionSet+WHERE+ProfileId='${id}'`);
            if (psRes.records && psRes.records.length > 0) parentId = psRes.records[0].Id;
          }
          
          console.log(`DEBUG: Fetching full permissions for ${category} ${id} (Parent PS: ${parentId})`);
          
          // Fetch all Permissions fields on PermissionSet to include User Permissions in XML
          let permFields: string[] = [];
          try {
            const fieldDefs = await this.request(`/query?q=${encodeURIComponent("SELECT QualifiedApiName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = 'PermissionSet' AND QualifiedApiName LIKE 'Permissions%'")}`, true);
            permFields = (fieldDefs.records || [])
              .map((f: any) => f.QualifiedApiName)
              .filter((name: string) => name !== 'Permissions'); // 'Permissions' is not a column, it's the object prefix
          } catch (e) {
            console.warn("Failed to fetch PermissionSet field definitions", e);
            // Fallback to common ones if dynamic fetch fails
            permFields = ['PermissionsApiEnabled', 'PermissionsViewAllData', 'PermissionsModifyAllData'];
          }

          const [objectPerms, fieldPerms, assignedUsers, setupEntityAccess, tabSettings, psRecord] = await Promise.all([
            this.queryAll(`SELECT SobjectType,PermissionsRead,PermissionsCreate,PermissionsEdit,PermissionsDelete,PermissionsViewAllRecords,PermissionsModifyAllRecords FROM ObjectPermissions WHERE ParentId='${parentId}'`),
            this.queryAll(`SELECT SobjectType,Field,PermissionsRead,PermissionsEdit FROM FieldPermissions WHERE ParentId='${parentId}'`),
            this.queryAll(`SELECT Assignee.Name,Assignee.Username FROM PermissionSetAssignment WHERE PermissionSetId='${parentId}' LIMIT 100`),
            this.queryAll(`SELECT SetupEntityId,SetupEntityType FROM SetupEntityAccess WHERE ParentId='${parentId}'`).catch(() => []),
            this.queryAll(`SELECT Name, Visibility FROM PermissionSetTabSetting WHERE ParentId='${parentId}'`, true).catch((e) => { console.warn("PermissionSetTabSetting not supported", e); return []; }),
            permFields.length > 0 
              ? this.request(`/query?q=${encodeURIComponent(`SELECT ${permFields.slice(0, 100).join(',')} FROM PermissionSet WHERE Id = '${parentId}'`)}`, true).catch((e) => { console.warn("PermissionSet fields query failed", e); return { records: [] }; })
              : Promise.resolve({ records: [] })
          ]);
          
          if (!data) data = {};
          
          // Construct a comprehensive Metadata object for XML generation
          const metadata: any = data.Metadata || {};
          
          // 1. Object Permissions
          metadata.objectPermissions = objectPerms.map((op: any) => ({
            allowCreate: op.PermissionsCreate,
            allowDelete: op.PermissionsDelete,
            allowEdit: op.PermissionsEdit,
            allowRead: op.PermissionsRead,
            modifyAllRecords: op.PermissionsModifyAllRecords,
            object: op.SobjectType,
            viewAllRecords: op.PermissionsViewAllRecords
          }));
          
          // 2. Field Permissions
          metadata.fieldPermissions = fieldPerms.map((fp: any) => ({
            editable: fp.PermissionsEdit,
            field: fp.Field,
            readable: fp.PermissionsRead
          }));
          
          // 3. Tab Settings
          if (tabSettings && tabSettings.length > 0) {
            metadata.tabVisibilities = tabSettings.map((ts: any) => ({
              tab: ts.Name,
              visibility: ts.Visibility
            }));
          }
          
          // 5. User Permissions
          if (psRecord.records && psRecord.records.length > 0) {
            const ps = psRecord.records[0];
            const userPermissions: any[] = [];
            Object.keys(ps).forEach(key => {
              if (key.startsWith('Permissions') && ps[key] === true) {
                const permName = key.substring(11, 12).toLowerCase() + key.substring(12);
                userPermissions.push({
                  enabled: true,
                  name: permName
                });
              }
            });
            if (userPermissions.length > 0) metadata.userPermissions = userPermissions;
          }
          
          // 6. Apex Class and Page Access
          if (setupEntityAccess && setupEntityAccess.length > 0) {
            const classAccesses: any[] = [];
            const pageAccesses: any[] = [];
            const customPermissions: any[] = [];
            
            setupEntityAccess.forEach((sea: any) => {
              const id15 = sea.SetupEntityId.substring(0, 15);
              if (sea.SetupEntityType === 'ApexClass') {
                classAccesses.push({
                  apexClass: this.preFetchedClasses[id15] || sea.SetupEntityId,
                  enabled: true
                });
              } else if (sea.SetupEntityType === 'ApexPage') {
                pageAccesses.push({
                  apexPage: this.preFetchedPages[id15] || sea.SetupEntityId,
                  enabled: true
                });
              } else if (sea.SetupEntityType === 'CustomPermission') {
                customPermissions.push({
                  enabled: true,
                  name: this.preFetchedCustomPermissions[id15] || sea.SetupEntityId
                });
              }
            });
            
            if (classAccesses.length > 0) metadata.classAccesses = classAccesses;
            if (pageAccesses.length > 0) metadata.pageAccesses = pageAccesses;
            if (customPermissions.length > 0) metadata.customPermissions = customPermissions;
          }

          data.Metadata = metadata;
          data.ObjectPermissions = objectPerms;
          data.FieldPermissions = fieldPerms;
          data.AssignedUsers = assignedUsers;
          data.SetupEntityAccess = setupEntityAccess;
          
          console.log(`DEBUG: Fetched ${objectPerms.length} ObjectPerms and ${fieldPerms.length} FieldPerms for ${id}`);
        } catch (e) {
          console.warn(`Failed to fetch extra details for ${category}`, e);
        }

        if (!data || Object.keys(data).length === 0) {
          endpoint = `/sobjects/${category === 'profiles' ? 'Profile' : 'PermissionSet'}/${id}`;
          isTooling = true;
        }
        break;
      default:
        return { content: "Metadata content retrieval not implemented for this category." };
    }

    if (!data && endpoint) {
      try {
        data = await this.request(endpoint, isTooling);
      } catch (e: any) {
        console.warn(`Failed to fetch metadata content from ${endpoint}`, e);
        if (e.message.includes('404')) {
          return { content: `Resource not found at ${endpoint}. This metadata might not be accessible via the current API version or Tooling API.` };
        }
        return { content: `Failed to retrieve content: ${e.message}. The Salesforce API returned an error for this specific component.` };
      }
    }
    
    if (category === 'objects') {
      let validationRules: any[] = [];
      let layouts: any[] = [];
      let flexiPages: any[] = [];
      let automation: any[] = [];
      let buttons: any[] = [];
      let fields: any[] = [];
      let objectPermissions: any[] = [];
      let compactLayouts: any[] = [];
      let objectLimits: any[] = [];
      let quickActions: any[] = [];
      let allAssignments: any[] = [];
      let allFlexiPageAssignments: any[] = [];
      let flows: any[] = [];
      let approvals: any[] = [];

      const effectivePreFetched = preFetched || {
        validationRules: this.preFetchedValidationRules,
        layouts: this.preFetchedLayouts,
        flexiPages: this.preFetchedFlexiPages,
        automation: this.preFetchedAutomation,
        buttons: this.preFetchedButtons,
        quickActions: this.preFetchedQuickActions,
        allAssignments: this.preFetchedAssignments,
        allFlexiPageAssignments: this.preFetchedFlexiPageAssignments,
        preFetchedFields: this.preFetchedFields
      };

      const epf: any = effectivePreFetched;

      let durableId = id;
      try {
        const entityDef = await this.request(`/query?q=${encodeURIComponent(`SELECT DurableId FROM EntityDefinition WHERE QualifiedApiName = '${id}'`)}`, true);
        if (entityDef.records && entityDef.records.length > 0) {
          durableId = entityDef.records[0].DurableId;
        }
      } catch (e) {
        console.warn(`Failed to fetch DurableId for ${id}`, e);
      }

      if (epf && (
        (epf.validationRules && epf.validationRules.length > 0) ||
        (epf.layouts && epf.layouts.length > 0) ||
        (epf.flexiPages && epf.flexiPages.length > 0)
      )) {
        validationRules = (epf.validationRules || []).filter((vr: any) => vr.EntityDefinitionId === id || vr.EntityDefinitionId === durableId || (vr.EntityDefinition && vr.EntityDefinition.QualifiedApiName === id));
        layouts = (epf.layouts || []).filter((l: any) => l.TableEnumOrId === id || l.TableEnumOrId === durableId);
        flexiPages = (epf.flexiPages || []).filter((fp: any) => fp.EntityDefinitionId === id || fp.EntityDefinitionId === durableId);
        automation = (epf.automation || []).filter((a: any) => a.EntityDefinitionId === id || a.EntityDefinitionId === durableId);
        buttons = (epf.buttons || []).filter((b: any) => b.EntityDefinitionId === id || b.EntityDefinitionId === durableId);
        quickActions = (epf.quickActions || []).filter((qa: any) => qa.EntityDefinitionId === id || qa.EntityDefinitionId === durableId);
        allAssignments = (epf.allAssignments || []).filter((asg: any) => asg.Layout?.TableEnumOrId === id || asg.Layout?.TableEnumOrId === durableId);
        allFlexiPageAssignments = (epf.allFlexiPageAssignments || [])
          .filter((asg: any) => asg.FlexiPage?.EntityDefinitionId === id || asg.FlexiPage?.EntityDefinitionId === durableId)
          .map((asg: any) => ({
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
        fields = epf.preFetchedFields?.[id] || epf.preFetchedFields?.[durableId] || [];
      } else {
        // Fetch related metadata in parallel to improve performance
        const [vrData, layoutData, fpData, permData, clData, limitData, triggerData, qaData, asgData, fpAsgData, flowData, approvalData, buttonData, fieldData] = await Promise.all([
          this.request(`/query?q=${encodeURIComponent(`SELECT Id, ValidationName, Active, ErrorMessage, Description, EntityDefinitionId FROM ValidationRule WHERE EntityDefinitionId = '${durableId}'`)}`, true).catch(e => { 
            console.warn(`VR fetch failed for ${id}`, e);
            return { records: [] };
          }),
          this.request(`/query?q=${encodeURIComponent(`SELECT Id, Name, TableEnumOrId FROM Layout WHERE TableEnumOrId = '${id}' OR TableEnumOrId = '${durableId}'`)}`, true).catch(e => { 
            console.warn(`Layout fetch failed for ${id}`, e); 
            return { records: [] }; 
          }),
          this.request(`/query?q=${encodeURIComponent(`SELECT Id, MasterLabel, DeveloperName, Type, EntityDefinitionId FROM FlexiPage WHERE (EntityDefinitionId = '${id}' OR EntityDefinitionId = '${durableId}') AND Type = 'RecordPage' LIMIT 200`)}`, true).catch(e => { 
            console.warn(`FlexiPage fetch failed for ${id}`, e); 
            return { records: [] };
          }),
          this.request(`/query?q=${encodeURIComponent(`SELECT Parent.Name, Parent.Label, Parent.IsOwnedByProfile, Parent.Profile.Name, PermissionsRead, PermissionsCreate, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions WHERE SobjectType = '${id}'`)}`).catch(e => { console.warn(`Perm fetch failed for ${id}`, e); return { records: [] }; }),
          this.request(`/query?q=${encodeURIComponent(`SELECT Id, DeveloperName FROM CompactLayout WHERE SobjectType = '${id}'`)}`, true).catch(e => { 
            console.warn(`CompactLayout fetch failed for ${id}`, e); 
            return { records: [] }; 
          }),
          this.request(`/query?q=${encodeURIComponent(`SELECT DurableId, EntityDefinitionId, Type, Max, Remaining FROM EntityLimit WHERE EntityDefinitionId = '${id}' OR EntityDefinitionId = '${durableId}'`)}`, true).catch(e => { console.warn(`Limits fetch failed for ${id}`, e); return { records: [] }; }),
          this.request(`/query?q=${encodeURIComponent(`SELECT Id, Name, Status FROM ApexTrigger WHERE TableEnumOrId = '${id}' OR TableEnumOrId = '${durableId}'`)}`, true).catch(e => { console.warn(`Triggers fetch failed for ${id}`, e); return { records: [] }; }),
          this.request(`/query?q=${encodeURIComponent(`SELECT Id, DeveloperName, MasterLabel FROM QuickActionDefinition WHERE SobjectType = '${id}'`)}`, true).catch(e => { console.warn(`QA fetch failed for ${id}`, e); return { records: [] }; }),
          this.request(`/query?q=${encodeURIComponent(`SELECT Profile.Name, LayoutId, Layout.Name, RecordTypeId FROM ProfileLayout WHERE Layout.TableEnumOrId = '${id}' OR Layout.TableEnumOrId = '${durableId}'`)}`, true).catch(() => ({ records: [] })),
          Promise.resolve({ records: [] }), // RecordTypeFlexiPageAssignment not supported in Tooling SOQL
          this.request(`/query?q=${encodeURIComponent(`SELECT ApiName, Label, ProcessType, TriggerObjectOrEventId, TriggerType FROM FlowDefinitionView WHERE TriggerObjectOrEventId = '${id}' OR TriggerObjectOrEventId = '${durableId}' LIMIT 2000`)}`, false)
            .then(res => ({ records: (res.records || []) }))
            .catch((e) => {
               // Fallback if not available
               console.warn("FlowDefinitionView failed, trying fallback...", e);
               return this.request(`/query?q=${encodeURIComponent(`SELECT Id, MasterLabel, ProcessType FROM Flow WHERE ProcessType = 'Workflow' OR ProcessType = 'AutoLaunchedFlow' LIMIT 2000`)}`, true)
                 .then(res2 => ({ records: [] })) // Return empty to avoid 101 flows showing everywhere
                 .catch(() => ({ records: [] }));
            }),
          this.request(`/query?q=${encodeURIComponent(`SELECT Id, Name, TableEnumOrId FROM ProcessDefinition WHERE (TableEnumOrId = '${id}' OR TableEnumOrId = '${durableId}') AND Type = 'Approval'`)}`, false).catch(() => ({ records: [] })),
          this.request(`/query?q=${encodeURIComponent(`SELECT Id, Name, DisplayType, LinkType FROM WebLink WHERE EntityDefinitionId = '${id}' OR EntityDefinitionId = '${durableId}'`)}`, true).catch(() => ({ records: [] })),
          this.request(`/query?q=${encodeURIComponent(`SELECT QualifiedApiName, Label, DataType, Length, IsCalculated, IsNillable FROM FieldDefinition WHERE EntityDefinitionId = '${durableId}'`)}`, true).catch(e => { console.warn(`Fields fetch failed for ${id}`, e); return { records: [] }; })
        ]);

        validationRules = vrData.records || [];
        layouts = layoutData.records || [];
        flexiPages = fpData.records || [];
        fields = (fieldData.records || []).map((f: any) => ({
          name: f.QualifiedApiName,
          label: f.Label,
          type: f.DataType,
          length: f.Length,
          calculated: f.IsCalculated,
          required: !f.IsNillable
        }));
        
        // Fetch Metadata for each ValidationRule individually to get ErrorMessage and ErrorConditionFormula
        if (validationRules.length > 0) {
          const vrWithMetadata = await Promise.all(validationRules.map(async (vr: any) => {
            try {
              const fullVr = await this.fetchFullMetadata('ValidationRule', vr.Id);
              return { 
                ...vr, 
                Metadata: fullVr.Metadata,
                ErrorMessage: fullVr.ErrorMessage || fullVr.Metadata?.errorMessage || vr.ErrorMessage,
                ErrorConditionFormula: fullVr.ErrorConditionFormula || fullVr.Metadata?.errorConditionFormula || vr.ErrorConditionFormula
              };
            } catch (e) {
              console.warn(`Failed to fetch metadata for ValidationRule ${vr.Id}`, e);
              return vr;
            }
          }));
          validationRules = vrWithMetadata;
        }

        // Process FlexiPage assignments from the query results
        allFlexiPageAssignments = (fpAsgData.records || []).map((asg: any) => ({
          FlexiPageId: asg.FlexiPageId,
          FlexiPage: {
            DeveloperName: asg.FlexiPage?.DeveloperName,
            MasterLabel: asg.FlexiPage?.DeveloperName // Fallback to DeveloperName
          },
          Profile: {
            Name: asg.Profile?.Name
          },
          recordType: asg.RecordType?.DeveloperName || 'Master',
          appName: 'All Apps' // Tooling API query doesn't easily give App name
        }));

        // If query returned nothing, try the metadata approach as fallback for FlexiPages
        if (allFlexiPageAssignments.length === 0 && flexiPages.length > 0) {
          const flexiPagesWithMetadata = await Promise.all(flexiPages.map(async (fp: any) => {
            try {
              const fullFp = await this.fetchFullMetadata('FlexiPage', fp.Id);
              return { ...fp, Metadata: fullFp.Metadata };
            } catch (e) {
              console.warn(`Failed to fetch metadata for FlexiPage ${fp.Id}`, e);
              return fp;
            }
          }));
          
          flexiPagesWithMetadata.forEach((fp: any) => {
            if (fp.Metadata && fp.Metadata.pageTemplates) {
              fp.Metadata.pageTemplates.forEach((template: any) => {
                if (template.pageTemplateAssignments) {
                  template.pageTemplateAssignments.forEach((assignment: any) => {
                    allFlexiPageAssignments.push({
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

        objectPermissions = (permData.records || []).map((p: any) => ({
          ...p,
          id: p.Parent?.Name || p.ParentId,
          name: p.Parent?.IsOwnedByProfile ? p.Parent?.Profile?.Name : (p.Parent?.Label || p.Parent?.Name || 'Unknown Profile/PermSet'),
          label: p.Parent?.IsOwnedByProfile ? p.Parent?.Profile?.Name : (p.Parent?.Label || p.Parent?.Name || 'Unknown Profile/PermSet')
        }));
        compactLayouts = clData.records || [];
        objectLimits = (limitData.records || []).map((l: any) => ({
          ...l,
          id: l.Type || l.DurableId,
          name: l.Type || 'Unknown Limit',
          label: l.Type || 'Unknown Limit'
        }));
        const triggers = triggerData.records || [];
        quickActions = (qaData.records || []).map((qa: any) => ({
          ...qa,
          id: qa.Id,
          name: qa.DeveloperName || qa.MasterLabel,
          label: qa.MasterLabel || qa.DeveloperName
        }));
        allAssignments = asgData.records || [];
        // allFlexiPageAssignments is already populated above
        flows = (flowData.records || []).map((f: any) => ({
          ...f,
          id: f.Id || f.ApiName || f.DeveloperName,
          name: f.MasterLabel || f.ApiName || f.DeveloperName,
          label: f.Label || f.MasterLabel || f.DeveloperName,
          content: `<triggerType>${f.TriggerType}</triggerType>` // Fake content so UI categorizes correct Step 2 vs 12
        }));
        approvals = approvalData.records || [];
        buttons = (buttonData.records || []).map((b: any) => ({
          ...b,
          id: b.Id,
          name: b.Name,
          label: b.Name
        }));

        // Map layouts to include consistent naming
        data.layouts = layouts.map((l: any) => ({
          ...l,
          id: l.Id,
          name: l.Name || `${l.TableEnumOrId} Layout`,
          label: l.Name || `${l.TableEnumOrId} Layout`
        }));

        automation = [
          ...triggers.map((t: any) => ({ ...t, id: t.Id, type: 'Trigger', name: t.Name, label: t.Name })),
          ...validationRules.map((vr: any) => ({ 
            ...vr, 
            id: vr.Id, 
            type: 'Validation Rule', 
            name: vr.ValidationName,
            label: vr.ValidationName,
            active: vr.Active,
            errormessage: vr.ErrorMessage || vr.Metadata?.errorMessage || '',
            ErrorDisplayField: vr.ErrorDisplayField || vr.Metadata?.errorDisplayField || '',
            validationformula: vr.ErrorConditionFormula || vr.Metadata?.errorConditionFormula || '',
            Description: vr.Description || vr.Metadata?.description || ''
          })),
          ...flows.map((f: any) => ({ ...f, type: 'Record-Triggered Flow' })),
          ...approvals.map((a: any) => ({ ...a, id: a.Id, type: 'Approval Process', name: a.Name, label: a.Name }))
        ];
      }

      // Store object permissions and compact layouts in data
      data.objectPermissions = objectPermissions;
      data.compactLayouts = compactLayouts;
      data.objectLimits = objectLimits;
      data.allAssignments = allAssignments;
      data.allFlexiPageAssignments = allFlexiPageAssignments;
      data.automation = automation;
      data.quickActions = quickActions;
      data.buttons = buttons;
      data.fields = fields;
        data.validationRules = validationRules.map(vr => ({ 
          ...vr, 
          id: vr.Id, 
          type: 'Validation Rule', 
          name: vr.ValidationName,
          active: vr.Active,
          errormessage: vr.ErrorMessage || vr.Metadata?.errorMessage || '',
          ErrorDisplayField: vr.ErrorDisplayField || vr.Metadata?.errorDisplayField || '',
          validationformula: vr.ErrorConditionFormula || vr.Metadata?.errorConditionFormula || '',
          Description: vr.Description || vr.Metadata?.description || ''
        }));

        // Fetch Record Type usage and definitions if possible
        try {
          const hasRecordTypeField = fields && fields.some((f: any) => f.name === 'RecordTypeId');
          if (hasRecordTypeField) {
            const [rtUsage, rtDefs] = await Promise.all([
              this.request(`/query?q=${encodeURIComponent(`SELECT RecordTypeId, COUNT(Id) cnt FROM ${id} GROUP BY RecordTypeId`)}`),
              this.request(`/query?q=${encodeURIComponent(`SELECT Id, Name, DeveloperName, Description FROM RecordType WHERE SobjectType = '${id}'`)}`)
            ]);
            
            const usage = rtUsage.records || [];
            const defs = rtDefs.records || [];
            
            // Map usage to include labels
            data.recordTypeUsage = usage.map((u: any) => {
              const def = defs.find((d: any) => d.Id === u.RecordTypeId || (u.RecordTypeId && d.Id && u.RecordTypeId.substring(0, 15) === d.Id.substring(0, 15)));
              return {
                ...u,
                id: u.RecordTypeId,
                name: def ? def.Name : (u.RecordTypeId === '012000000000000AAA' || !u.RecordTypeId ? 'Master' : u.RecordTypeId),
                label: def ? def.Name : (u.RecordTypeId === '012000000000000AAA' || !u.RecordTypeId ? 'Master' : u.RecordTypeId),
                description: def ? def.Description : ''
              };
            });
            
            // Add definitions with 0 usage
            defs.forEach((d: any) => {
              if (!data.recordTypeUsage.some((u: any) => u.RecordTypeId === d.Id || (u.RecordTypeId && d.Id && u.RecordTypeId.substring(0, 15) === d.Id.substring(0, 15)))) {
                data.recordTypeUsage.push({
                  RecordTypeId: d.Id,
                  id: d.Id,
                  cnt: 0,
                  name: d.Name,
                  label: d.Name,
                  description: d.Description
                });
              }
            });
          } else {
            data.recordTypeUsage = [];
          }
        } catch (e) {
          console.warn(`RecordType usage fetch failed for ${id}`, e);
          data.recordTypeUsage = [];
        }

      // Construct a more "XML-like" representation for objects to satisfy user request
      const rootTag = 'CustomObject';
      let xmlBody = `<?xml version="1.0" encoding="UTF-8"?>\n<${rootTag} xmlns="http://soap.sforce.com/2006/04/metadata">\n`;
      xmlBody += `    <fullName>${id}</fullName>\n`;
      xmlBody += `    <label>${this.escapeXml(data.label)}</label>\n`;
      xmlBody += `    <pluralLabel>${this.escapeXml(data.labelPlural)}</pluralLabel>\n`;
      xmlBody += `    <visibility>${data.custom ? 'Public' : 'Standard'}</visibility>\n`;
      
      if (data.fields) {
        data.fields.forEach((f: any) => {
          xmlBody += `    <fields>\n`;
          xmlBody += `        <fullName>${this.escapeXml(f.name)}</fullName>\n`;
          xmlBody += `        <label>${this.escapeXml(f.label)}</label>\n`;
          xmlBody += `        <type>${this.escapeXml(f.type)}</type>\n`;
          if (f.length) xmlBody += `        <length>${f.length}</length>\n`;
          if (f.precision) xmlBody += `        <precision>${f.precision}</precision>\n`;
          if (f.scale) xmlBody += `        <scale>${f.scale}</scale>\n`;
          if (f.inlineHelpText) xmlBody += `        <inlineHelpText>${this.escapeXml(f.inlineHelpText)}</inlineHelpText>\n`;
          xmlBody += `        <required>${f.nillable === false}</required>\n`;
          xmlBody += `        <unique>${f.unique || false}</unique>\n`;
          xmlBody += `        <externalId>${f.externalId || false}</externalId>\n`;
          xmlBody += `        <trackTrending>${f.trackTrending || false}</trackTrending>\n`;
          xmlBody += `    </fields>\n`;
        });
      }

      if (validationRules.length > 0) {
        validationRules.forEach((vr: any) => {
          xmlBody += `    <validationRules>\n`;
          xmlBody += `        <fullName>${this.escapeXml(vr.ValidationName)}</fullName>\n`;
          xmlBody += `        <active>${vr.Active}</active>\n`;
          xmlBody += `    </validationRules>\n`;
        });
      }

      if (layouts.length > 0) {
        layouts.forEach((l: any) => {
          xmlBody += `    <layouts>\n`;
          xmlBody += `        <layout>${this.escapeXml(l.Name)}</layout>\n`;
          xmlBody += `    </layouts>\n`;
        });
      }

      if (flexiPages.length > 0) {
        flexiPages.forEach((fp: any) => {
          xmlBody += `    <flexiPages>\n`;
          xmlBody += `        <flexiPage>${this.escapeXml(fp.DeveloperName)}</flexiPage>\n`;
          xmlBody += `        <type>${this.escapeXml(fp.Type)}</type>\n`;
          xmlBody += `    </flexiPages>\n`;
        });
      }

      if (data.compactLayouts && data.compactLayouts.length > 0) {
        data.compactLayouts.forEach((cl: any) => {
          xmlBody += `    <compactLayouts>\n`;
          xmlBody += `        <fullName>${this.escapeXml(cl.DeveloperName)}</fullName>\n`;
          xmlBody += `    </compactLayouts>\n`;
        });
      }

      xmlBody += `</${rootTag}>`;
      content = xmlBody;
      metaXml = xmlBody;
      
      return { 
        content, 
        metaXml, 
        objectPermissions: data.objectPermissions,
        objectLimits: data.objectLimits,
        recordTypeUsage: data.recordTypeUsage,
        automation: data.automation,
        quickActions: data.quickActions,
        buttons: (data.buttons || []).map((b: any) => ({
          id: b.Id,
          name: b.Name,
          type: 'Button'
        })),
        validationRules: validationRules.map((vr: any) => ({
          ...vr,
          id: vr.Id,
          name: vr.ValidationName,
          active: vr.Active,
          type: 'Validation Rule'
        })),
        layouts: layouts.map((l: any) => ({
          id: l.Id,
          name: l.Name,
          type: 'Layout'
        })),
        flexiPages: flexiPages.map((fp: any) => ({
          id: fp.Id,
          name: fp.DeveloperName,
          type: fp.Type
        })),
        compactLayouts: (data.compactLayouts || []).map((cl: any) => ({
          id: cl.Id,
          name: cl.DeveloperName,
          type: 'Compact Layout'
        })),
        allAssignments: data.allAssignments,
        allFlexiPageAssignments: data.allFlexiPageAssignments,
        fields: data.fields ? data.fields.map((f: any) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          length: f.length,
          isCustom: f.custom,
          picklistValues: f.picklistValues ? f.picklistValues.map((pv: any) => ({ label: pv.label, value: pv.value })) : undefined
        })) : fields
      };
    } else {
      content = content || data.Body || data.Markup || (data.Metadata ? JSON.stringify(data.Metadata, null, 2) : JSON.stringify(data, null, 2));
      
      const metaObj = data.Metadata || data;
      const rootTag = category === 'classes' ? 'ApexClass' : 
                      category === 'triggers' ? 'ApexTrigger' : 
                      category === 'vfPages' ? 'ApexPage' : 
                      category === 'flows' || category === 'processBuilders' ? 'Flow' : 
                      category === 'quickActions' ? 'QuickAction' :
                      category === 'buttons' ? 'WebLink' : 
                      category === 'compactLayouts' ? 'CompactLayout' :
                      category === 'profiles' ? 'Profile' :
                      category === 'permissionSets' ? 'PermissionSet' : 'Metadata';
      
      // Construct a meta.xml string
      let xmlBody = `<?xml version="1.0" encoding="UTF-8"?>\n<${rootTag} xmlns="http://soap.sforce.com/2006/04/metadata">\n`;
      
      const processNode = (obj: any, indent: string) => {
        let xml = "";
        if (!obj || typeof obj !== 'object') return xml;
        
        Object.keys(obj).forEach(key => {
          // Skip internal Salesforce fields and empty fields
          if (['attributes', 'Id', 'Name', 'DeveloperName', 'NamespacePrefix', 'CreatedDate', 'CreatedById', 'LastModifiedDate', 'LastModifiedById', 'SystemModstamp'].includes(key)) return;
          
          const val = obj[key];
          if (val === null || val === undefined) return;
          
          if (Array.isArray(val)) {
            val.forEach(item => {
              if (typeof item === 'object') {
                xml += `${indent}<${key}>\n`;
                xml += processNode(item, indent + "    ");
                xml += `${indent}</${key}>\n`;
              } else {
                xml += `${indent}<${key}>${this.escapeXml(String(item))}</${key}>\n`;
              }
            });
          } else if (typeof val === 'object') {
            xml += `${indent}<${key}>\n`;
            xml += processNode(val, indent + "    ");
            xml += `${indent}</${key}>\n`;
          } else {
            xml += `${indent}<${key}>${this.escapeXml(String(val))}</${key}>\n`;
          }
        });
        return xml;
      };

      xmlBody += processNode(metaObj, "    ");
      xmlBody += `</${rootTag}>`;
      metaXml = xmlBody;
      
      // If it's a profile or permission set, the XML is much better than the JSON Metadata field
      if (category === 'profiles' || category === 'permissionSets') {
        content = metaXml;
      }
      
      return { 
        content, 
        metaXml, 
        lwcFiles, 
        objectPermissions: data.objectPermissions || data.ObjectPermissions,
        fieldPermissions: data.FieldPermissions,
        assignedUsers: data.AssignedUsers,
        objectLimits: data.objectLimits,
        recordTypeUsage: data.recordTypeUsage,
        automation: data.automation,
        quickActions: data.quickActions,
        Metadata: data.Metadata,
        UserType: data.UserType,
        UserLicense: data.UserLicense,
        ErrorMessage: data.ErrorMessage || data.Metadata?.errorMessage,
        ErrorConditionFormula: data.ErrorConditionFormula || data.Metadata?.errorConditionFormula,
        Active: data.Active !== undefined ? data.Active : data.Metadata?.active
      };
    }
  }

  async getObjectFields(objectName: string): Promise<SalesforceField[]> {
    try {
      const data = await this.request(`/sobjects/${objectName}/describe`);
      if (!data || !data.fields) return [];
      
      const fields = data.fields.map((f: any) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        length: f.length,
        isCustom: f.custom,
        picklistValues: f.picklistValues ? f.picklistValues.map((pv: any) => ({ label: pv.label, value: pv.value })) : undefined
      }));

      try {
        // Fetch CreatedDate via Tooling API
        const query = `SELECT QualifiedApiName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '${objectName}' LIMIT 2000`;
        const fieldDefs = await this.request(`/query?q=${encodeURIComponent(query)}`, true);
        
        const createdDateMap = new Map();
        if (fieldDefs && fieldDefs.records) {
          fieldDefs.records.forEach((fd: any) => {
            if (fd.CreatedDate) {
              createdDateMap.set(fd.QualifiedApiName, fd.CreatedDate);
            }
          });
        }

        return fields.map((f: any) => ({
          ...f,
          createdDate: createdDateMap.get(f.name)
        }));
      } catch (e) {
        console.warn("Failed to fetch FieldDefinition for CreatedDate", e);
        return fields;
      }
    } catch (e) {
      console.warn(`Failed to describe object ${objectName}:`, e);
      return [];
    }
  }

  async fetchObjectsMetadataInBulk(): Promise<{ 
    validationRules: any[], 
    layouts: any[], 
    flexiPages: any[],
    automation: any[],
    buttons: any[],
    quickActions: any[],
    allAssignments: any[],
    allFlexiPageAssignments: any[]
  }> {
    // Run queries individually to avoid one failure breaking everything
    // and to handle potential payload size issues
    let validationRules: any[] = [];
    let layouts: any[] = [];
    let flexiPages: any[] = [];
    let automation: any[] = [];
    let buttons: any[] = [];
    let quickActions: any[] = [];
    let allAssignments: any[] = [];
    let allFlexiPageAssignments: any[] = [];

    try {
      const vrData = await this.request(`/query?q=${encodeURIComponent(`SELECT Id, ValidationName, Active, EntityDefinitionId, ErrorMessage, Description FROM ValidationRule LIMIT 2000`)}`, true);
      validationRules = vrData.records || [];
    } catch (e) {
      console.warn("Failed to fetch validation rules in bulk", e);
    }

    try {
      const layoutData = await this.request(`/query?q=${encodeURIComponent(`SELECT Id, Name, TableEnumOrId FROM Layout LIMIT 2000`)}`, true);
      layouts = layoutData.records || [];
    } catch (e) {
      console.warn("Failed to fetch layouts in bulk", e);
    }

    try {
      const fpData = await this.request(`/query?q=${encodeURIComponent(`SELECT Id, DeveloperName, Type, EntityDefinitionId FROM FlexiPage LIMIT 2000`)}`, true);
      flexiPages = fpData.records || [];
    } catch (e) {
      console.warn("Failed to fetch flexiPages in bulk", e);
    }

    try {
      const asgData = await this.request(`/query?q=${encodeURIComponent(`SELECT Profile.Name, LayoutId, Layout.Name, Layout.TableEnumOrId, RecordTypeId FROM ProfileLayout LIMIT 2000`)}`, true);
      allAssignments = asgData.records || [];
    } catch (e) {
      console.warn("Failed to fetch layout assignments in bulk", e);
    }

    try {
      allFlexiPageAssignments = [];
      // RecordTypeFlexiPageAssignment is not supported in Tooling API SOQL
    } catch (e) {
      console.warn("Failed to fetch flexipage assignments in bulk", e);
    }

    try {
      // Fetch Triggers
      const triggerData = await this.request(`/query?q=${encodeURIComponent(`SELECT Name, TableEnumOrId, Status FROM ApexTrigger LIMIT 2000`)}`, true);
      const triggers = (triggerData.records || []).map((t: any) => ({
        ...t,
        type: 'Trigger',
        EntityDefinitionId: t.TableEnumOrId
      }));
      automation.push(...triggers);

      // Fetch Flows via FlowDefinitionView
      const flowData = await this.request(`/query?q=${encodeURIComponent(`SELECT ApiName, Label, ProcessType, TriggerObjectOrEventId, TriggerType FROM FlowDefinitionView LIMIT 2000`)}`, false)
        .catch(e => {
          console.warn("Bulk FlowDefinitionView failed, fallback...", e);
          return this.request(`/query?q=${encodeURIComponent(`SELECT Id, MasterLabel, ProcessType FROM Flow WHERE ProcessType = 'Workflow' OR ProcessType = 'AutoLaunchedFlow' LIMIT 2000`)}`, true);
        });
      
      const flows = (flowData.records || []).map((f: any) => ({
        ...f,
        id: f.Id || f.ApiName || f.DeveloperName,
        name: f.MasterLabel || f.ApiName || f.DeveloperName,
        label: f.Label || f.MasterLabel || f.DeveloperName,
        type: 'Record-Triggered Flow',
        EntityDefinitionId: f.TriggerObjectOrEventId || f.TriggerObjectOrEvent || 'Unknown',
        content: `<triggerType>${f.TriggerType}</triggerType>`
      }));
      automation.push(...flows);
    } catch (e) {
      console.warn("Failed to fetch triggers or flows in bulk", e);
    }

    try {
      // Fetch Buttons/WebLinks
      const buttonData = await this.request(`/query?q=${encodeURIComponent(`SELECT Name, EntityDefinitionId FROM WebLink LIMIT 2000`)}`, true);
      buttons = (buttonData.records || []).map((b: any) => ({
        ...b,
        EntityDefinitionId: b.EntityDefinitionId || b.TableEnumOrId
      }));
    } catch (e) {
      console.warn("Failed to fetch buttons in bulk", e);
    }

    try {
      // Fetch Quick Actions
      const qaData = await this.request(`/query?q=${encodeURIComponent(`SELECT DeveloperName, SobjectType FROM QuickActionDefinition LIMIT 2000`)}`, true);
      quickActions = (qaData.records || []).map((qa: any) => ({
        ...qa,
        EntityDefinitionId: qa.SobjectType
      }));
    } catch (e) {
      console.warn("Failed to fetch quick actions in bulk", e);
    }

    let fieldsByObject: Record<string, any[]> = {};
    try {
      // Fetch Fields in bulk
      const fieldData = await this.request(`/query?q=${encodeURIComponent(`SELECT QualifiedApiName, Label, DataType, EntityDefinitionId FROM FieldDefinition WHERE EntityDefinition.IsCustomSetting = false LIMIT 2000`)}`, true);
      const allFields = (fieldData.records || []).map((f: any) => ({
        name: f.QualifiedApiName,
        label: f.Label,
        type: f.DataType,
        EntityDefinitionId: f.EntityDefinitionId,
        isCustom: f.QualifiedApiName.endsWith('__c')
      }));
      // Group fields by object
      allFields.forEach(f => {
        if (!fieldsByObject[f.EntityDefinitionId]) fieldsByObject[f.EntityDefinitionId] = [];
        fieldsByObject[f.EntityDefinitionId].push(f);
      });
    } catch (e) {
      console.warn("Failed to fetch fields in bulk", e);
    }

    this.preFetchedValidationRules = validationRules;
    this.preFetchedLayouts = layouts;
    this.preFetchedFlexiPages = flexiPages;
    this.preFetchedAutomation = automation;
    this.preFetchedButtons = buttons;
    this.preFetchedQuickActions = quickActions;
    this.preFetchedAssignments = allAssignments;
    this.preFetchedFlexiPageAssignments = allFlexiPageAssignments;
    this.preFetchedFields = fieldsByObject;

    return { validationRules, layouts, flexiPages, automation, buttons, quickActions, allAssignments, allFlexiPageAssignments };
  }

  async initializeOrgData(authResponse: AuthResponse): Promise<SalesforceOrgData> {
    const orgInfo = await this.request('/query?q=' + encodeURIComponent('SELECT Id, Name, InstanceName FROM Organization'));
    const user = await this.getUserInfo(authResponse.id);
    const orgRecord = orgInfo.records[0];

    const baseData: SalesforceOrgData = {
      orgName: orgRecord.Name,
      orgId: orgRecord.Id,
      instance: orgRecord.InstanceName,
      user,
      objects: [], classes: [], triggers: [], vfPages: [], lwcs: [], flows: [],
      processBuilders: [], permissionSets: [], profiles: [], tabs: [], layouts: [],
      recordTypes: [], emailTemplates: [], staticResources: [], labels: [], workflowRules: [],
      customMetadata: [], validationRules: [], flexiPages: [], dashboards: [],
      quickActions: [], buttons: [], compactLayouts: [],
      sharingSettings: [], licenses: [], objectLimits: [], approvalProcesses: [],
      automation: [],
      sites: [],
      networks: [],
      userManagementSettings: [],
      portals: [],
      syncedCategories: {
        objects: false, classes: false, triggers: false, vfPages: false, lwcs: false,
        flows: false, processBuilders: false, permissionSets: false, profiles: false,
        tabs: false, layouts: false, recordTypes: false, emailTemplates: false,
        staticResources: false, labels: false, workflowRules: false,
        customMetadata: false, validationRules: false, flexiPages: false, dashboards: false,
        quickActions: false, buttons: false, compactLayouts: false,
        sharingSettings: false, licenses: false, objectLimits: false,
        approvalProcesses: false, automation: false, sites: false, networks: false, userManagementSettings: false, portals: false
      }
    };

    try {
      const [objects, flows, classes, dashboards, sharing, licenses, limits, approvals, profiles, automation, portals, sites, networks] = await Promise.all([
        this.fetchCategory('objects'),
        this.fetchCategory('flows'),
        this.fetchCategory('classes'),
        this.fetchCategory('dashboards'),
        this.fetchCategory('sharingSettings'),
        this.fetchCategory('licenses'),
        this.fetchCategory('objectLimits'),
        this.fetchCategory('approvalProcesses'),
        this.fetchCategory('profiles'),
        this.fetchCategory('automation'),
        this.fetchCategory('portals'),
        this.fetchCategory('sites'),
        this.fetchCategory('networks')
      ]);

      baseData.objects = objects;
      baseData.flows = flows;
      baseData.classes = classes;
      baseData.dashboards = dashboards;
      baseData.sharingSettings = sharing;
      baseData.licenses = licenses;
      baseData.objectLimits = limits;
      baseData.approvalProcesses = approvals;
      baseData.profiles = profiles;
      baseData.automation = automation;
      baseData.portals = portals;
      baseData.sites = sites;
      baseData.networks = networks;
      baseData.syncedCategories.objects = true;
      baseData.syncedCategories.flows = true;
      baseData.syncedCategories.classes = true;
      baseData.syncedCategories.dashboards = true;
      baseData.syncedCategories.sharingSettings = true;
      baseData.syncedCategories.licenses = true;
      baseData.syncedCategories.objectLimits = true;
      baseData.syncedCategories.approvalProcesses = true;
      baseData.syncedCategories.profiles = true;
      baseData.syncedCategories.automation = true;
      baseData.syncedCategories.portals = true;
      baseData.syncedCategories.sites = true;
      baseData.syncedCategories.networks = true;

      // Special handling for Guest and Portal Profiles - fetch their full metadata for security analysis
      const specialProfiles = baseData.profiles.filter(p => {
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
        await Promise.all(specialProfiles.map(async (gp) => {
          try {
            const details = await this.fetchMetadataContent('profiles', gp.id);
            Object.assign(gp, details);
          } catch (e) {
            console.warn(`Failed to fetch full metadata for profile ${gp.name}`, e);
          }
        }));
      }
    } catch (e) {
      console.warn("Initial sync partially failed.", e);
    }

    return baseData;
  }

  public async storeGranularSecurityResult(category: string, profileName: string, objects: any[]): Promise<void> {
    if (!this.orgId) throw new Error("Org ID not set");
    
    const ownerUid = auth.currentUser?.uid;

    try {
      await fetch('/api/security/analysis/granular-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: this.orgId,
          category,
          profileName,
          objects,
          ownerUid
        })
      });
    } catch (e) {
      console.error(`Failed to store granular security result for ${profileName}`, e);
      throw e;
    }
  }

  public async fetchGranularSecurityResult(category: string, profileName: string): Promise<any[]> {
    if (!this.orgId) throw new Error("Org ID not set");
    
    try {
      const res = await fetch(`/api/security/analysis/granular-fetch/${this.orgId}/${category}/${profileName}`);
      if (res.ok) {
        return await res.json();
      }
      return [];
    } catch (e) {
      console.error(`Failed to fetch granular security result for ${profileName}`, e);
      return [];
    }
  }

  public async storeSecurityAnalysisResult(tileId: string, data: any, summary?: any): Promise<void> {
    if (!this.orgId) throw new Error("Org ID not set");
    
    const ownerUid = auth.currentUser?.uid;

    try {
      await fetch('/api/security/analysis/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: this.orgId,
          tileId,
          data,
          summary,
          timestamp: new Date().toISOString(),
          ownerUid
        })
      });
    } catch (e) {
      console.error(`Failed to store security analysis result for ${tileId}`, e);
      throw e;
    }
  }

  // Bulk API V2 Methods
  public async createBulkJob(object: string, operation: string = 'insert'): Promise<any> {
    return this.request('/jobs/ingest', false, 'POST', {
      object,
      operation,
      contentType: 'CSV',
      lineEnding: 'LF'
    });
  }

  public async closeBulkJob(jobId: string): Promise<any> {
    return this.request(`/jobs/ingest/${jobId}`, false, 'PATCH', {
      state: 'UploadComplete'
    });
  }

  public async getBulkJobStatus(jobId: string): Promise<any> {
    return this.request(`/jobs/ingest/${jobId}`, false, 'GET');
  }

  public async getBulkJobSuccessfulResults(jobId: string): Promise<string> {
    return this.request(`/jobs/ingest/${jobId}/successfulResults`, false, 'GET');
  }

  public async getBulkJobFailedResults(jobId: string): Promise<string> {
    return this.request(`/jobs/ingest/${jobId}/failedResults`, false, 'GET');
  }
}
