import { GoogleGenAI, Type, FunctionDeclaration, GenerateContentResponse } from "@google/genai";
import { SalesforceOrgData, MetadataCategory, PRReviewResult } from "../types";
import { getRelevantSkills } from "./skillService";

const getComponentDetailsDeclaration: FunctionDeclaration = {
  name: "getComponentDetails",
  parameters: {
    type: Type.OBJECT,
    description: "Fetch the full content/code of a specific Salesforce component from the database.",
    properties: {
      category: {
        type: Type.STRING,
        description: "The metadata category (e.g., 'classes', 'flows', 'objects', 'triggers', 'quickActions', 'buttons').",
      },
      name: {
        type: Type.STRING,
        description: "The API name of the component.",
      },
    },
    required: ["category", "name"],
  },
};

export interface ChatResponse {
  text: string;
}

const isQuotaError = (error: any) => {
  return error.message?.includes("quota") || error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED");
};

export const getCodeSuggestions = async (
  category: string,
  name: string,
  content: string,
  userPrompt?: string,
  modelName: string = 'gemini-2.5-flash'
): Promise<string> => {
  const apiKeys = (process.env.GEMINI_API_KEY || '').split(',').filter(key => key.trim() !== '');
  if (apiKeys.length === 0) {
    throw new Error("API_KEY_MISSING");
  }

  // Fetch relevant specialized skills from AFV library (Firestore)
  const skills = await getRelevantSkills(category);
  const skillInstructions = skills.length > 0 
    ? `\nAGENT SKILLS & INSTRUCTIONS (Refer to these guidelines during analysis):\n${skills.map(s => `--- ${s.name} ---\n${s.content}`).join('\n\n')}\n`
    : '';

  let currentKeyIndex = 0;
  while (currentKeyIndex < apiKeys.length) {
    const apiKey = apiKeys[currentKeyIndex].trim();
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Review the following Salesforce ${category} named "${name}":
    
    ${content.substring(0, 30000)}
    
    ${skillInstructions}
    
    ${userPrompt ? `USER SPECIFIC REQUEST: ${userPrompt}` : `Please provide:
    1. **Code Quality Assessment**: Identify any potential bugs or performance issues.
    2. **Salesforce Best Practices**: Check against common standards (e.g., bulkification for Apex, component structure for LWC).
    3. **Security Review**: Identify any SOQL injection risks, CRUD/FLS bypasses, or other vulnerabilities.
    4. **Optimized Version**: Suggest a more efficient or cleaner version of a specific snippet if applicable.`}
    
    Format your response in clear Markdown.`;

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ parts: [{ text: prompt }] }],
      });
      return response.text || "No suggestions available.";
    } catch (error: any) {
      if (isQuotaError(error)) {
        currentKeyIndex++;
      } else {
        return "AI suggestions are currently unavailable for this component. Please try again later.";
      }
    }
  }
  return "AI suggestions are currently unavailable due to high demand. Please try again later.";
};

export const chatWithOrg = async (
  orgData: SalesforceOrgData, 
  userPrompt: string, 
  chatHistory: { role: 'user' | 'model', parts: any[] }[],
  modelName: string = 'gemini-2.5-pro',
  images: { data: string, mimeType: string }[] = []
): Promise<ChatResponse> => {
  const apiKeys = (process.env.GEMINI_API_KEY || '').split(',').filter(key => key.trim() !== '');
  if (apiKeys.length === 0) {
    throw new Error("API_KEY_MISSING: No Gemini API keys found. Please set VITE_GEMINI_API_KEYS in .env.example or use the platform's API key selector.");
  }

  let currentKeyIndex = 0;
  let response: any;

  while (currentKeyIndex < apiKeys.length) {
    const apiKey = apiKeys[currentKeyIndex].trim();
    const ai = new GoogleGenAI({ apiKey });

    // Prepare a condensed version of the metadata for context
    const metadataSummary = {
      objects: orgData.objects.map(o => ({
        name: o.name,
        label: o.label,
        isCustom: o.isCustom,
        synced: !!o.fields,
        fieldCount: o.fields?.length || 0,
        customFields: o.fields?.filter(f => f.isCustom).map(f => f.name).slice(0, 30)
      })),
      classes: orgData.classes.map(c => ({ name: c.name, synced: !!c.content })),
      flows: orgData.flows.map(f => ({ label: f.label, synced: !!f.content })),
      triggers: orgData.triggers.map(t => ({ name: t.name, synced: !!t.content })),
      quickActions: orgData.quickActions.map(q => ({ name: q.name, label: q.label, object: q.type, synced: !!q.content })),
      buttons: orgData.buttons.map(b => ({ name: b.name, label: b.label, object: b.type, synced: !!b.content })),
    };

    const systemInstruction = `
    You are an expert Salesforce Technical Architect and AI Assistant. 
    You have access to the metadata summary of the user's Salesforce Organization and a curated library of "Agent Skills" (Salesforce best practices and audit guidelines from forcedotcom/afv-library).
    
    ORG CONTEXT:
    - Org Name: ${orgData.orgName}
    - Metadata Summary: ${JSON.stringify(metadataSummary).substring(0, 8000)}
    
    YOUR CAPABILITIES:
    1. Answer questions about the Org's metadata.
    2. If you need to explain the logic, code, or flow of a SPECIFIC component (Class, Trigger, Flow, Object, QuickAction, Button), you MUST call the 'getComponentDetails' function to get its full content.
    3. Generate Mermaid diagrams (architecture, flow, sequence) based on the component details you fetch.
    4. You can analyze images (screenshots/snips) of Salesforce UIs, code, or diagrams to help the user.
    5. You are empowered by "Agent Skills" - you should strictly follow specialized audit instructions for Apex, LWC, and Flows provided in your context when analyzing them.
    
    MERMAID GUIDELINES:
    - Wrap Mermaid code in triple backticks with 'mermaid'.
    
    RETRIEVAL PROCESS:
    - If a user asks about a component you see in the summary but don't have details for (synced: false), use 'getComponentDetails'.
    - If 'getComponentDetails' returns "Component details not found in database", it means the component hasn't been retrieved from Salesforce yet. 
    - In such cases, you MUST inform the user that the component details are not yet in the local database and they should click the "Retrieve Component" button (for individual items) or "Retrieve All" (for the whole category) in the Metadata Hub to sync it.
    - Do NOT guess the code or flow if you can fetch it.
    `;

    const userParts: any[] = [{ text: userPrompt }];
    images.forEach(img => {
      userParts.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
    });

    const contents = [
      ...chatHistory.map(h => ({ role: h.role, parts: h.parts })), 
      { role: 'user', parts: userParts }
    ];

    try {
      response = await ai.models.generateContent({
        model: modelName,
        contents,
        config: {
          systemInstruction,
          temperature: 0.7,
          tools: [{ functionDeclarations: [getComponentDetailsDeclaration] }],
        },
      });

      if (!response.candidates || response.candidates.length === 0) {
        return { text: "I'm sorry, I couldn't generate a response. Please try rephrasing your question." };
      }

      // Handle potential function calls
      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        if (call.name === "getComponentDetails") {
          const { category, name } = call.args as { category: MetadataCategory, name: string };

          // Fetch from our backend DB endpoint
          const dbRes = await fetch(`/api/metadata/${orgData.orgId}/${category}/${name}`);
          let resultData = "Component details not found in database. The user needs to sync this component from Salesforce first.";
          if (dbRes.ok) {
            const data = await dbRes.json();
            resultData = `AI DOCUMENTATION:\n${data.explanation || 'Not generated yet.'}\n\nRAW CONTENT:\n${data.content}`;
          }

          // Send the function response back to Gemini
          const secondResponse = await ai.models.generateContent({
            model: modelName,
            contents: [
              ...contents,
              response.candidates[0].content, // Include the full model turn (thought + function call)
              { role: 'user', parts: [{ functionResponse: { name: call.name, response: { content: resultData } } }] }
            ],
            config: { systemInstruction }
          });

          // If the second response is still empty but has another candidate, try to get text from it
          const finalCandidate = secondResponse.candidates?.[0];
          const finalText = secondResponse.text || (finalCandidate?.content?.parts?.[0]?.text);

          return { text: finalText || "I fetched the details but couldn't summarize them. This might happen if the component is very large or complex. Please try asking a more specific question about it." };
        }
      }

      return { text: response.text || "I'm sorry, I couldn't generate a response. Please try again." };
    } catch (error: any) {
      console.error("Gemini Chat Error:", error);
      if (isQuotaError(error)) {
        currentKeyIndex++; // Try next key
      } else {
        throw new Error("API_ERROR: I encountered an error while processing your request. Please try again.");
      }
    }
  }
  throw new Error("QUOTA_EXHAUSTED"); // All API keys exhausted
};

export const getDeepResearchInsights = async (orgData: SalesforceOrgData, modelName: string = 'gemini-2.5-pro'): Promise<ChatResponse> => {
  const apiKeys = (process.env.GEMINI_API_KEY || '').split(',').filter(key => key.trim() !== '');
  if (apiKeys.length === 0) {
    throw new Error("API_KEY_MISSING: No Gemini API keys found. Please set VITE_GEMINI_API_KEYS in .env.example or use the platform's API key selector.");
  }

  let currentKeyIndex = 0;
  let response: any;

  while (currentKeyIndex < apiKeys.length) {
    const apiKey = apiKeys[currentKeyIndex].trim();
    const ai = new GoogleGenAI({ apiKey });
    
    const metadataSummary = {
      objects: orgData.objects.map(o => ({ name: o.name, label: o.label, isCustom: o.isCustom, fieldCount: o.fields?.length || 0 })),
      classes: orgData.classes.map(c => ({ name: c.name, apiVersion: c.apiVersion })),
      flows: orgData.flows.map(f => ({ label: f.label, status: f.status, type: f.type })),
      triggers: orgData.triggers.map(t => ({ name: t.name, object: t.tableEnumOrId })),
      permissionSets: orgData.permissionSets.map(p => ({ name: p.name, label: p.label })),
      profiles: orgData.profiles.map(p => ({ name: p.name, label: p.label }))
    };
    
    const systemInstruction = `
      You are an Elite Salesforce Technical Architect and Deep Research Auditor.
      Your task is to perform a COMPREHENSIVE ARCHITECTURAL SCAN of the Salesforce Org.
      
      ORG CONTEXT:
      - Org Name: ${orgData.orgName}
      - Instance: ${orgData.instance}
      - Metadata Summary: ${JSON.stringify(metadataSummary).substring(0, 10000)}
      
      CAPABILITIES:
      - You can fetch the full content of any component using 'getComponentDetails'.
      - Use this to deep-dive into complex areas (e.g., large Apex classes, complex Flows, critical Permission Sets).
      
      RESEARCH GOALS:
      1. Identify Technical Debt (Legacy API versions, redundant automations).
      2. Security Vulnerabilities (Over-permissive profiles, insecure code).
      3. Scalability Issues (Large objects, inefficient triggers).
      4. Best Practice Violations.
      
      REPORT STRUCTURE:
      1. EXECUTIVE SUMMARY
      2. DEEP-DIVE FINDINGS (Detail specific components you researched)
      3. SECURITY & COMPLIANCE
      4. TECHNICAL DEBT HEATMAP
      5. ACTIONABLE RECOMMENDATIONS
      6. ARCHITECTURAL HEALTH SCORE (0-100)
      
      Be thorough. If you see something suspicious in the summary, RESEARCH IT using the tool.
    `;

    const prompt = "Perform a Deep Research scan of this Salesforce Organization. Focus on finding hidden technical debt and security risks by examining key components.";

    try {
      response = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction,
          temperature: 0.2,
          tools: [{ functionDeclarations: [getComponentDetailsDeclaration] }],
        }
      });

      if (!response.candidates || response.candidates.length === 0) {
        return { text: "Deep Research engine failed to generate a report." };
      }

      // Handle function calls (Gemini might want to see some code before finishing the report)
      let currentTurn = response;
      let iterations = 0;
      const MAX_ITERATIONS = 5; // Limit deep research turns to avoid excessive API usage

      while (currentTurn.functionCalls && iterations < MAX_ITERATIONS) {
        const calls = currentTurn.functionCalls;
        const functionResponses = await Promise.all(calls.map(async (call: any) => {
          if (call.name === "getComponentDetails") {
            const { category, name } = call.args as { category: MetadataCategory, name: string };
            const dbRes = await fetch(`/api/metadata/${orgData.orgId}/${category}/${name}`);
            let resultData = "Component details not found in database.";
            if (dbRes.ok) {
              const data = await dbRes.json();
              resultData = `CONTENT OF ${name}:\n${data.content}`;
            }
            return { functionResponse: { name: call.name, response: { content: resultData } } };
          }
          return { functionResponse: { name: call.name, response: { content: "Unknown function" } } };
        }));

        currentTurn = await ai.models.generateContent({
          model: modelName,
          contents: [
            { role: 'user', parts: [{ text: prompt }] },
            currentTurn.candidates[0].content,
            { role: 'user', parts: functionResponses }
          ],
          config: { systemInstruction }
        });
        iterations++;
      }

      return { text: currentTurn.text || "Deep Research report generation failed." };
    } catch (error: any) {
      console.error("Gemini Deep Research Error:", error);
      if (isQuotaError(error)) {
        currentKeyIndex++; // Try next key
      } else {
        throw new Error("API_ERROR: Deep Research failed due to an API error. Please try again.");
      }
    }
  }
  throw new Error("QUOTA_EXHAUSTED");
};

export const explainMetadata = async (
  category: MetadataCategory,
  name: string,
  content: string,
  modelName: string = 'gemini-2.5-flash'
): Promise<{ explanation: string; mermaidCode: string | null }> => {
  const apiKeys = (process.env.GEMINI_API_KEY || '').split(',').filter(key => key.trim() !== '');
  if (apiKeys.length === 0) {
    throw new Error("API_KEY_MISSING: No Gemini API keys found. Please set VITE_GEMINI_API_KEYS in .env.example or use the platform's API key selector.");
  }

  let currentKeyIndex = 0;
  let response: any;

  // Fetch relevant specialized skills from AFV library (Firestore)
  const skills = await getRelevantSkills(category);
  const skillInstructions = skills.length > 0 
    ? `\nAGENT SKILLS & INSTRUCTIONS (Refer to these guidelines during analysis):\n${skills.map(s => `--- ${s.name} ---\n${s.content}`).join('\n\n')}\n`
    : '';

  while (currentKeyIndex < apiKeys.length) {
    const apiKey = apiKeys[currentKeyIndex].trim();
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
    Analyze the following Salesforce ${category} component named "${name}".
    
    CONTENT:
    ${content.substring(0, 20000)}
    ${content.length > 20000 ? '\n    (Content truncated due to length limit)' : ''}
    
    ${skillInstructions}
    
    REQUIREMENTS BASED ON CATEGORY:
    ${category === 'objects' ? `
    1. Provide ONLY a "High-Level Summary" of what this object represents in the business context.
    2. The summary MUST be exactly 3 to 4 lines long.
    3. Do NOT use markdown headers (like "### High-Level Summary"). Just the text.
    4. Do NOT include field lists, relationship details, or diagrams in the text summary.
    5. Generate a Mermaid Entity Relationship Diagram (\`erDiagram\`) showing this object and its relationships (Lookup/MasterDetail) to other objects found in the content. Format: \`ENTITY ||--o{ OTHER_ENTITY : relationship_name\`.
    ` : category === 'buttons' || category === 'quickActions' ? `
    1. Provide an overall summary indicating what the custom button or action is about (e.g., if it's calling a flow or an LWC component).
    2. Generate a Mermaid Flowchart diagram that explains the precise logic flow:
       - Start with a node: "User clicks the [Button/Action Name]".
       - If it invokes a Flow, add a node: "Flow [Flow Name] is invoked".
       - If it invokes an LWC, add a node: "LWC [LWC Name] is invoked".
       - Detail the internal steps:
         - Use decision diamonds for conditional logic (e.g., "Is record active?").
         - Use process boxes for "Get Records", "Update Records", or "Apex Calls".
         - End with a node: "[Flow/LWC] execution completed".
    3. The diagram MUST be wrapped in \`\`\`mermaid ... \`\`\`.
    4. To prevent text overflow in the diagram:
       - Use short, concise labels for nodes.
       - Use the <br/> tag for line breaks in long labels.
       - Use the 'flowchart TD' (Top-Down) orientation.
    5. Do NOT provide "Action Type", "Business Logic", or "Where it is used" in the text summary.
    ` : category === 'validationRules' ? `
    1. Provide a "High-Level Summary" with a simple, easy-to-understand explanation of what this validation rule does and why it exists.
    2. Focus ONLY on the business intent and user impact (e.g., "Ensures data integrity by preventing users from closing an Opportunity if the required inspection files are missing").
    3. Keep it exactly 3 to 4 lines long.
    4. Do NOT include technical formula breakdown, "Code Analysis", "Flow Logic", or "Permission Set Analysis".
    5. Do NOT use markdown headers (like "### High-Level Summary"). Just the text.
    6. Omit all section headers.
    ` : `
    1. Provide a high-level summary of what this component does.
    2. If it's code (Apex Class, Trigger, etc.), identify the core logic and explain what it does in simple terms. Avoid long technical dumps.
       - For Apex Classes: Generate a Mermaid Class Diagram showing the class structure, main attributes, and methods. Use standard class diagram syntax.
       - For Triggers: Generate a Mermaid Flowchart diagram showing the logic flow from trigger events to actions.
    3. If it's an LWC (Lightning Web Component), explain the component's purpose and its interaction with data/Apex.
       - For LWCs: Generate a Mermaid Flowchart diagram that explains the component lifecycle, main events, and communication with Apex (like @wire or imperative calls).
    4. If it's a Flow or Process Builder, explain the logic path and actions. For Flows, generate a Mermaid Flowchart diagram.
    5. Do NOT include a "Permission Set Analysis" section or a "Conclusion" section.
    6. If a section is not applicable, simply OMIT it. Do NOT write "Not Applicable".
    `}
    
    GENERAL GUIDELINES:
    - Use clear, professional language.
    - Format the output in Markdown.
    - ALWAYS generate a Mermaid diagram if the component is an Apex Class, Trigger, LWC, Flow, or Object.
    - Wrap the Mermaid code in triple backticks with 'mermaid'.
    - IMPORTANT: For Mermaid diagrams:
        1. For Flowcharts: Use double quotes for ALL labels (e.g., A["Label with spaces"]). NEVER use unquoted parentheses, braces, quotes, or special characters inside node labels. If a label contains quotes, use single quotes instead of double quotes inside the label. Do NOT use curly braces {} around nodes unless it's a standard flowchart shape, and if so, double quote the text inside (e.g., A{{"Decision"}}).
        2. For ER Diagrams: DO NOT use quotes around entity names. Use standard relationships: ||--o{, ||--||, }|--|{. Don't add spaces in entity names. Use underscores instead of spaces.
        3. Avoid using reserved words (like 'end', 'graph', 'subgraph') as identifiers unless quoted mapping.
        4. Ensure all brackets, parentheses, and braces are correctly balanced. Avoid nested quotes within node labels.
        5. For Class Diagrams, use standard relationship syntax: <|-- (inheritance), *-- (composition), o-- (aggregation), --> (association).
        6. Keep diagrams concise and readable. Use short labels.
  `;

    try {
      response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          temperature: 0.2,
        }
      });

      const fullText = response.text || "No explanation generated.";
      const mermaidMatch = fullText.match(/```\s*mermaid\s*([\s\S]*?)\s*```/i);
      const mermaidCode = mermaidMatch ? mermaidMatch[1].trim() : null;
      const explanation = mermaidMatch ? fullText.replace(mermaidMatch[0], '').trim() : fullText;

      return { explanation, mermaidCode };
    } catch (error: any) {
      console.error("Gemini Explanation Error:", error);
      if (isQuotaError(error)) {
        currentKeyIndex++; // Try next key
      } else {
        return { explanation: "AI documentation generation failed for this component. You can try 'Retrieve Component' to regenerate.", mermaidCode: null };
      }
    }
  }
  return { explanation: "AI documentation generation is currently unavailable due to high demand. Please try again later.", mermaidCode: null }; // All API keys exhausted
};

export const getFieldUsageSummary = async (
  fieldName: string,
  usages: { componentName: string, snippet: string, type: string }[],
  modelName: string = 'gemini-2.5-flash'
): Promise<string> => {
  const apiKeys = (process.env.GEMINI_API_KEY || '').split(',').filter(key => key.trim() !== '');
  if (apiKeys.length === 0) return "AI summary unavailable.";

  let currentKeyIndex = 0;
  while (currentKeyIndex < apiKeys.length) {
    const apiKey = apiKeys[currentKeyIndex].trim();
    const ai = new GoogleGenAI({ apiKey });
    
    // Filter usages to only include Apex Classes, Triggers, LWCs, and Visualforce Pages
    const filteredUsages = usages.filter(u => ['classes', 'triggers', 'lwcs', 'vfPages'].includes(u.type));
    
    if (filteredUsages.length === 0) return "No usage found in Apex Classes, Triggers, LWCs, or Visualforce Pages.";

    const prompt = `Analyze the usage of the Salesforce field "${fieldName}" in the following components.
    
    For each component listed below, provide a concise point-by-point summary explaining:
    1. WHY it is being used in that specific component.
    2. WHAT is its purpose in that context.

    Make sure to list the reason component by component, one by one.

    USAGES DATA:
    ${filteredUsages.map(u => `- [${u.type}] ${u.componentName}: ${u.snippet}`).join('\n')}
    
    Format your response as a JSON object where the keys are the component names and the values are the explanations.
    Example:
    {
      "AccountTrigger": "Used to validate the field value before insert...",
      "AccountController": "Used to fetch the field for display in the UI..."
    }
    
    Return ONLY the JSON object. No other text.`;

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ parts: [{ text: prompt }] }],
      });
      const text = response.text || "{}";
      // Ensure we only return valid JSON string
      const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
      try {
        JSON.parse(jsonStr); // Validate JSON
        return jsonStr;
      } catch (parseError) {
        console.warn("Gemini returned invalid JSON for usage summary:", text);
        return "{}";
      }
    } catch (e: any) {
      if (isQuotaError(e)) {
        currentKeyIndex++;
      } else {
        console.warn("Gemini API error in getFieldUsageSummary:", e);
        return "{}";
      }
    }
  }
  return "{}";
};

export const getAutomationSummary = async (
  name: string,
  type: string,
  content: string,
  modelName: string = 'gemini-2.5-flash'
): Promise<string> => {
  const apiKeys = (process.env.GEMINI_API_KEY || '').split(',').filter(key => key.trim() !== '');
  if (apiKeys.length === 0) return "AI summary unavailable.";

  let currentKeyIndex = 0;
  while (currentKeyIndex < apiKeys.length) {
    const apiKey = apiKeys[currentKeyIndex].trim();
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Provide a clear, highly readable summary explaining the business logic of the following Salesforce ${type} named "${name}":
    
    ${content.substring(0, 10000)}
    
    Format the output properly using Markdown to make it visually scannable. 
    Review the logic and highlight (using **bold** text) any critical fields, objects, object relationships, or key decision paths. 
    Use bullet points to outline the step-by-step triggers, conditions, and actions if applicable. Include a short high-level summary paragraph at the top.`;

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ parts: [{ text: prompt }] }],
      });
      return response.text || "No summary available.";
    } catch (e: any) {
      if (isQuotaError(e)) {
        currentKeyIndex++;
      } else {
        return "AI summary generation failed.";
      }
    }
  }
  return "AI summary unavailable due to quota limits.";
};

