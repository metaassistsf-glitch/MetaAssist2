
import { SalesforceOrgData, SalesforceObject, GenericMetadata } from "../types";

const generateFields = (count: number) => {
  const types = ['Text', 'Number', 'Date', 'Lookup', 'Master-Detail', 'Checkbox', 'Formula'];
  return Array.from({ length: count }, (_, i) => ({
    name: `Field_${i}__c`,
    label: `Field ${i}`,
    type: types[Math.floor(Math.random() * types.length)],
    isCustom: true,
    length: Math.random() > 0.5 ? 255 : undefined
  }));
};

const mockObjects: SalesforceObject[] = [
  { name: 'Account', label: 'Account', isCustom: false, fields: generateFields(45) },
  { name: 'Contact', label: 'Contact', isCustom: false, fields: generateFields(32) },
  { name: 'Opportunity', label: 'Opportunity', isCustom: false, fields: generateFields(60) },
  { name: 'Custom_Log__c', label: 'Custom Log', isCustom: true, fields: generateFields(12) },
  { name: 'Project_Item__c', label: 'Project Item', isCustom: true, fields: generateFields(25) },
  { name: 'Inventory_Record__c', label: 'Inventory Record', isCustom: true, fields: generateFields(150) },
  { name: 'Case', label: 'Case', isCustom: false, fields: generateFields(40) },
];

const mockFlows: GenericMetadata[] = [
  { id: 'f1', name: 'Lead_Automation', label: 'Lead Automation Handler', status: 'Active', version: 4, type: 'Record-Triggered' },
  { id: 'f2', name: 'Case_Routing', label: 'Case Routing Rules', status: 'Active', version: 12, type: 'Record-Triggered' },
  { id: 'f3', name: 'Approval_Helper', label: 'Approval Process Helper', status: 'Inactive', version: 2, type: 'Screen Flow' },
  { id: 'f4', name: 'Account_Sanitizer', label: 'Account Name Sanitizer', status: 'Active', version: 1, type: 'Scheduled Flow' },
  { id: 'f5', name: 'Contact_Deduper', label: 'Contact Deduplication', status: 'Draft', version: 3, type: 'Autolaunched Flow' },
];

const mockClasses: GenericMetadata[] = [
  { id: 'c1', name: 'AccountTriggerHandler', status: 'Active', size: 12450, coverage: 85, apiVersion: '58.0' },
  { id: 'c2', name: 'OpportunityService', status: 'Active', size: 28000, coverage: 92, apiVersion: '58.0' },
  { id: 'c3', name: 'RESTIntegrationClient', status: 'Active', size: 8500, coverage: 74, apiVersion: '57.0' },
  { id: 'c4', name: 'CommonUtils', status: 'Active', size: 45000, coverage: 12, apiVersion: '45.0' },
  { id: 'c5', name: 'BatchDataCleaner', status: 'Inactive', size: 15600, coverage: 0, apiVersion: '58.0' },
];

// Fixed type errors by adding missing metadata categories (customMetadata, validationRules, flexiPages)
export const getMockOrgData = (): SalesforceOrgData => ({
  orgName: 'Production Org - Acme Corp',
  orgId: '00D50000000abc123',
  instance: 'NA154',
  user: {
    name: 'Mock Admin',
    title: 'System Administrator',
    username: 'admin@mock.acme.com'
  },
  objects: mockObjects,
  flows: mockFlows,
  classes: mockClasses,
  triggers: [],
  vfPages: [],
  lwcs: [],
  processBuilders: [],
  permissionSets: [],
  profiles: [],
  tabs: [],
  layouts: [],
  recordTypes: [],
  emailTemplates: [],
  staticResources: [],
  labels: [],
  workflowRules: [],
  customMetadata: [],
  validationRules: [],
  flexiPages: [],
  dashboards: [],
  quickActions: [],
  buttons: [],
  compactLayouts: [],
  sharingSettings: [],
  licenses: [],
  objectLimits: [],
  approvalProcesses: [],
  automation: [],
  sites: [],
  networks: [],
  userManagementSettings: [],
  portals: [],
  syncedCategories: {
    objects: true,
    flows: true,
    classes: true,
    triggers: false,
    vfPages: false,
    lwcs: false,
    processBuilders: false,
    permissionSets: false,
    profiles: false,
    tabs: false,
    layouts: false,
    recordTypes: false,
    emailTemplates: false,
    staticResources: false,
    labels: false,
    workflowRules: false,
    customMetadata: false,
    validationRules: false,
    flexiPages: false,
    dashboards: false,
    quickActions: false,
    buttons: false,
    compactLayouts: false,
    sharingSettings: false,
    licenses: false,
    objectLimits: false,
    approvalProcesses: false,
    automation: false,
    sites: false,
    networks: false,
    userManagementSettings: false,
    portals: false
  }
});
