import { SalesforceOrgData } from "../types";

export interface OrgIssue {
  type: "Critical" | "Medium" | "Low";
  category: string;
  metadataName: string;
  description: string;
  recommendation: string;
}

export interface FieldUsage {
  componentName: string;
  type: string;
  usage: string;
}

export interface OrgAnalysisResult {
  score: number;
  grade: string;
  securityScore: number;
  codeQualityScore: number;
  technicalDebtScore: number;
  remediationCost?: number;
  technicalDebtRatio?: number;
  technicalDebtBreakdown: {
    apexViolations: number;
    securityIssues: number;
    flowComplexity: number;
    unusedMetadata: number;
  };
  criticalIssues: number;
  mediumIssues: number;
  lowIssues: number;
  issues: OrgIssue[];
  recommendations: string[];
  fieldUsages?: Record<string, FieldUsage[]>;
}

export const analyzeOrg = (orgData: SalesforceOrgData): OrgAnalysisResult => {
  const issues: OrgIssue[] = [];
  const fieldUsages: Record<string, FieldUsage[]> = {};

  // Initialize field usages for all custom fields
  const customFields = new Set<string>();
  orgData.objects?.forEach((obj) => {
    obj.fields?.forEach((field) => {
      if (field.isCustom) {
        customFields.add(`${obj.name}.${field.name}`);
      }
    });
  });

  // Technical Debt Counters
  let apexViolations = 0;
  let securityIssues = 0;
  let flowComplexity = 0;
  let unusedMetadata = 0;

  // Critical Issues & Field Usage Scan
  orgData.classes?.forEach((cls) => {
    const content = cls.content || "";
    const lowerContent = content.toLowerCase();

    // Scan for field usages in Apex Class
    customFields.forEach((fieldKey) => {
      const [objName, fieldName] = fieldKey.split(".");
      if (content.includes(fieldName)) {
        if (!fieldUsages[fieldKey]) fieldUsages[fieldKey] = [];
        if (fieldUsages[fieldKey].length < 20) { // Limit usages per field
          fieldUsages[fieldKey].push({
            componentName: cls.name,
            type: "Apex Class",
            usage: `ApexClass: ${cls.name} - Used in code logic or SOQL`,
          });
        }
      }
    });

    // SOQL inside for loops
    if (/for\s*\([^\{]*\{[^}]*\[\s*select/i.test(content)) {
      apexViolations++;
      issues.push({
        type: "Critical",
        category: "Apex Class",
        metadataName: cls.name,
        description: "SOQL query found inside a loop",
        recommendation: "Move the query outside the loop and bulkify logic.",
      });
    }

    // DML inside loops
    if (
      /for\s*\([^\{]*\{[^}]*(insert|update|delete|upsert|undelete)\s+/i.test(
        content,
      )
    ) {
      apexViolations++;
      issues.push({
        type: "Critical",
        category: "Apex Class",
        metadataName: cls.name,
        description: "DML statement found inside a loop",
        recommendation:
          "Move the DML operation outside the loop and use collections.",
      });
    }

    // Hardcoded IDs
    if (/['"][a-zA-Z0-9]{15}['"]|['"][a-zA-Z0-9]{18}['"]/.test(content)) {
      apexViolations++;
      issues.push({
        type: "Critical",
        category: "Apex Class",
        metadataName: cls.name,
        description: "Hardcoded Salesforce ID found",
        recommendation:
          "Use Custom Labels, Custom Metadata, or query the ID dynamically.",
      });
    }

    // Missing sharing keyword
    if (
      !lowerContent.includes("with sharing") &&
      !lowerContent.includes("without sharing") &&
      !lowerContent.includes("inherited sharing") &&
      !lowerContent.includes("@istest")
    ) {
      securityIssues++;
      issues.push({
        type: "Critical",
        category: "Apex Class",
        metadataName: cls.name,
        description: "Class missing sharing keyword",
        recommendation:
          'Explicitly define "with sharing", "without sharing", or "inherited sharing".',
      });
    }

    // Missing CRUD/FLS
    if (
      lowerContent.includes("select") &&
      !lowerContent.includes("with security_enforced") &&
      !lowerContent.includes("isaccessible") &&
      !lowerContent.includes("@istest")
    ) {
      securityIssues++;
      issues.push({
        type: "Critical",
        category: "Apex Class",
        metadataName: cls.name,
        description: "Missing CRUD/FLS checks for SOQL",
        recommendation:
          "Use WITH SECURITY_ENFORCED in SOQL or check Schema.sObjectType.<Object>.isAccessible().",
      });
    }

    // Empty catch blocks
    if (/catch\s*\(\s*\w+\s+\w+\s*\)\s*\{\s*\}/i.test(content)) {
      issues.push({
        type: "Medium",
        category: "Apex Class",
        metadataName: cls.name,
        description: "Empty catch block found",
        recommendation: "Avoid catching exceptions without handling them or logging the error.",
      });
    }

    // System.debug usage
    if (lowerContent.includes("system.debug")) {
      issues.push({
        type: "Low",
        category: "Apex Class",
        metadataName: cls.name,
        description: "System.debug statements found",
        recommendation: "Remove System.debug statements from production code to improve performance and log clarity.",
      });
    }

    // Hardcoded URLs
    if (/(https?:\/\/[^\s'"]+)/i.test(content) && !lowerContent.includes("test.salesforce.com") && !lowerContent.includes("login.salesforce.com")) {
      issues.push({
        type: "Medium",
        category: "Apex Class",
        metadataName: cls.name,
        description: "Hardcoded URL found",
        recommendation: "Use Named Credentials or Custom Metadata for external URLs.",
      });
    }

    // Apex classes without test classes
    if (!lowerContent.includes("@istest")) {
      const hasTestClass = orgData.classes?.some(
        (c) =>
          c.name.toLowerCase() === `${cls.name.toLowerCase()}test` ||
          c.name.toLowerCase() === `${cls.name.toLowerCase()}_test`,
      );
      if (!hasTestClass) {
        issues.push({
          type: "Critical",
          category: "Apex Class",
          metadataName: cls.name,
          description: "Apex class without a corresponding test class",
          recommendation:
            "Create a test class to ensure code coverage and reliability.",
        });
      }
    }

    // Medium: Apex classes > 1000 lines
    const lines = content.split("\n").length;
    if (lines > 1000) {
      issues.push({
        type: "Medium",
        category: "Apex Class",
        metadataName: cls.name,
        description: `Class is too large (${lines} lines)`,
        recommendation:
          "Refactor the class into smaller, more manageable services or helper classes.",
      });
    }
  });

  orgData.triggers?.forEach((trg) => {
    const content = trg.content || "";

    // Scan for field usages in Trigger
    Object.keys(fieldUsages).forEach((fieldKey) => {
      const [objName, fieldName] = fieldKey.split(".");
      if (content.includes(fieldName)) {
        fieldUsages[fieldKey].push({
          componentName: trg.name,
          type: "Apex Trigger",
          usage: `ApexTrigger: ${trg.name} - Used in trigger logic`,
        });
      }
    });

    // SOQL inside for loops
    if (/for\s*\([^\{]*\{[^}]*\[\s*select/i.test(content)) {
      apexViolations++;
      issues.push({
        type: "Critical",
        category: "Apex Trigger",
        metadataName: trg.name,
        description: "SOQL query found inside a loop",
        recommendation: "Move the query outside the loop and bulkify logic.",
      });
    }

    // DML inside loops
    if (
      /for\s*\([^\{]*\{[^}]*(insert|update|delete|upsert|undelete)\s+/i.test(
        content,
      )
    ) {
      apexViolations++;
      issues.push({
        type: "Critical",
        category: "Apex Trigger",
        metadataName: trg.name,
        description: "DML statement found inside a loop",
        recommendation:
          "Move the DML operation outside the loop and use collections.",
      });
    }
  });

  // Medium: Multiple triggers on a single object
  const triggerMap: Record<string, number> = {};
  orgData.triggers?.forEach((trg) => {
    const match = trg.content?.match(/trigger\s+\w+\s+on\s+(\w+)/i);
    if (match && match[1]) {
      const objName = match[1];
      triggerMap[objName] = (triggerMap[objName] || 0) + 1;
    }
  });

  Object.entries(triggerMap).forEach(([objName, count]) => {
    if (count > 1) {
      issues.push({
        type: "Medium",
        category: "Apex Trigger",
        metadataName: objName,
        description: `Multiple triggers (${count}) found on object ${objName}`,
        recommendation:
          "Consolidate triggers into a single trigger per object using a Trigger Handler pattern.",
      });
    }
  });

  // Medium: Objects with too many fields (>500)
  orgData.objects?.forEach((obj) => {
    if (obj.fields && obj.fields.length > 500) {
      issues.push({
        type: "Medium",
        category: "Custom Object",
        metadataName: obj.name,
        description: `Object has too many fields (${obj.fields.length})`,
        recommendation:
          "Review fields and remove unused ones to avoid hitting limits.",
      });
    }

    // Missing metadata descriptions
    // if (obj.metaXml && !obj.metaXml.includes("<description>")) {
    //   issues.push({
    //     type: "Low",
    //     category: "Custom Object",
    //     metadataName: obj.name,
    //     description: "Missing description in metadata",
    //     recommendation:
    //       "Add a description to the object to explain its purpose.",
    //   });
    // }
  });

  // Old API version usage
  const checkApiVersion = (items: any[], category: string) => {
    items?.forEach((item) => {
      if (item.apiVersion) {
        const version = parseFloat(item.apiVersion);
        if (version < 50.0) {
          // Assuming < 50.0 is old
          issues.push({
            type: "Low",
            category,
            metadataName: item.name,
            description: `Using old API version (${item.apiVersion})`,
            recommendation:
              "Upgrade to a newer API version to access latest features and performance improvements.",
          });
        }
      }

      // Missing metadata descriptions for other metadata
      // if (item.metaXml && !item.metaXml.includes("<description>")) {
      //   issues.push({
      //     type: "Low",
      //     category,
      //     metadataName: item.name,
      //     description: "Missing description in metadata",
      //     recommendation:
      //       "Add a description to explain the purpose of this component.",
      //   });
      // }
    });
  };

  checkApiVersion(orgData.classes, "Apex Class");
  checkApiVersion(orgData.triggers, "Apex Trigger");
  checkApiVersion(orgData.vfPages, "Visualforce Page");
  checkApiVersion(orgData.lwcs, "Lightning Web Component");

  // Security: Over-permissive Profiles/Permission Sets
  const checkPermissions = (items: any[], category: string) => {
    items?.forEach(item => {
      const content = item.content || "";
      if (content.includes("<modifyAllData>true</modifyAllData>") || content.includes("<viewAllData>true</viewAllData>")) {
        securityIssues++;
        issues.push({
          type: "Critical",
          category,
          metadataName: item.name,
          description: "Over-permissive permission found (Modify All Data / View All Data)",
          recommendation: "Follow the principle of least privilege. Remove administrative permissions from standard users.",
        });
      }
    });
  };

  checkPermissions(orgData.profiles, "Profile");
  checkPermissions(orgData.permissionSets, "Permission Set");

  // Low: Too many validation rules
  orgData.objects?.forEach((obj) => {
    if (
      obj.relatedMetadata?.validationRules &&
      obj.relatedMetadata.validationRules.length > 10
    ) {
      issues.push({
        type: "Low",
        category: "Validation Rule",
        metadataName: obj.name,
        description: `Object has too many validation rules (${obj.relatedMetadata.validationRules.length})`,
        recommendation:
          "Consider consolidating validation rules or moving complex logic to Apex.",
      });
    }

    // Unused custom fields
    obj.fields?.forEach((field) => {
      if (
        field.isCustom &&
        field.usageStats &&
        field.usageStats.occurrences === 0
      ) {
        unusedMetadata++;
        issues.push({
          type: "Low",
          category: "Custom Field",
          metadataName: `${obj.name}.${field.name}`,
          description: "Unused custom field",
          recommendation:
            "Delete unused custom fields to reduce clutter and maintain org health.",
        });
      }
    });

    // Unused Validation Rules
    if (obj.relatedMetadata?.validationRules) {
      obj.relatedMetadata.validationRules.forEach((vr: any) => {
        if (vr.Active === false) {
          unusedMetadata++;
          issues.push({
            type: "Low",
            category: "Validation Rule",
            metadataName: `${obj.name}.${vr.ValidationName}`,
            description: "Inactive validation rule",
            recommendation: "Delete inactive validation rules to reduce clutter.",
          });
        }
      });
    }
  });

  // Low: Inactive flows
  orgData.flows?.forEach((flow) => {
    // Scan for field usages in Flow
    const content = flow.content || "";
    Object.keys(fieldUsages).forEach((fieldKey) => {
      const [objName, fieldName] = fieldKey.split(".");
      if (content.includes(fieldName)) {
        fieldUsages[fieldKey].push({
          componentName: flow.name,
          type: "Flow",
          usage: `Flow: ${flow.name} - Used in flow logic or assignment`,
        });
      }
    });

    if (flow.status !== "Active") {
      unusedMetadata++;
      issues.push({
        type: "Low",
        category: "Flow",
        metadataName: flow.name,
        description: `Flow is inactive (${flow.status})`,
        recommendation:
          "Delete inactive flows if they are no longer needed to reduce clutter.",
      });
    }

  // Flow Complexity
    const elementCount = (content.match(/<processMetadataValues>/g) || []).length + 
                        (content.match(/<recordLookups>/g) || []).length +
                        (content.match(/<recordUpdates>/g) || []).length +
                        (content.match(/<recordCreates>/g) || []).length +
                        (content.match(/<recordDeletes>/g) || []).length +
                        (content.match(/<decisions>/g) || []).length;
    
    if (elementCount > 15) {
      flowComplexity++;
      issues.push({
        type: "Medium",
        category: "Flow",
        metadataName: flow.name,
        description: `Flow is highly complex (${elementCount} elements)`,
        recommendation: "Consider breaking down this flow into subflows for better maintainability.",
      });
    }

    // Flow Recursive Check (simple check for same flow name in subflow calls)
    if (content.includes(`<subflows><flow>${flow.name}</flow>`)) {
      flowComplexity++;
      issues.push({
        type: "Medium",
        category: "Flow",
        metadataName: flow.name,
        description: "Flow appears to be recursive (calls itself)",
        recommendation: "Ensure recursion is intentional and has a proper exit condition.",
      });
    }

    // Flow Fault Paths
    if (content.includes("<recordLookups>") || content.includes("<recordUpdates>") || content.includes("<recordCreates>") || content.includes("<recordDeletes>")) {
      if (!content.includes("<faultConnector>")) {
        issues.push({
          type: "Medium",
          category: "Flow",
          metadataName: flow.name,
          description: "Flow missing fault paths for DML/Lookup elements",
          recommendation: "Add fault connectors to handle errors gracefully in database operations.",
        });
      }
    }

    // Flow Decision Branches (too many)
    const decisionCount = (content.match(/<decisions>/g) || []).length;
    if (decisionCount > 5) {
      flowComplexity++;
      issues.push({
        type: "Medium",
        category: "Flow",
        metadataName: flow.name,
        description: `Flow has too many decision branches (${decisionCount})`,
        recommendation: "Simplify the flow logic or break into subflows.",
      });
    }
  });

  // Layout Redundancy Check
  const layoutContentMap: Record<string, string[]> = {};
  orgData.layouts?.forEach(layout => {
    if (layout.content) {
      const contentKey = layout.content.trim();
      if (!layoutContentMap[contentKey]) {
        layoutContentMap[contentKey] = [];
      }
      layoutContentMap[contentKey].push(layout.name);
    }
  });

  Object.entries(layoutContentMap).forEach(([content, names]) => {
    if (names.length > 1) {
      unusedMetadata += (names.length - 1);
      issues.push({
        type: "Medium",
        category: "Page Layout",
        metadataName: names.join(", "),
        description: `Duplicate layouts detected: ${names.length} layouts have identical content.`,
        recommendation: `Consider removing redundant layouts: ${names.slice(1).join(", ")}. Keep only the standard or primary layout.`
      });
    }
  });

  // Validation Rule Analysis
  orgData.validationRules?.forEach(rule => {
    if (rule.content && rule.content.length > 2000) {
      issues.push({
        type: "Low",
        category: "Validation Rule",
        metadataName: rule.name,
        description: "Validation rule formula is very complex",
        recommendation: "Consider simplifying the formula or moving logic to a Before-Save Flow or Apex Trigger."
      });
    }
  });

  // Scan field usages in Visualforce Pages
  orgData.vfPages?.forEach((page) => {
    const content = page.content || "";
    Object.keys(fieldUsages).forEach((fieldKey) => {
      const [objName, fieldName] = fieldKey.split(".");
      if (content.includes(fieldName)) {
        fieldUsages[fieldKey].push({
          componentName: page.name,
          type: "VisualforcePage",
          usage: `VisualforcePage: ${page.name} - Used in page markup or controller reference`,
        });
      }
    });
  });

  // Scan field usages in LWCs
  orgData.lwcs?.forEach((lwc) => {
    const html = lwc.lwcFiles?.html || "";
    const js = lwc.lwcFiles?.js || "";
    const content = html + " " + js;
    Object.keys(fieldUsages).forEach((fieldKey) => {
      const [objName, fieldName] = fieldKey.split(".");
      if (content.includes(fieldName)) {
        fieldUsages[fieldKey].push({
          componentName: lwc.name,
          type: "LWC",
          usage: `LWC: ${lwc.name} - Used in template or javascript logic`,
        });
      }
    });
  });

  // Low: Unused Apex classes
  // Simple heuristic: check if the class name appears in any other class, trigger, or page content
  orgData.classes?.forEach((cls) => {
    // Skip test classes
    if (cls.content?.toLowerCase().includes("@istest")) return;

    let isUsed = false;
    const clsName = cls.name;

    // Check in other classes
    if (!isUsed) {
      isUsed =
        orgData.classes?.some(
          (otherCls) =>
            otherCls.name !== clsName && otherCls.content?.includes(clsName),
        ) || false;
    }
    // Check in triggers
    if (!isUsed) {
      isUsed =
        orgData.triggers?.some((trg) => trg.content?.includes(clsName)) ||
        false;
    }
    // Check in VF pages
    if (!isUsed) {
      isUsed =
        orgData.vfPages?.some((page) => page.content?.includes(clsName)) ||
        false;
    }
    // Check in LWCs (js files)
    if (!isUsed) {
      isUsed =
        orgData.lwcs?.some((lwc) => lwc.lwcFiles?.js?.includes(clsName)) ||
        false;
    }

    if (!isUsed) {
      unusedMetadata++;
      issues.push({
        type: "Low",
        category: "Apex Class",
        metadataName: clsName,
        description: "Potentially unused Apex class",
        recommendation:
          "Verify if the class is used dynamically or via API. If not, consider deleting it.",
      });
    }
  });

  // Calculate Technical Debt Score
  const technicalDebtScore = (5 * apexViolations) + (4 * securityIssues) + (3 * flowComplexity) + (2 * unusedMetadata);

  const hourlyRate = 100;
  const remediationCost = technicalDebtScore * hourlyRate;
  
  const totalComponents = 
    (orgData.classes?.length || 0) + 
    (orgData.objects?.length || 0) + 
    (orgData.triggers?.length || 0) + 
    (orgData.flows?.length || 0) +
    (orgData.dashboards?.length || 0);
    
  // Assume average 10 hours to build each component, minimum of 100 hours
  const totalDevHours = totalComponents > 0 ? Math.max(100, totalComponents * 10) : 100;
  const totalDevelopmentCost = totalDevHours * hourlyRate;
  
  const technicalDebtRatio = Number(((remediationCost / totalDevelopmentCost) * 100).toFixed(2));

  // Calculate Score
  const criticalCount = issues.filter((i) => i.type === "Critical").length;
  const mediumCount = issues.filter((i) => i.type === "Medium").length;
  const lowCount = issues.filter((i) => i.type === "Low").length;

  // Updated scoring based on user requested weights with original caps
  const criticalDeduction = Math.min(50, criticalCount * 0.15);
  const mediumDeduction = Math.min(30, mediumCount * 0.1);
  const lowDeduction = Math.min(20, lowCount * 0.01);
  
  let score = Math.round(100 - criticalDeduction - mediumDeduction - lowDeduction);
  if (score < 0) score = 0;

  let grade = "F";
  if (score >= 90) grade = "A";
  else if (score >= 80) grade = "B";
  else if (score >= 70) grade = "C";
  else if (score >= 60) grade = "D";
  else grade = "F";

  // Generate recommendations
  const recommendations = Array.from(
    new Set(issues.map((i) => i.recommendation)),
  ).slice(0, 50); // Limit recommendations

  // Final size check and trimming
  const finalIssues = issues.slice(0, 1000); // Limit total issues
  
  return {
    score,
    grade,
    securityScore: Math.max(
      0,
      100 -
        issues.filter(
          (i) =>
            i.description.includes("sharing") || i.description.includes("CRUD"),
        ).length *
          0.25,
    ),
    codeQualityScore: Math.max(
      0,
      100 -
        (apexViolations * 5 +
         issues.filter(i => i.description.includes("test class")).length * 3 +
         issues.filter(i => i.description.includes("sharing")).length * 3),
    ),
    technicalDebtScore,
    remediationCost,
    technicalDebtRatio,
    technicalDebtBreakdown: {
      apexViolations,
      securityIssues,
      flowComplexity,
      unusedMetadata
    },
    criticalIssues: criticalCount,
    mediumIssues: mediumCount,
    lowIssues: lowCount,
    issues: finalIssues,
    recommendations,
    fieldUsages,
  };
};