export const analyzeValidationRuleMerge = async (
  rule1: { name: string, formula: string, errorMessage: string },
  rule2: { name: string, formula: string, errorMessage: string },
  modelName: string = 'gemini-2.5-flash'
): Promise<{ canMerge: boolean, mergedFormula: string | null, mergedErrorMessage: string | null, reasoning: string }> => {
  const apiKeys = (process.env.GEMINI_API_KEY || '').split(',').filter(key => key.trim() !== '');
  if (apiKeys.length === 0) {
    return { canMerge: false, mergedFormula: null, mergedErrorMessage: null, reasoning: "API key missing." };
  }

  let currentKeyIndex = 0;
  while (currentKeyIndex < apiKeys.length) {
    const apiKey = apiKeys[currentKeyIndex].trim();
    const ai = new GoogleGenAI({ apiKey });
    
    const prompt = `Analyze these two Salesforce Validation Rules and determine if they can be logically merged into a single rule.
    
    RULE 1:
    Name: ${rule1.name}
    Formula: ${rule1.formula}
    Error Message: ${rule1.errorMessage}
    
    RULE 2:
    Name: ${rule2.name}
    Formula: ${rule2.formula}
    Error Message: ${rule2.errorMessage}
    
    CRITERIA FOR MERGING:
    1. The formulas must be logically compatible (e.g., checking different conditions on the same field or related business logic).
    2. The error messages must be mergeable into a single coherent message that covers both cases.
    3. Merging should not result in a formula that is too complex or exceeds Salesforce limits.
    
    If they can be merged, provide the merged formula and merged error message.
    If they cannot be merged (e.g., they cover completely unrelated logic or have conflicting error messages), set canMerge to false.
    
    Return your analysis as a JSON object.`;

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              canMerge: { type: Type.BOOLEAN },
              mergedFormula: { type: Type.STRING },
              mergedErrorMessage: { type: Type.STRING },
              reasoning: { type: Type.STRING }
            },
            required: ["canMerge", "reasoning", "mergedFormula", "mergedErrorMessage"]
          }
        }
      });

      const result = JSON.parse(response.text || "{}");
      return {
        canMerge: !!result.canMerge,
        mergedFormula: result.mergedFormula || null,
        mergedErrorMessage: result.mergedErrorMessage || null,
        reasoning: result.reasoning || "No reasoning provided."
      };
    } catch (e: any) {
      if (isQuotaError(e)) {
        currentKeyIndex++;
      } else {
        console.error("Error in analyzeValidationRuleMerge:", e);
        return { canMerge: false, mergedFormula: null, mergedErrorMessage: null, reasoning: "AI analysis failed." };
      }
    }
  }
  return { canMerge: false, mergedFormula: null, mergedErrorMessage: null, reasoning: "Quota exhausted." };
};

