
export const PMD_RULES = {
  APEX_BAD_CRYPTO: {
    name: 'ApexBadCrypto',
    severity: 'High',
    sfUrl: 'https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_perms_enforcement.htm',
    pmdUrl: 'https://pmd.github.io/pmd/pmd_rules_apex_security.html#apexbadcrypto',
    description: 'Check for use of weak cryptographic algorithms.'
  },
  APEX_CRUD_VIOLATION: {
    name: 'ApexCRUDViolation',
    severity: 'High',
    sfUrl: 'https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_perms_enforcement.htm',
    pmdUrl: 'https://pmd.github.io/pmd/pmd_rules_apex_security.html#apexcrudviolation',
    description: 'Ensure that CRUD/FLS checks are performed before DML or SOQL operations.'
  },
  APEX_CSRF: {
    name: 'ApexCSRF',
    severity: 'High',
    sfUrl: 'https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_security_sharing_rules.htm',
    pmdUrl: 'https://pmd.github.io/pmd/pmd_rules_apex_security.html#apexcsrf',
    description: 'Check for potential CSRF vulnerabilities in Apex controllers.'
  },
  APEX_DANGEROUS_METHODS: {
    name: 'ApexDangerousMethods',
    severity: 'High',
    sfUrl: 'https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_security_sharing_rules.htm',
    pmdUrl: 'https://pmd.github.io/pmd/pmd_rules_apex_security.html#apexdangerousmethods',
    description: 'Avoid using dangerous methods that can lead to security vulnerabilities.'
  },
  APEX_INSECURE_ENDPOINT: {
    name: 'ApexInsecureEndpoint',
    severity: 'Medium',
    sfUrl: 'https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_callouts_timeouts.htm',
    pmdUrl: 'https://pmd.github.io/pmd/pmd_rules_apex_security.html#apexinsecureendpoint',
    description: 'Avoid using insecure HTTP endpoints (use HTTPS).'
  },
  APEX_OPEN_REDIRECT: {
    name: 'ApexOpenRedirect',
    severity: 'High',
    sfUrl: 'https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_security_sharing_rules.htm',
    pmdUrl: 'https://pmd.github.io/pmd/pmd_rules_apex_security.html#apexopenredirect',
    description: 'Avoid redirects to user-controlled URLs.'
  },
  APEX_SHARING_VIOLATIONS: {
    name: 'ApexSharingViolations',
    severity: 'High',
    sfUrl: 'https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_keywords_sharing.htm',
    pmdUrl: 'https://pmd.github.io/pmd/pmd_rules_apex_security.html#apexsharingviolations',
    description: 'Apex classes should use "with sharing" or "inherited sharing" to enforce sharing rules.'
  },
  APEX_SOQL_INJECTION: {
    name: 'ApexSOQLInjection',
    severity: 'Critical',
    sfUrl: 'https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_dynamic_soql.htm',
    pmdUrl: 'https://pmd.github.io/pmd/pmd_rules_apex_security.html#apexsoqlinjection',
    description: 'Avoid dynamic SOQL with user-controlled input to prevent injection.'
  },
  APEX_SUGGEST_USING_NAMED_CRED: {
    name: 'ApexSuggestUsingNamedCred',
    severity: 'Low',
    sfUrl: 'https://help.salesforce.com/s/articleView?id=sf.named_credentials_about.htm',
    pmdUrl: 'https://pmd.github.io/pmd/pmd_rules_apex_security.html#apexsuggestusingnamedcred',
    description: 'Suggest using named credentials for callouts.'
  },
  APEX_XSS_FROM_EMAIL_TEMPLATE: {
    name: 'ApexXSSFromEmailTemplate',
    severity: 'Medium',
    sfUrl: 'https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_security_sharing_rules.htm',
    pmdUrl: 'https://pmd.github.io/pmd/pmd_rules_apex_security.html#apexxssfromemailtemplate',
    description: 'Check for potential XSS vulnerabilities in email templates.'
  },
  APEX_XSS_FROM_URL_PARAM: {
    name: 'ApexXSSFromURLParam',
    severity: 'High',
    sfUrl: 'https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_security_sharing_rules.htm',
    pmdUrl: 'https://pmd.github.io/pmd/pmd_rules_apex_security.html#apexxssfromurlparam',
    description: 'Check for potential XSS vulnerabilities from URL parameters.'
  }
};
