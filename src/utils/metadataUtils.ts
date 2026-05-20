
export interface RelatedMetadata {
  layouts?: any[];
  validationRules?: any[];
  flexiPages?: any[];
  compactLayouts?: any[];
  buttons?: any[];
  quickActions?: any[];
  automation?: any[];
}

export interface ParsedObjectMetadata {
  fields: any[];
  related: RelatedMetadata;
}

export const parseObjectXml = (xmlString: string): ParsedObjectMetadata => {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    
    // Check for parsing errors
    const parserError = xmlDoc.getElementsByTagName("parsererror");
    if (parserError.length > 0) {
      console.warn("XML Parsing Error", parserError[0].textContent);
    }

    const fields: any[] = [];
    const fieldNodes = xmlDoc.querySelectorAll("fields");
    
    fieldNodes.forEach(node => {
      const fullName = node.querySelector("fullName")?.textContent || "";
      const label = node.querySelector("label")?.textContent || "";
      const type = node.querySelector("type")?.textContent || "";
      const required = node.querySelector("required")?.textContent === "true";
      
      if (fullName) {
        fields.push({
          name: fullName,
          label: label || fullName,
          type: type || "Unknown",
          isCustom: fullName.endsWith("__c"),
          required: required
        });
      }
    });

    // Extract related metadata if present in the XML
    const layouts: any[] = [];
    xmlDoc.querySelectorAll("layouts").forEach(node => {
      const name = node.querySelector("layout")?.textContent;
      if (name) layouts.push({ name, id: name, type: 'Layout' });
    });

    const validationRules: any[] = [];
    xmlDoc.querySelectorAll("validationRules").forEach(node => {
      const name = node.querySelector("fullName")?.textContent;
      const description = node.querySelector("description")?.textContent;
      const active = node.querySelector("active")?.textContent === "true";
      if (name) validationRules.push({ name, id: name, active, description, type: 'Validation Rule' });
    });

    const flexiPages: any[] = [];
    xmlDoc.querySelectorAll("flexiPages").forEach(node => {
      const name = node.querySelector("flexiPage")?.textContent;
      const type = node.querySelector("type")?.textContent;
      if (name) flexiPages.push({ name, id: name, type: type || 'FlexiPage' });
    });

    const compactLayouts: any[] = [];
    xmlDoc.querySelectorAll("compactLayouts").forEach(node => {
      const name = node.querySelector("fullName")?.textContent;
      if (name) compactLayouts.push({ name, id: name, type: 'Compact Layout' });
    });

    const buttons: any[] = [];
    xmlDoc.querySelectorAll("webLinks").forEach(node => {
      const name = node.querySelector("fullName")?.textContent;
      if (name) buttons.push({ name, id: name, type: 'Web Link / Button' });
    });

    const quickActions: any[] = [];
    xmlDoc.querySelectorAll("quickActions").forEach(node => {
      const name = node.querySelector("fullName")?.textContent;
      if (name) quickActions.push({ name, id: name, type: 'Quick Action' });
    });

    const automation: any[] = [];
    xmlDoc.querySelectorAll("workflowRules").forEach(node => {
      const name = node.querySelector("fullName")?.textContent;
      if (name) automation.push({ name, id: name, type: 'Workflow Rule' });
    });

    return { 
      fields, 
      related: {
        layouts,
        validationRules,
        flexiPages,
        compactLayouts,
        buttons,
        quickActions,
        automation
      }
    };
  } catch (e) {
    console.error("Failed to parse Object XML", e);
    return { fields: [], related: {} };
  }
};

export const getFieldsFromContent = (content: string): ParsedObjectMetadata => {
  if (!content) return { fields: [], related: {} };
  const trimmed = content.trim();
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<CustomObject')) {
     return parseObjectXml(content);
  } else {
     try {
       const describe = JSON.parse(content);
       const fields = describe.fields.map((f: any) => ({
         name: f.name,
         label: f.label,
         type: f.type,
         isCustom: f.custom || f.name.endsWith("__c"),
         required: !f.nillable
       }));
       return { fields, related: {} };
     } catch (e) {
       return { fields: [], related: {} };
     }
  }
};

export const findUsageSnippets = (fieldName: string, content: string) => {
  if (!content) return [];
  const lines = content.split('\n');
  const snippets: { line: number, text: string }[] = [];
  const regex = new RegExp(`\\b${fieldName}\\b`, 'i');
  
  lines.forEach((line, index) => {
    if (regex.test(line)) {
      snippets.push({ line: index + 1, text: line.trim() });
    }
  });
  
  return snippets.slice(0, 3); // Return up to 3 snippets
};

export const getFormulaFromContent = (content: string): string | null => {
  if (!content) return null;
  // Try to parse XML
  if (content.trim().startsWith('<')) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(content, "text/xml");
    const formula = xmlDoc.querySelector("formula")?.textContent || xmlDoc.querySelector("errorConditionFormula")?.textContent;
    return formula || null;
  }
  // Try JSON
  try {
    const json = JSON.parse(content);
    return json.formula || json.calculatedFormula || json.errorConditionFormula || null;
  } catch (e) {
    return null;
  }
};

export const getValidationRuleDetails = (content: string) => {
  if (!content) return null;
  try {
    if (content.trim().startsWith('<')) {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(content, "text/xml");
      return {
        description: xmlDoc.querySelector("description")?.textContent || null,
        errorConditionFormula: xmlDoc.querySelector("errorConditionFormula")?.textContent || null,
        errorDisplayField: xmlDoc.querySelector("errorDisplayField")?.textContent || null,
        errorMessage: xmlDoc.querySelector("errorMessage")?.textContent || null,
        active: xmlDoc.querySelector("active")?.textContent === "true"
      };
    }
    const json = JSON.parse(content);
    return {
      description: json.description || null,
      errorConditionFormula: json.errorConditionFormula || json.formula || null,
      errorDisplayField: json.errorDisplayField || null,
      errorMessage: json.errorMessage || null,
      active: json.active !== false
    };
  } catch (e) {
    return null;
  }
};

export const calculateMatchPercentage = (content1: string, content2: string) => {
  if (!content1 || !content2) return 0;
  // Simple word-based similarity for layouts/metadata
  const words1 = content1.toLowerCase().split(/[^a-z0-9]/).filter(w => w.length > 3);
  const words2 = content2.toLowerCase().split(/[^a-z0-9]/).filter(w => w.length > 3);
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : (intersection.size / union.size) * 100;
};