export const analyzeReleaseImpact = async (
  releaseNotes: any[],
  orgData: SalesforceOrgData,
  modelName: string = 'gemini-2.5-pro'
): Promise<string> => {
  const apiKeys = (process.env.GEMINI_API_KEY || '').split(',').filter(key => key.trim() !== '');
  if (apiKeys.length === 0) throw new Error("API_KEY_MISSING");

  let currentKeyIndex = 0;
  while (currentKeyIndex < apiKeys.length) {
    const apiKey = apiKeys[currentKeyIndex].trim();
    const ai = new GoogleGenAI({ apiKey });

    // Prepare a condensed version of the metadata for context
    const metadataSummary = {
      objects: orgData.objects.map(o => ({ name: o.name, label: o.label, isCustom: o.isCustom })),
      classes: orgData.classes.map(c => ({ name: c.name })),
      flows: orgData.flows.map(f => ({ label: f.label })),
      triggers: orgData.triggers.map(t => ({ name: t.name })),
      layouts: orgData.layouts.map(l => ({ name: l.name, id: l.id, contentSnippet: l.content?.substring(0, 500) })),
    };

    const prompt = `
      Analyze the following Salesforce Release Notes against the provided Org Metadata Summary.
      
      RELEASE NOTES:
      ${JSON.stringify(releaseNotes).substring(0, 15000)}
      
      ORG METADATA SUMMARY:
      ${JSON.stringify(metadataSummary).substring(0, 8000)}
      
      TASK:
      1. **Impact Analysis**: Identify potential impacts of the new release on the existing org based on the metadata provided.
      2. **Removals & Expirations**: Flag any features, APIs, or components that are being removed or expiring in this release.
      3. **Relevant Articles**: Pull out and list relevant Salesforce Help articles or documentation links that would be useful for this specific org's transition.
      4. **Layout Analysis**: Review the layouts provided in the summary. If you detect potential redundancies (e.g., multiple layouts for the same object that seem identical or very similar), notify the user. 
         - Specifically, if a layout like "Corporate Account" matches a standard "Account" layout, suggest removal.
         - Use the message: "This layout is an exact match with the existing one, which is the [Standard Layout Name] layout. Therefore, you can consider this one for removal."
      5. **Action Items**: Provide a prioritized list of actions for the Salesforce team.
      
      Format your response in professional Markdown with clear headings and bullet points.
    `;

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ parts: [{ text: prompt }] }],
        config: { temperature: 0.2 }
      });
      return response.text || "No impact analysis generated.";
    } catch (error: any) {
      if (isQuotaError(error)) {
        currentKeyIndex++;
      } else {
        console.error("Release Impact Analysis Error:", error);
        return "Failed to analyze release impact.";
      }
    }
  }
  return "Release impact analysis unavailable due to quota limits.";
};

