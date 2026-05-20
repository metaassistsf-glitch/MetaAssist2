import { collection, getDocs, doc, setDoc } from "firebase/firestore";
import { db } from "../firebase";

const SAMPLE_SKILLS = [
  {
    id: "apex-security-best-practices",
    name: "Apex Security & Performance (AFV)",
    description: "Curated instructions for auditing Apex Classes for security and performance vulnerabilities.",
    category: "classes",
    source: "forcedotcom/afv-library",
    content: `
# Apex Security & Performance Guidelines

## Security (CRUD/FLS & Sharing)
- **Database Operations**: Always check for 'WITH USER_MODE' or 'Security.stripInaccessible' when performing DML.
- **Sharing**: Explicitly declare 'with sharing', 'without sharing', or 'inherited sharing'.
- **SOQL Injection**: Use bind variables instead of string concatenation in dynamic queries.

## Performance & Scalability
- **Bulkification**: Ensure all SOQL and DML are outside of loops.
- **Query Selectivity**: Only query necessary fields. Avoid 'SELECT *' equivalents by listing fields.
- **Heap Size**: Avoid loading large datasets into memory at once. Use SOQL for loops for large results.
- **Limits**: Monitor SOQL and DML limits within a single transaction.
    `
  },
  {
    id: "lwc-design-patterns",
    name: "LWC Modern Patterns",
    description: "Instructions for building scalable and performant Lightning Web Components.",
    category: "lwcs",
    source: "forcedotcom/afv-library",
    content: `
# LWC Design Patterns

## Component Composition
- **Decoupling**: Keep components small and focused. Use events for parent communication.
- **Properties**: Use 'api' decorators for public properties and @track for reactive private state.

## Performance
- **Wire Service**: Use @wire for reactive data fetching whenever possible.
- **DOM Access**: Minimize direct DOM manipulation (this.template.querySelector). Use data binding.
- **Asset Loading**: Use loadScript/loadStyle for external assets to ensure proper caching.
    `
  },
  {
    id: "flow-optimization",
    name: "Flow Orchestration Best Practices",
    description: "Guidelines for designing efficient and maintainable Salesforce Flows.",
    category: "flows",
    source: "forcedotcom/afv-library",
    content: `
# Flow Optimization Guidelines

## Design Strategy
- **Minimize Elements**: Avoid unnecessary loop iterations or redundant Get Records elements.
- **Loop Best Practices**: NEVER put DML (Create/Update Records) or Get Records inside a loop. Use collections.
- **Decision Logic**: Place the most likely outcomes at the beginning of decisions.

## Error Handling
- **Fault Paths**: Always include fault paths for DML elements to prevent silent failures.
- **User Feedback**: provide clear error messages via Screen elements or logs.
    `
  }
];

async function runSeed() {
  console.log("🚀 Starting Seeding Process...");
  try {
    const skillsRef = collection(db, "skills");
    for (const skill of SAMPLE_SKILLS) {
      console.log(`- Seeding: ${skill.name}`);
      await setDoc(doc(skillsRef, skill.id), {
        ...skill,
        updatedAt: new Date().toISOString()
      });
    }
    console.log("✅ Seeding Complete!");
  } catch (error) {
    console.error("❌ Seeding Failed:", error);
  }
}

runSeed();
