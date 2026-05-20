
export interface SalesforceField {
  name: string;
  label: string;
  type: string;
  length?: number;
  isCustom: boolean;
  required?: boolean;
  externalId?: boolean;
  idLookup?: boolean;
  createdDate?: string;
  picklistValues?: { label: string; value: string }[];
  referenceTo?: string[];
  updateable?: boolean;
  createable?: boolean;
  calculated?: boolean;
  usageStats?: {
    percentage: number;
    occurrences: number;
  };
}

export interface SalesforceObject {
  id?: string;
  name: string;
  label: string;
  isCustom: boolean;
  fields: SalesforceField[];
  content?: string;
  metaXml?: string;
  explanation?: string;
  mermaidCode?: string;
  relatedMetadata?: {
    layouts?: any[];
    validationRules?: any[];
    flexiPages?: any[];
    compactLayouts?: any[];
    buttons?: any[];
    quickActions?: any[];
    automation?: any[];
  };
  objectPermissions?: any[];
  objectLimits?: any[];
  recordTypeUsage?: any[];
  allAssignments?: any[];
  allFlexiPageAssignments?: any[];
  hasFullMetadata?: boolean;
}

export interface GenericMetadata {
  id: string;
  name: string;
  Name?: string;
  label?: string;
  type?: string;
  status?: string;
  details?: string;
  coverage?: number;
  version?: number;
  apiVersion?: string;
  tableEnumOrId?: string;
  size?: number;
  content?: string;
  metaXml?: string;
  explanation?: string;
  UserType?: string;
  UserLicense?: { Name?: string; name?: string };
  lwcFiles?: {
    html?: string;
    js?: string;
    css?: string;
  };
}

export interface PermissionSetMeta {
  Id: string;
  Name: string;
  Label: string;
  IsOwnedByProfile: boolean;
}

export interface GuestUserContext {
  userId: string;
  userName: string;
  profileId: string;
  profileName: string;
  siteName: string;
  assignedPermSets: PermissionSetMeta[];
  selectedPermSetIds: string[];
}

export interface SalesforceUser {
  name: string;
  title: string;
  username: string;
}

export type MetadataCategory = 
  | 'objects' | 'classes' | 'triggers' | 'vfPages' | 'lwcs' 
  | 'flows' | 'processBuilders' | 'permissionSets' | 'profiles' 
  | 'tabs' | 'layouts' | 'recordTypes' | 'emailTemplates' 
  | 'staticResources' | 'labels' | 'workflowRules'
  | 'customMetadata' | 'validationRules' | 'flexiPages' | 'dashboards'
  | 'quickActions' | 'buttons' | 'compactLayouts' | 'sharingSettings' | 'licenses' | 'objectLimits' | 'approvalProcesses' | 'automation'
  | 'sites' | 'networks' | 'userManagementSettings' | 'portals';

export interface SalesforceOrgData {
  orgName: string;
  orgId: string;
  instance: string;
  user: SalesforceUser;
  objects: SalesforceObject[];
  classes: GenericMetadata[];
  triggers: GenericMetadata[];
  vfPages: GenericMetadata[];
  lwcs: GenericMetadata[];
  flows: GenericMetadata[];
  processBuilders: GenericMetadata[];
  permissionSets: GenericMetadata[];
  profiles: GenericMetadata[];
  tabs: GenericMetadata[];
  layouts: GenericMetadata[];
  recordTypes: GenericMetadata[];
  emailTemplates: GenericMetadata[];
  staticResources: GenericMetadata[];
  labels: GenericMetadata[];
  workflowRules: GenericMetadata[];
  customMetadata: GenericMetadata[];
  validationRules: GenericMetadata[];
  flexiPages: GenericMetadata[];
  dashboards: GenericMetadata[];
  quickActions: GenericMetadata[];
  buttons: GenericMetadata[];
  compactLayouts: GenericMetadata[];
  sharingSettings: GenericMetadata[];
  licenses: GenericMetadata[];
  objectLimits: GenericMetadata[];
  approvalProcesses: GenericMetadata[];
  automation: GenericMetadata[];
  sites: GenericMetadata[];
  networks: GenericMetadata[];
  userManagementSettings: GenericMetadata[];
  portals: GenericMetadata[];
  guestUserContexts?: GuestUserContext[];
  syncedCategories: Record<MetadataCategory, boolean>;
  accessToken?: string;
  instanceUrl?: string;
}

export type ProxyProvider = 'allorigins' | 'corsproxy' | 'codetabs' | 'none';

export interface OAuthAuthConfig {
  instanceUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface AuthConfig {
  instanceUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  useProxy: boolean;
  proxyProvider: ProxyProvider;
  useHybridMode: boolean; // Use proxy for auth, direct for data
}

export interface AuthResponse {
  access_token: string;
  refresh_token?: string;
  instance_url: string;
  id: string;
  token_type: string;
  issued_at: string;
  signature: string;
  username?: string;
  clientId?: string;
}

export type ViewType = 'dashboard' | 'objects' | 'metadata_hub' | 'ai-insights' | 'release-notes' | 'log-analyzer' | 'enhanced-release-notes' | 'query-editor' | 'enhanced-data-loader' | 'security-analysis' | 'debugger' | 'control-tower';

export interface SecurityAuditResult {
  id: string;
  title?: string;
  orgId: string;
  timestamp: string;
  type: 'guest' | 'portal' | 'static' | 'health-check';
  findings?: SecurityFinding[];
  healthChecks?: SecurityCheckPoint[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    riskyChecks?: number;
  };
}

export interface SecurityFinding {
  ruleName: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  componentName: string;
  componentType: string;
  issue: string;
  recommendation: string;
  pmdUrl?: string;
  sfUrl?: string;
}

export interface SecurityCheckPoint {
  id: string;
  title: string;
  setupPath: string;
  status: string;
  isRisky: boolean;
  description: string;
  details?: string;
  drillDownData?: any;
}

export interface Skill {
  id: string;
  name: string;
  description?: string;
  content: string;
  version?: string;
  category?: string;
  source?: string;
  updatedAt?: string;
}

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  user: {
    login: string;
    avatar_url: string;
  };
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubFile {
  sha: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string; // The diff
}

export interface PRReviewResult {
  file: string;
  issues: string[];
  isShowStopper: boolean;
  comments: string[];
}