export const enrichReleaseNotesLinks = async (
  features: any[],
  releaseName: string,
  modelName: string = 'gemini-2.5-flash'
): Promise<any[]> => {
  const apiKeys = (process.env.GEMINI_API_KEY || '').split(',').filter(key => key.trim() !== '');
  if (apiKeys.length === 0) throw new Error("API_KEY_MISSING");

  let currentKeyIndex = 0;
  while (currentKeyIndex < apiKeys.length) {
    const apiKey = apiKeys[currentKeyIndex].trim();
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
      For each feature in the following list from the Salesforce ${releaseName} Release Notes, find the official Salesforce Help or Release Notes URL.
      
      FEATURES:
      ${JSON.stringify(features.map(f => ({ title: f.title, description: f.description })))}
      
      TASK:
      - Use Google Search to find the most accurate URL for each feature.
      - Return a JSON array of objects, each containing:
        - title: The original feature title
        - Links: An array of { label: string, url: string } objects.
      
      Example Output:
      [
        { "title": "Feature A", "Links": [{ "label": "Official Help", "url": "https://help.salesforce.com/..." }] }
      ]
      
      Return ONLY the JSON array.
    `;

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json"
        }
      });
      return JSON.parse(response.text || "[]");
    } catch (error: any) {
      if (isQuotaError(error)) {
        currentKeyIndex++;
      } else {
        console.error("Enrichment Error:", error);
        return [];
      }
    }
  }
  return [];
};

export const refreshSCARuleLinks = async (
  rules: any[],
  modelName: string = 'gemini-2.5-flash'
): Promise<any[]> => {
  const apiKeys = (process.env.GEMINI_API_KEY || '').split(',').filter(key => key.trim() !== '');
  if (apiKeys.length === 0) throw new Error("API_KEY_MISSING");

  let currentKeyIndex = 0;
  while (currentKeyIndex < apiKeys.length) {
    const apiKey = apiKeys[currentKeyIndex].trim();
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
      For each Salesforce Static Code Analysis (SCA) / PMD rule in the following list, find the official Salesforce Help, Developer Documentation, or official PMD reference URL.
      
      RULES:
      ${JSON.stringify(rules.map(r => ({ name: r.name, description: r.description })))}
      
      TASK:
      - Use Google Search to find the most accurate and official documentation URL for each rule on Salesforce-specific sites AND the official PMD documentation URL.
      - You MUST prioritize help.salesforce.com, developer.salesforce.com, or the Salesforce Apex Security Guide for the 'sfUrl'.
      - For 'pmdUrl', use the official pmd.github.io URL.
      - Return a JSON array of objects, each containing:
        - name: The original rule name
        - sfUrl: The official Salesforce documentation URL
        - pmdUrl: The official PMD documentation URL
      
      Example Output:
      [
        { "name": "ApexSOQLInjection", "url": "https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_security_sharing_rules.htm" }
      ]
      
      Return ONLY the JSON array.
    `;

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json"
        }
      });
      return JSON.parse(response.text || "[]");
    } catch (error: any) {
      if (isQuotaError(error)) {
        currentKeyIndex++;
      } else {
        console.error("SCA Rule Link Refresh Error:", error);
        return [];
      }
    }
  }
  return [];
};

export const reviewPRDiff = async (
  diffs: { filename: string; patch: string }[],
  modelName: string = 'gemini-2.5-flash'
): Promise<PRReviewResult[]> => {
  const apiKeys = (process.env.GEMINI_API_KEY || '').split(',').filter(key => key.trim() !== '');
  if (apiKeys.length === 0) {
    throw new Error("No Gemini API keys found.");
  }

  let currentKeyIndex = 0;
  while (currentKeyIndex < apiKeys.length) {
    const apiKey = apiKeys[currentKeyIndex].trim();
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `You are an expert Salesforce Tech Lead and Code Reviewer.
Evaluate the following GitHub pull request file diffs for:
1. Standard Salesforce best practices (e.g., bulkification, avoiding SOQL in loops).
2. PMD analysis rules.
3. Showstopper issues (critical security, huge performance bugs) that MUST be fixed.

For each file, determine if there are issues. If there's a showstopper, mark isShowStopper: true.
Provide comments focusing only on important miss or problem context.
Do not comment on trivial stylistic choices.
If a file has NO issues, do not include it in your output.

Diffs:
${diffs.map(d => `--- FILE: ${d.filename} ---\n${d.patch}`).join('\n\n')}

Reply ONLY with a strictly valid JSON array describing the issues.
Format:
[
  {
    "file": "path/filename.cls",
    "issues": ["SOQL query inside a for loop.", "No null check on variable x."],
    "isShowStopper": true,
    "comments": ["Please move the SOQL query out of the loop to avoid hitting governor limits.", "Add a null check."]
  }
]`;

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json"
        }
      });
      const text = response.text || "[]";
      return JSON.parse(text);
    } catch (error: any) {
      if (isQuotaError(error)) {
        currentKeyIndex++;
      } else {
        console.error("PR Review Error:", error);
        throw error;
      }
    }
  }
  throw new Error("All API keys exhausted.");
};
