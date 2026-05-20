
import 'dotenv/config';
import express from "express";
import path from "path";
import crypto from "crypto";

console.log("************************************************************");
console.log("⚠️  SECURITY WARNING: SSL VERIFICATION IS DISABLED");
console.log("⚠️  This is only for local development behind strict proxies.");
console.log("************************************************************");

import { explainMetadata, enrichReleaseNotesLinks } from "./services/geminiService";
import { MetadataCategory } from "./types";
import { SalesforceService } from "./services/salesforceService";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { refreshSCARuleLinks } from "./services/geminiService";
import { PMD_RULES } from "./src/constants";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let firebaseConfig: any = {};
try {
  firebaseConfig = require('./firebase-applet-config.json');
} catch (e) {
  console.warn("Could not load firebase-applet-config.json");
}

// Lazy Firebase Initialization
let db: admin.firestore.Firestore | null = null;

function getDb() {
  if (!db) {
    const envProjectId = process.env.FIREBASE_PROJECT_ID;
    const projectId = envProjectId || firebaseConfig.projectId;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    
    // Determine the correct database ID:
    // 1. Use FIREBASE_DATABASE_ID from env if present.
    // 2. If using the project from config, use the database from config.
    // 3. Default to '(default)'.
    let databaseId = process.env.FIREBASE_DATABASE_ID;
    if (!databaseId) {
      if (!envProjectId && firebaseConfig.firestoreDatabaseId) {
        databaseId = firebaseConfig.firestoreDatabaseId;
      } else {
        databaseId = '(default)';
      }
    }
    
    if (privateKey) {
      // ... (existing key cleaning logic)
      privateKey = privateKey.trim().replace(/^["']|["']$/g, '');
      privateKey = privateKey.split('\\n').join('\n');
      privateKey = privateKey.split('\\\\n').join('\n');
      privateKey = privateKey.split('\\r').join('\r');
      privateKey = privateKey.split('\n').map(line => line.trim()).join('\n');
      privateKey = privateKey.trim();
    }

    if (projectId && clientEmail && privateKey) {
      try {
        if (admin.apps.length === 0) {
          admin.initializeApp({
            credential: admin.credential.cert({
              projectId,
              clientEmail,
              privateKey,
            }),
          });
        }

        db = getFirestore(admin.app(), databaseId);
        db.settings({ ignoreUndefinedProperties: true });
        
        console.log(`✅ Firebase initialized successfully for project: ${projectId}, database: ${databaseId}`);
      } catch (error: any) {
        console.error("❌ Firebase initialization failed:", error.message);
      }
    } else {
      console.warn("⚠️ Firebase credentials missing in environment.");
    }
  }
  return db;
}

async function syncSCARules() {
  const firestore = getDb();
  if (!firestore) return;

  try {
    console.log("🔍 Checking SCA Rules for updates...");
    const rulesRef = firestore.collection("sca_config").doc("pmd_rules");
    const doc = await rulesRef.get();
    
    let rulesToStore = { ...PMD_RULES };
    const lastUpdated = doc.exists ? doc.data()?.lastUpdated : null;
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const needsRefresh = !lastUpdated || new Date(lastUpdated) < oneWeekAgo;

    if (needsRefresh) {
      console.log("🔄 Periodically refreshing SCA Rule URLs via Gemini...");
      try {
        const refreshedLinks = await refreshSCARuleLinks(Object.values(PMD_RULES));
        if (refreshedLinks && refreshedLinks.length > 0) {
          Object.keys(rulesToStore).forEach(key => {
            const rule = (rulesToStore as any)[key];
            const match = refreshedLinks.find((rl: any) => rl.name.toLowerCase() === rule.name.toLowerCase());
            if (match) {
              if (match.sfUrl) rule.sfUrl = match.sfUrl;
              if (match.pmdUrl) rule.pmdUrl = match.pmdUrl;
            }
          });
        }
      } catch (refreshError) {
        console.error("Failed to refresh SCA rule links in background", refreshError);
      }
      
      await rulesRef.set({
        rules: rulesToStore,
        lastUpdated: new Date().toISOString()
      }, { merge: true });
      console.log("✅ SCA Rules synced to database.");
    } else {
      console.log("✅ SCA Rules are up to date.");
    }
  } catch (error) {
    console.error("Failed to sync SCA rules in background", error);
  }
}

// Run sync on startup
syncSCARules();
// And every 24 hours
setInterval(syncSCARules, 24 * 60 * 60 * 1000);

function handleFirestoreError(error: any, res: express.Response, message: string) {
  console.error(`${message}:`, error);
  if (error.code === 8 || error.message?.includes('RESOURCE_EXHAUSTED') || error.message?.includes('Quota exceeded')) {
    return res.status(429).json({ 
      error: "Firestore Quota Exceeded", 
      message: "The application has reached its database write quota for today. This is a limit of the free Firebase Spark plan. Please try again tomorrow or upgrade your Firebase plan.",
      isQuotaExceeded: true
    });
  }
  res.status(500).json({ error: message, details: error.message });
}

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Salesforce OAuth Routes
  app.all("/api/auth/salesforce/url", async (req, res) => {
    const instanceUrl = req.query.instanceUrl || req.body?.instanceUrl;
    const username = req.query.username || req.body?.username;
    let clientId = req.query.clientId || req.body?.clientId;

    if (!instanceUrl) {
      return res.status(400).json({ error: "instanceUrl is required" });
    }

    // If clientId not provided, try to fetch from DB using username
    if (!clientId && username) {
      const firestore = getDb();
      if (firestore) {
        try {
          const doc = await firestore.collection("sf_creds").doc(String(username).toLowerCase().trim()).get();
          if (doc.exists) {
            clientId = doc.data()?.clientId;
            console.log(`✅ Using stored Client ID for ${username}`);
          }
        } catch (e) {
          console.warn("Failed to fetch stored credentials", e);
        }
      }
    }

    const { authUid } = req.query; // Capture authUid from client

    // Fallback to environment variable
    clientId = clientId || process.env.SALESFORCE_CLIENT_ID;
    let finalInstanceUrl = instanceUrl;

    // If instanceUrl not provided, try to fetch from DB using username
    if (!finalInstanceUrl && username) {
      const firestore = getDb();
      if (firestore) {
        try {
          const doc = await firestore.collection("sf_creds").doc(String(username).toLowerCase().trim()).get();
          if (doc.exists) {
            finalInstanceUrl = doc.data()?.instanceUrl;
            if (finalInstanceUrl) console.log(`✅ Using stored Instance URL for ${username}`);
          }
        } catch (e) {
          console.warn("Failed to fetch stored instance URL", e);
        }
      }
    }

    if (!finalInstanceUrl) {
      return res.status(400).json({ error: "instanceUrl is required" });
    }

    if (!clientId) {
      return res.status(500).json({ error: "Salesforce Client ID is not configured. Please provide it or check server environment." });
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.get('host');
    const appUrl = process.env.APP_URL || `${protocol}://${host}`;
    const redirectUri = (req.query.redirectUri as string) || (req.body?.redirectUri as string) || `${appUrl.replace(/\/+$/, '')}/auth/callback`;

    // PKCE
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    // Pass custom clientId, instanceUrl, codeVerifier, and authUid in state so callback knows which credentials to use
    const state = Buffer.from(JSON.stringify({ 
      instanceUrl: finalInstanceUrl, 
      clientId: clientId !== process.env.SALESFORCE_CLIENT_ID ? clientId : undefined,
      username: username || undefined,
      codeVerifier,
      ownerUid: authUid || undefined, // Carry the user's UID through the OAuth flow
      redirectUri
    })).toString('base64');

    const params = new URLSearchParams({
      client_id: String(clientId),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'full refresh_token',
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    const authUrl = `${String(finalInstanceUrl).replace(/\/+$/, '')}/services/oauth2/authorize?${params.toString()}`;
    res.json({ url: authUrl });
  });

  // Global session storage for OAuth (simplified for demo)
  let oauthSession: any = null;

  app.get(["/auth/callback", "/auth/callback/", "/api/auth/salesforce/callback"], async (req, res) => {
    const { code, state } = req.query;
    
    if (!code) {
      return res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: 'No authorization code received' }, '*');
                window.close();
              }
            </script>
            <p>Authentication failed. No code received.</p>
          </body>
        </html>
      `);
    }

    try {
      // We need to know which instance URL was used. 
      // In a real app, we'd use 'state' to track this.
      // For now, we'll assume production if not specified, or we can try to derive it.
      // Better: The client should have passed it or we should have stored it in a session.
      // Since we don't have a session store yet, let's assume login.salesforce.com for now
      // or try to get it from the request if we can.
      
      // Actually, Salesforce returns the instance_url in the token response.
      // But we need to know WHERE to send the token request.
      // Let's use a default or try to get it from a cookie/session if we had one.
      // For this demo, let's assume the user is using production unless they specified otherwise.
      // A better way is to include the instanceUrl in the state.
      
      let instanceUrl = 'https://login.salesforce.com';
      let clientId = process.env.SALESFORCE_CLIENT_ID;
      let clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
      let username: string | undefined;
      let codeVerifier: string | undefined;
      let ownerUid: string | undefined;
      let redirectUriOverride: string | undefined;

      if (state && typeof state === 'string') {
        try {
          const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
          if (stateData.instanceUrl) instanceUrl = stateData.instanceUrl;
          if (stateData.username) username = stateData.username;
          if (stateData.codeVerifier) codeVerifier = stateData.codeVerifier;
          if (stateData.ownerUid) ownerUid = stateData.ownerUid;
          if (stateData.redirectUri) redirectUriOverride = stateData.redirectUri;
          
          // If custom clientId was passed in state, we need to fetch the secret from DB
          if (stateData.clientId) {
            clientId = stateData.clientId;
            const firestore = getDb();
            if (firestore && username) {
              const doc = await firestore.collection("sf_creds").doc(username.toLowerCase().trim()).get();
              if (doc.exists) {
                clientSecret = doc.data()?.clientSecret;
                console.log(`✅ Using stored Client Secret for ${username}`);
              }
            }
          }
        } catch (e) {
          console.error("Failed to parse state", e);
        }
      }

      if (!clientId || !clientSecret) {
        throw new Error("Salesforce Client Credentials missing. Ensure they are configured or provided.");
      }

      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const host = req.get('host');
      const appUrl = process.env.APP_URL || `${protocol}://${host}`;
      const redirectUri = redirectUriOverride || `${appUrl.replace(/\/+$/, '')}/auth/callback`;

      const tokenUrl = `${instanceUrl}/services/oauth2/token`;
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      });

      if (codeVerifier) {
        params.append('code_verifier', codeVerifier);
      }

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error_description || data.error || 'Token exchange failed');
      }

      // Include username in session data if available
      if (username) {
        data.username = username;
      }

      // Store session in memory for immediate use
      oauthSession = data;
      data.clientId = clientId;

      // Store session in Firestore for persistence
      const firestore = getDb();
      if (firestore) {
        try {
          // Extract orgId and userId from the 'id' URL
          // Format: https://login.salesforce.com/id/00D.../005...
          const idParts = data.id.split('/');
          const sfUserId = idParts[idParts.length - 1];
          const sfOrgId = idParts[idParts.length - 2];

          const sessionData = {
            orgId: sfOrgId,
            userId: sfUserId,
            instanceUrl: data.instance_url,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            updatedAt: new Date().toISOString(),
            ownerUid: ownerUid || 'system'
          };

          // Use orgId as the document ID for simplicity, or a combination
          await firestore.collection('sessions').doc(sfOrgId).set(sessionData, { merge: true });
          console.log(`✅ Session stored in Firestore for Org: ${sfOrgId}`);
        } catch (fsError) {
          console.error("Failed to store session in Firestore:", fsError);
        }
      }

      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'OAUTH_AUTH_SUCCESS',
                  data: ${JSON.stringify(data)}
                }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error("OAuth Callback Error:", error);
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: '${error.message}' }, '*');
                window.close();
              }
            </script>
            <p>Authentication failed: ${error.message}</p>
          </body>
        </html>
      `);
    }
  });

  app.get("/api/auth/salesforce/session", (req, res) => {
    if (!oauthSession) {
      return res.status(401).json({ error: "No active OAuth session" });
    }
    res.json(oauthSession);
  });

  // Fetch a stored session from Firestore
  app.get("/api/auth/salesforce/sessions/:orgId", async (req, res) => {
    const { orgId } = req.params;
    const firestore = getDb();
    
    if (!firestore) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    try {
      const doc = await firestore.collection('sessions').doc(orgId).get();
      if (!doc.exists) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json(doc.data());
    } catch (error) {
      handleFirestoreError(error, res, "Failed to fetch session");
    }
  });

  // Save Salesforce Client Credentials
  app.post("/api/auth/salesforce/creds", async (req, res) => {
    const { username, clientId, clientSecret, instanceUrl, ownerUid } = req.body;
    
    if (!username || !clientId || !clientSecret) {
      return res.status(400).json({ error: "username, clientId, and clientSecret are required" });
    }

    const firestore = getDb();
    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    try {
      await firestore.collection("sf_creds").doc(String(username).toLowerCase().trim()).set({
        clientId,
        clientSecret,
        instanceUrl,
        ownerUid: ownerUid || 'system',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      res.json({ success: true });
    } catch (error) {
      handleFirestoreError(error, res, "Failed to save credentials");
    }
  });

  // Check if credentials exist for a username
  app.get("/api/auth/check/:username", async (req, res) => {
    const { username } = req.params;
    const targetDocId = username.toLowerCase().trim();
    console.log(`🔍 Checking credentials for: "${targetDocId}"`);
    
    const firestore = getDb();
    
    if (!firestore) {
      console.error("❌ Database not configured during check");
      return res.json({ exists: false, message: "Database not configured" });
    }

    try {
      const start = Date.now();
      // Line 125: Attempting to fetch document from Firestore
      const doc = await firestore.collection("sf_creds").doc(targetDocId).get();
      const duration = Date.now() - start;
      console.log(`⏱️ Firestore check took ${duration}ms. Exists: ${doc.exists}`);
      res.json({ exists: doc.exists });
    } catch (error: any) {
      const currentTime = new Date().toISOString();
      console.error(`❌ [Line 130] Failed to check database at ${currentTime}:`);
      console.error(`   - Error Message: ${error.message}`);
      console.error(`   - Error Code: ${error.code}`);
      
      if (error.message.includes('UNAUTHENTICATED')) {
        console.log("\n🚨 CRITICAL AUTHENTICATION ERROR (Line 135):");
        console.log("1. CHECK SYSTEM TIME: Your laptop time is:", currentTime);
        console.log("   If your clock is off by even 2 minutes, Google will reject the connection.");
        console.log("2. CHECK PROJECT ID: Ensure 'metaassit-ai' matches your Firebase Console exactly.");
        console.log("3. CHECK PERMISSIONS: Does the service account have 'Cloud Datastore User' role?");
      } else if (error.message.includes('UNABLE_TO_GET_ISSUER_CERT_LOCALLY')) {
        console.log("\n🚨 SSL CERTIFICATE ERROR (Corporate Proxy Detected):");
        console.log("   Your network is intercepting SSL traffic (e.g., Zscaler, Netskope).");
        console.log("   FIX: Set NODE_TLS_REJECT_UNAUTHORIZED=0 in your .env file.");
      } else if (error.message.includes('ETIMEDOUT') && error.message.includes(':')) {
        console.log("\n🚨 IPv6 TIMEOUT ERROR:");
        console.log("   Your network is trying to route traffic over IPv6 but it is failing.");
        console.log("   FIX: Add this to your .env file: GRPC_DNS_RESOLVER=native");
      }
      
      res.status(500).json({ 
        error: "Failed to check database", 
        details: error.message,
        line: 130,
        systemTime: currentTime
      });
    }
  });

  // Salesforce Proxy Endpoint with DB persistence
  app.post("/api/sf/proxy", async (req, res) => {
    if (!req.body) {
      return res.status(400).json({ error: "Request body is missing or could not be parsed." });
    }
    const { url, method, headers, body, saveCreds, username, clientId, clientSecret, ownerUid } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    // If it's a login request and we need to fetch creds from DB
    let finalBody = body;
    let effectiveClientId = clientId;
    let effectiveClientSecret = clientSecret;

    if (url.includes("/oauth2/token") && !clientId && username) {
      console.log(`🔑 Attempting to fetch credentials for ${username} from Firestore`);
      const firestore = getDb();
      if (firestore) {
        const doc = await firestore.collection("sf_creds").doc(String(username).toLowerCase()).get();
        if (doc.exists) {
          const data = doc.data();
          effectiveClientId = data?.clientId;
          effectiveClientSecret = data?.clientSecret;
          console.log(`✅ Credentials found for ${username}`);
          
          // Reconstruct body with fetched creds
          const params = new URLSearchParams(body);
          params.set('client_id', effectiveClientId);
          params.set('client_secret', effectiveClientSecret);
          
          // If grant_type is password, concatenate password and security token
          const grantType = params.get('grant_type');
          const password = params.get('password');
          const securityToken = params.get('security_token');

          if (grantType === 'password' && password && securityToken) {
            params.set('password', password + securityToken);
            params.delete('security_token'); // Remove security token as it's now part of the password
          }
          
          finalBody = params.toString();
        } else {
          console.warn(`⚠️ No credentials found in Firestore for ${username}`);
        }
      } else {
        console.error("❌ Firestore not available for credential retrieval");
      }
    }

    try {
      console.log(`🚀 Proxying ${method || "GET"} to ${url}`);
      const sfResponse = await fetch(url, {
        method: method || "GET",
        headers: {
          ...headers,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "X-Salesforce-No-Session": "1",
          "Sforce-Call-Options": "client=Metaassist"
        },
        body: finalBody ? (typeof finalBody === 'string' ? finalBody : JSON.stringify(finalBody)) : undefined,
      });

      console.log(`📥 Salesforce Response: ${sfResponse.status} ${sfResponse.statusText}`);
      
      const contentType = sfResponse.headers.get("content-type");
      let data;
      if (contentType?.includes("application/json")) {
        data = await sfResponse.json();
      } else {
        data = await sfResponse.text();
      }

      if (!sfResponse.ok) {
        if (sfResponse.status >= 500) {
          console.error(`❌ Salesforce Server Error (${sfResponse.status}):`, typeof data === 'object' ? JSON.stringify(data) : data);
        } else {
          const dataStr = typeof data === 'object' ? JSON.stringify(data) : data;
          const lowErrorStr = dataStr.toLowerCase();
          const isCommonWarning = sfResponse.status === 400 || sfResponse.status === 404;
          const isUnsupportedObject = lowErrorStr.includes('not supported') || lowErrorStr.includes('invalid_type') || lowErrorStr.includes('not_found') || lowErrorStr.includes('does not exist');
          
          if (!isCommonWarning || !isUnsupportedObject) {
            console.log(`⚠️ Salesforce Warning (${sfResponse.status}):`, dataStr);
          }
        }
      }

      // If login was successful and we should save creds
      if (sfResponse.ok && saveCreds && username && effectiveClientId && effectiveClientSecret) {
        const firestore = getDb();
        if (firestore) {
          await firestore.collection("sf_creds").doc(String(username).toLowerCase()).set({
            clientId: effectiveClientId,
            clientSecret: effectiveClientSecret,
            ownerUid: ownerUid || 'system',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      }

      res.status(sfResponse.status).send(data);
    } catch (error: any) {
      console.error("Proxy Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Store Granular Security Analysis Result (Hierarchical)
  app.post("/api/security/analysis/granular-store", async (req, res) => {
    const { orgId, category, profileName, objects, ownerUid } = req.body;
    const firestore = getDb();

    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    if (!orgId || !category || !profileName || !Array.isArray(objects)) {
      return res.status(400).json({ error: "orgId, category, profileName, and objects array are required" });
    }

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
    const safeCategory = String(category).replace(/[^a-zA-Z0-9]/g, '_');
    const safeProfileName = String(profileName).replace(/[^a-zA-Z0-9]/g, '_');

    try {
      const batch = firestore.batch();
      let count = 0;
      const batches = [batch];

      const getActiveBatch = () => {
        const currentBatch = batches[batches.length - 1];
        if (count >= 450) {
          const newBatch = firestore.batch();
          batches.push(newBatch);
          count = 0;
          return newBatch;
        }
        return currentBatch;
      };

      for (const obj of objects) {
        const safeObjectName = String(obj.name).replace(/[^a-zA-Z0-9]/g, '_');
        const objRef = firestore
          .collection("orgs")
          .doc(safeOrgId)
          .collection("security_analysis")
          .doc("object_field_security")
          .collection("categories")
          .doc(safeCategory)
          .collection("profiles")
          .doc(safeProfileName)
          .collection("objects")
          .doc(safeObjectName);

        const b = getActiveBatch();
        b.set(objRef, {
          ...obj,
          ownerUid: ownerUid || 'system',
          timestamp: new Date().toISOString(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        count++;
      }

      await Promise.all(batches.map(b => b.commit()));
      res.json({ success: true, count: objects.length });
    } catch (error: any) {
      console.error("Granular Store Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Fetch Granular Security Analysis for a Profile
  app.get("/api/security/analysis/granular-fetch/:orgId/:category/:profileName", async (req, res) => {
    const { orgId, category, profileName } = req.params;
    const firestore = getDb();

    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
    const safeCategory = String(category).replace(/[^a-zA-Z0-9]/g, '_');
    const safeProfileName = String(profileName).replace(/[^a-zA-Z0-9]/g, '_');

    try {
      const snapshot = await firestore
        .collection("orgs")
        .doc(safeOrgId)
        .collection("security_analysis")
        .doc("object_field_security")
        .collection("categories")
        .doc(safeCategory)
        .collection("profiles")
        .doc(safeProfileName)
        .collection("objects")
        .get();

      const objects = snapshot.docs.map(doc => doc.data());
      res.json(objects);
    } catch (error: any) {
      console.error("Granular Fetch Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Store Security Analysis Tile Result
  app.post("/api/security/analysis/store", async (req, res) => {
    const { orgId, tileId, data, summary, timestamp, ownerUid } = req.body;
    const firestore = getDb();

    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    if (!orgId || !tileId || !data) {
      return res.status(400).json({ error: "orgId, tileId, and data are required" });
    }

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
    const safeTileId = String(tileId).replace(/[^a-zA-Z0-9-]/g, '_');

    try {
      const tileRef = firestore
        .collection("orgs")
        .doc(safeOrgId)
        .collection("security_analysis")
        .doc(safeTileId);

      await tileRef.set({
        id: safeTileId,
        orgId,
        data,
        summary: summary || null,
        timestamp: timestamp || new Date().toISOString(),
        ownerUid: ownerUid || 'system',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      res.json({ success: true, id: safeTileId });
    } catch (error: any) {
      console.error("Store Security Analysis Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Fetch Security Analysis for an Org
  app.get("/api/security/analysis/:orgId", async (req, res) => {
    const { orgId } = req.params;
    const firestore = getDb();

    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');

    try {
      const snapshot = await firestore
        .collection("orgs")
        .doc(safeOrgId)
        .collection("security_analysis")
        .get();

      const analysis: Record<string, any> = {};
      snapshot.docs.forEach(doc => {
        analysis[doc.id] = doc.data();
      });
      res.json(analysis);
    } catch (error: any) {
      console.error("Fetch Security Analysis Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Fetch SCA Rules
  app.get("/api/security/rules", async (req, res) => {
    const firestore = getDb();
    if (!firestore) return res.status(500).json({ error: "Database not configured" });

    try {
      const doc = await firestore.collection("sca_config").doc("pmd_rules").get();
      if (doc.exists) {
        return res.json(doc.data()?.rules || PMD_RULES);
      }
      res.json(PMD_RULES);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Target Org Auth (Client Credentials, Password Grant, or Refresh Token)
  app.post("/api/sf/target/auth", async (req, res) => {
    const { instanceUrl, username, password, refreshToken } = req.body;
    let { clientId, clientSecret } = req.body;
    
    clientId = clientId || process.env.SALESFORCE_CLIENT_ID;
    clientSecret = clientSecret || process.env.SALESFORCE_CLIENT_SECRET;

    if (!instanceUrl || !clientId || !clientSecret) {
      return res.status(400).json({ error: "instanceUrl, clientId, and clientSecret are required (or must be configured on server)" });
    }

    const tokenUrl = `${instanceUrl}/services/oauth2/token`;
    const params = new URLSearchParams();
    
    if (refreshToken) {
      params.append('grant_type', 'refresh_token');
      params.append('refresh_token', refreshToken);
    } else if (username && password) {
      params.append('grant_type', 'password');
      params.append('username', username);
      params.append('password', password);
    } else {
      params.append('grant_type', 'client_credentials');
    }
    
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      res.json(data);
    } catch (error: any) {
      console.error("Target Auth Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Store Metadata in Firestore
  app.post("/api/metadata/store", async (req, res) => {
    if (!req.body) {
      return res.status(400).json({ error: "Request body is missing or could not be parsed." });
    }
    const { 
      orgId, category, metadataId, content, explanation, name, label, 
      mermaidCode, lwcFiles, metaXml, objectPermissions, fieldPermissions, 
      assignedUsers, objectLimits, recordTypeUsage, automation, quickActions, 
      buttons, validationRules, layouts, flexiPages, compactLayouts,
      allAssignments, allFlexiPageAssignments, fields, ownerUid,
      UserType, UserLicense
    } = req.body;
    const firestore = getDb();

    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
    const safeName = String(name).replace(/[^a-zA-Z0-9]/g, '_');

    try {
      const batch = firestore.batch();
      let operationCount = 0;
      const batches = [batch];
      
      const getActiveBatch = () => {
        const currentBatch = batches[batches.length - 1];
        if (operationCount >= 450) { // Keep a buffer below 500
          const newBatch = firestore.batch();
          batches.push(newBatch);
          operationCount = 0;
          return newBatch;
        }
        return currentBatch;
      };

      const addToBatch = (ref: any, data: any, options?: any) => {
        const b = getActiveBatch();
        if (options) {
          b.set(ref, data, options);
        } else {
          b.set(ref, data);
        }
        operationCount++;
      };
      
      const itemRef = firestore
        .collection("orgs")
        .doc(safeOrgId)
        .collection("metadata")
        .doc(category)
        .collection("items")
        .doc(safeName);

      const CHUNK_SIZE = 800000; // 800KB chunk size
      const isSplit = content && content.length > CHUNK_SIZE;
      
      const baseData: any = {
        category,
        metadataId,
        name,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        isSplit,
        UserType,
        UserLicense,
        ownerUid: ownerUid || 'system'
      };

      if (label !== undefined) baseData.label = label;
      if (explanation !== undefined) {
        baseData.explanation = explanation;
        baseData.hasExplanation = !!explanation;
      }
      if (mermaidCode !== undefined) baseData.mermaidCode = mermaidCode;
      if (lwcFiles !== undefined) baseData.lwcFiles = lwcFiles;
      if (metaXml !== undefined) baseData.metaXml = metaXml;
      
      // For non-objects, we store everything in the main document
      // For objects, we store large arrays in sub-collections to avoid the 1MB limit
      if (category !== 'objects') {
        if (objectPermissions !== undefined) baseData.objectPermissions = objectPermissions;
        if (fieldPermissions !== undefined) baseData.FieldPermissions = fieldPermissions;
        if (assignedUsers !== undefined) baseData.AssignedUsers = assignedUsers;
        if (objectLimits !== undefined) baseData.objectLimits = objectLimits;
        if (recordTypeUsage !== undefined) baseData.recordTypeUsage = recordTypeUsage;
        if (automation !== undefined) baseData.automation = automation;
        if (quickActions !== undefined) baseData.quickActions = quickActions;
        if (buttons !== undefined) baseData.buttons = buttons;
        if (fields !== undefined) baseData.fields = fields;
        if (validationRules !== undefined) baseData.validationRules = validationRules;
        if (layouts !== undefined) baseData.layouts = layouts;
        if (flexiPages !== undefined) baseData.flexiPages = flexiPages;
        if (compactLayouts !== undefined) baseData.compactLayouts = compactLayouts;
        if (allAssignments !== undefined) baseData.allAssignments = allAssignments;
        if (allFlexiPageAssignments !== undefined) baseData.allFlexiPageAssignments = allFlexiPageAssignments;
      } else {
        // For objects, we mark that it has full metadata stored if explicitly requested
        if (req.body.hasFullMetadata) {
          baseData.hasFullMetadata = true;
        }
        
        // For objects, we store assignments in a sub-collection to avoid the 1MB limit
        // but we keep a small version or just the count in the base document if needed
        if (allAssignments !== undefined) {
          const asgRef = itemRef.collection("assignments").doc("layouts");
          addToBatch(asgRef, { allAssignments, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          // Keep a flag or small sample in base doc if needed
          baseData.hasLayoutAssignments = true;
        }
        if (allFlexiPageAssignments !== undefined) {
          const fpAsgRef = itemRef.collection("assignments").doc("flexiPages");
          addToBatch(fpAsgRef, { allFlexiPageAssignments, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          baseData.hasFlexiPageAssignments = true;
        }
      }

      if (category !== 'objects') {
        const item = req.body;
        const errorMessage = item.errormessage || item.ErrorMessage || item.errorMessage || item.Metadata?.errorMessage || (item.attributes && item.attributes.ErrorMessage);
        const formula = item.validationformula || item.ErrorConditionFormula || item.errorConditionFormula || item.Metadata?.errorConditionFormula || (item.attributes && item.attributes.ErrorConditionFormula);
        const description = item.Description || item.description || item.Metadata?.description || (item.attributes && item.attributes.Description);
        const errorDisplayField = item.ErrorDisplayField || item.errorDisplayField || item.Metadata?.errorDisplayField || (item.attributes && item.attributes.ErrorDisplayField);
        const active = item.Active !== undefined ? item.Active : (item.active !== undefined ? item.active : (item.Metadata?.active !== undefined ? item.Metadata.active : (item.attributes?.Active !== undefined ? item.attributes.Active : undefined)));

        if (errorMessage) baseData.errormessage = errorMessage;
        if (formula) baseData.validationformula = formula;
        if (errorDisplayField) baseData.ErrorDisplayField = errorDisplayField;
        if (description) baseData.Description = description;
        if (active !== undefined) baseData.active = active;
        if (item.EntityDefinitionId) baseData.EntityDefinitionId = item.EntityDefinitionId;
        if (item.objectName) baseData.objectName = item.objectName;
      }

      if (!isSplit) {
        baseData.content = content;
        addToBatch(itemRef, baseData, { merge: true });
        
        // Dual storage for Validation Rules, Buttons, and Quick Actions if they are stored individually
        if (['validationRules', 'buttons', 'quickActions'].includes(category) && (req.body.EntityDefinitionId || req.body.objectName)) {
          const objName = req.body.objectName || req.body.EntityDefinitionId;
          const safeObjName = String(objName).replace(/[^a-zA-Z0-9]/g, '_');
          const objSubItemRef = firestore
            .collection("orgs")
            .doc(safeOrgId)
            .collection("metadata")
            .doc("objects")
            .collection("items")
            .doc(safeObjName)
            .collection(category)
            .doc(safeName);
          addToBatch(objSubItemRef, baseData, { merge: true });
        }
      } else {
        // Handle large content by splitting into chunks
        const chunks = [];
        for (let i = 0; i < content.length; i += CHUNK_SIZE) {
          chunks.push(content.substring(i, i + CHUNK_SIZE));
        }
        
        baseData.chunkCount = chunks.length;
        addToBatch(itemRef, baseData, { merge: true });

        // Dual storage for Validation Rules, Buttons, and Quick Actions if they are stored individually
        if (['validationRules', 'buttons', 'quickActions'].includes(category) && (req.body.EntityDefinitionId || req.body.objectName)) {
          const objName = req.body.objectName || req.body.EntityDefinitionId;
          const safeObjName = String(objName).replace(/[^a-zA-Z0-9]/g, '_');
          const objSubItemRef = firestore
            .collection("orgs")
            .doc(safeOrgId)
            .collection("metadata")
            .doc("objects")
            .collection("items")
            .doc(safeObjName)
            .collection(category)
            .doc(safeName);
          addToBatch(objSubItemRef, baseData, { merge: true });
        }

        // Store chunks in a subcollection
        const chunksCollection = itemRef.collection("chunks");
        chunks.forEach((chunk, index) => {
          const chunkRef = chunksCollection.doc(String(index));
          addToBatch(chunkRef, { content: chunk, index });
        });
      }

      // Handle sub-items for objects
      if (category === 'objects' && req.body.storeSubItems !== false) {
        const subCollections = [
          'fields', 
          'validationRules', 
          'layouts', 
          'quickActions', 
          'buttons', 
          'flexiPages', 
          'compactLayouts', 
          'automation', 
          'recordTypeUsage',
          'objectPermissions',
          'objectLimits'
        ];
        
        // Map recordTypeUsage to recordTypes if it exists and recordTypes doesn't
        if (req.body.recordTypeUsage && !req.body.recordTypes) {
          req.body.recordTypes = req.body.recordTypeUsage;
        }

        subCollections.forEach(sub => {
          if (req.body[sub]) {
            // 1. Store in object sub-collection
            const collectionRef = itemRef.collection(sub);
            
            // 2. Store in top-level metadata collection
            const isTopLevel = !['objectPermissions', 'objectLimits'].includes(sub);
            const topLevelCollectionRef = isTopLevel ? firestore
                .collection("orgs")
                .doc(safeOrgId)
                .collection("metadata")
                .doc(sub) // Use the sub-collection name as the top-level category
                .collection("items") : null;

            req.body[sub].forEach((item: any) => {
              // Try to find a good ID for the sub-item
              let docId = (item.name || item.id || item.Id || item.DeveloperName || item.Label || item.RecordTypeId || item.ParentId || item.fullName || item.Type || item.ValidationName || (item.Parent && item.Parent.Name) || '').replace(/[^a-zA-Z0-9]/g, '_');
              if (!docId) {
                // Fallback to a hash or index if no name found
                docId = `item_${Math.random().toString(36).substring(2, 9)}`;
              }
              
              // Store in object sub-collection
              const subItemRef = collectionRef.doc(docId);
              const subItemData: any = {
                ...item,
                objectName: name,
                ownerUid: ownerUid || 'system',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              };

              // Explicitly extract fields if present at top level or in Metadata/attributes
              const errorMessage = item.errormessage || item.ErrorMessage || item.errorMessage || item.Metadata?.errorMessage || (item.attributes && item.attributes.ErrorMessage);
              const formula = item.validationformula || item.ErrorConditionFormula || item.errorConditionFormula || item.Metadata?.errorConditionFormula || (item.attributes && item.attributes.ErrorConditionFormula);
              const description = item.Description || item.description || item.Metadata?.description || (item.attributes && item.attributes.Description);
              const errorDisplayField = item.ErrorDisplayField || item.errorDisplayField || item.Metadata?.errorDisplayField || (item.attributes && item.attributes.ErrorDisplayField);
              const active = item.Active !== undefined ? item.Active : (item.active !== undefined ? item.active : (item.Metadata?.active !== undefined ? item.Metadata.active : (item.attributes?.Active !== undefined ? item.attributes.Active : undefined)));

              if (errorMessage) subItemData.errormessage = errorMessage;
              if (formula) subItemData.validationformula = formula;
              if (errorDisplayField) subItemData.ErrorDisplayField = errorDisplayField;
              if (description) subItemData.Description = description;
              if (active !== undefined) subItemData.active = active;
              
              if (sub === 'validationRules') {
                console.log(`Storing Validation Rule ${docId} for ${name}:`, {
                  hasErrorMessage: !!subItemData.errormessage,
                  hasFormula: !!subItemData.validationformula,
                  active: subItemData.active
                });
              }

              // Handle explanation and mermaidCode
              if (item.explanation) subItemData.explanation = item.explanation;
              if (item.mermaidCode) subItemData.mermaidCode = item.mermaidCode;
              
              addToBatch(subItemRef, subItemData, { merge: true });
            });
          }
        });
      }

      const orgRef = firestore.collection("orgs").doc(safeOrgId);
      const orgUpdate: any = {
        lastSyncAt: admin.firestore.FieldValue.serverTimestamp()
      };
      if (ownerUid) {
        orgUpdate.ownerUid = ownerUid;
      }
      addToBatch(orgRef, orgUpdate, { merge: true });

      // Commit all batches
      await Promise.all(batches.map(b => b.commit()));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Store Metadata Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update Org Credentials in Firestore
  app.post("/api/org/update/:orgId", async (req, res) => {
    const { orgId } = req.params;
    const { accessToken, instanceUrl, ownerUid } = req.body;
    const firestore = getDb();

    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    if (!accessToken || !instanceUrl) {
      return res.status(400).json({ error: "accessToken and instanceUrl are required" });
    }

    try {
      const orgRef = firestore.collection("orgs").doc(orgId);
      await orgRef.update({
        accessToken,
        instanceUrl,
        ownerUid: ownerUid || 'system',
        lastRefreshed: new Date().toISOString()
      });
      res.json({ status: "ok", message: "Org credentials updated successfully" });
    } catch (error: any) {
      console.error("Update Org Credentials Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // New endpoint to get object summary for diagram tab
  app.get("/api/object-summary/:orgId/:objectName", async (req, res) => {
    const { orgId, objectName } = req.params;
    const firestore = getDb();

    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    try {
      const orgRef = firestore.collection("orgs").doc(orgId);
      const orgDoc = await orgRef.get();

      if (!orgDoc.exists) {
        return res.status(404).json({ error: "Org not found in database" });
      }

      const { accessToken, instanceUrl, proxyProvider, useProxy } = orgDoc.data() as any;

      if (!accessToken || !instanceUrl) {
        return res.status(400).json({ error: "Salesforce credentials missing for org" });
      }

      const sfService = new SalesforceService(accessToken, instanceUrl, useProxy, proxyProvider);

      // Fetch counts
      const recordTypes = await sfService.fetchCategory('recordTypes');
      const flexiPages = await sfService.fetchCategory('flexiPages');
      const quickActions = await sfService.fetchCategory('quickActions');

      const recordTypeCount = recordTypes.filter((rt: any) => rt.sobjectType === objectName).length;
      const flexiPageCount = flexiPages.filter((fp: any) => fp.flexiPageType === objectName || fp.entityDefinition === objectName).length;
      const quickActionCount = quickActions.filter((qa: any) => qa.targetSobjectType === objectName).length;

      res.json({
        recordTypeCount,
        flexiPageCount,
        quickActionCount,
      });

    } catch (error: any) {
      console.error("Error fetching object summary:", error);
      res.status(500).json({ error: error.message });
    }
  });



  // Register or update an Org in Firestore
  app.post("/api/org/register", async (req, res) => {
    const { orgId, ownerUid, name, instanceUrl } = req.body;
    const firestore = getDb();

    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    if (!orgId || !ownerUid) {
      return res.status(400).json({ error: "orgId and ownerUid are required" });
    }

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');

    try {
      const orgRef = firestore.collection("orgs").doc(safeOrgId);
      await orgRef.set({
        orgId,
        ownerUid,
        name: name || '',
        instanceUrl: instanceUrl || '',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Register Org Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Check if org has metadata and get last sync date
  app.get("/api/org/check/:orgId", async (req, res) => {
    const { orgId } = req.params;
    const firestore = getDb();

    if (!firestore) {
      return res.json({ exists: false, message: "Database not configured" });
    }

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');

    try {
      const doc = await firestore.collection("orgs").doc(safeOrgId).get();
      if (doc.exists && doc.data()?.lastSyncAt) {
        res.json({ exists: true, lastSyncAt: doc.data()?.lastSyncAt });
      } else {
        res.json({ exists: false });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to check org" });
    }
  });

  // Fetch all metadata for an org
  app.get("/api/metadata/:orgId/all", async (req, res) => {
    const { orgId } = req.params;
    const firestore = getDb();

    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');

    try {
      const categories = [
        'objects', 'classes', 'triggers', 'vfPages', 'lwcs', 
        'flows', 'processBuilders', 'layouts', 'validationRules',
        'permissionSets', 'profiles', 'tabs', 'recordTypes', 'emailTemplates',
        'staticResources', 'labels', 'workflowRules', 'customMetadata', 'flexiPages', 'dashboards',
        'quickActions', 'buttons'
      ];

      const results: any = {};
      
      // Fetch all items for each category
      for (const cat of categories) {
        const snapshot = await firestore
          .collection("orgs")
          .doc(safeOrgId)
          .collection("metadata")
          .doc(cat)
          .collection("items")
          .get();
        
        results[cat] = snapshot.docs.map(doc => ({
          ...doc.data(),
          id: doc.id
        }));
      }

      res.json(results);
    } catch (error: any) {
      console.error("Fetch All Metadata Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generic endpoint for fetching object sub-item metadata (fields, layouts, validationRules, etc.)
  app.get("/api/metadata/:orgId/objects/:objectName/:category/:itemName", async (req, res) => {
    console.log(`DEBUG: Incoming request to /api/metadata/:orgId/objects/:objectName/:category/:itemName: ${req.url}`);
    const { orgId, objectName, category, itemName } = req.params;
    const firestore = getDb();

    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
    const safeObjectName = String(objectName).replace(/[^a-zA-Z0-9]/g, '_');
    const safeItemName = String(itemName).replace(/[^a-zA-Z0-9]/g, '_');

    // Map category to collection name if needed (currently 1:1)
    const collectionName = category;

    try {
      const doc = await firestore
        .collection("orgs")
        .doc(safeOrgId)
        .collection("metadata")
        .doc("objects")
        .collection("items")
        .doc(safeObjectName)
        .collection(collectionName)
        .doc(safeItemName)
        .get();

      if (doc.exists) {
        const data = doc.data();
        if (category === 'validationRules' && !data.similarities) {
          res.json({ similarities: [] });
        } else {
          res.json(data);
        }
      } else {
        res.status(404).json({ error: `${category} item not found` });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Specific endpoint for fetching field data
  app.get("/api/metadata/:orgId/objects/:objectName/fields/:fieldName", async (req, res) => {
    console.log(`DEBUG: Incoming request to /api/metadata/:orgId/objects/:objectName/fields/:fieldName: ${req.url}`);
    const { orgId, objectName, fieldName } = req.params;
    const firestore = getDb();

    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
    const safeObjectName = String(objectName).replace(/[^a-zA-Z0-9]/g, '_');
    const safeFieldName = String(fieldName).replace(/[^a-zA-Z0-9]/g, '_');

    try {
      const doc = await firestore
        .collection("orgs")
        .doc(safeOrgId)
        .collection("metadata")
        .doc("objects")
        .collection("items")
        .doc(safeObjectName)
        .collection("fields")
        .doc(safeFieldName)
        .get();

      if (doc.exists) {
        res.json(doc.data());
      } else {
        // Return empty object instead of 404 if field not found in DB
        res.json({});
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generic endpoint for storing object sub-item data
  app.post("/api/metadata/:orgId/objects/:objectName/:category/:itemName/data", async (req, res) => {
    const { orgId, objectName, category, itemName } = req.params;
    const data = req.body;
    const firestore = getDb();

    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
    const safeObjectName = String(objectName).replace(/[^a-zA-Z0-9]/g, '_');
    const safeItemName = String(itemName).replace(/[^a-zA-Z0-9]/g, '_');
    
    const collectionName = category;

    try {
      await firestore
        .collection("orgs")
        .doc(safeOrgId)
        .collection("metadata")
        .doc("objects")
        .collection("items")
        .doc(safeObjectName)
        .collection(collectionName)
        .doc(safeItemName)
        .set({
          ...data,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Fetch stored metadata
  app.get("/api/metadata/:orgId/:category/:name", async (req, res) => {
    const { orgId, category, name } = req.params;
    const firestore = getDb();

    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    // Sanitize IDs for Firestore (must match storage logic)
    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
    const safeName = String(name).replace(/[^a-zA-Z0-9]/g, '_');

    try {
      const doc = await firestore
        .collection("orgs")
        .doc(safeOrgId)
        .collection("metadata")
        .doc(category)
        .collection("items")
        .doc(safeName)
        .get();

      if (!doc.exists) {
        return res.status(404).json({ error: "Metadata not found" });
      }

      let itemData = doc.data() as any;

      // Reassemble chunks if split
      if (itemData.isSplit) {
        const chunksSnapshot = await doc.ref.collection("chunks").orderBy("index").get();
        const fullContent = chunksSnapshot.docs.map(d => d.data().content).join("");
        itemData.content = fullContent;
      }

      // If category is objects, fetch sub-collections
      if (category === 'objects') {
        const subCollections = [
          'fields', 
          'validationRules', 
          'layouts', 
          'quickActions', 
          'buttons', 
          'flexiPages', 
          'compactLayouts', 
          'automation', 
          'recordTypeUsage',
          'objectPermissions',
          'objectLimits',
          'assignments'
        ];
        for (const sub of subCollections) {
          try {
            const subSnapshot = await doc.ref.collection(sub).get();
            if (!subSnapshot.empty) {
              const items = subSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as any));
              
              if (sub === 'assignments') {
                // Flatten assignments back into the main object
                items.forEach((asgDoc: any) => {
                  if (asgDoc.allAssignments) itemData.allAssignments = asgDoc.allAssignments;
                  if (asgDoc.allFlexiPageAssignments) itemData.allFlexiPageAssignments = asgDoc.allFlexiPageAssignments;
                });
              } else {
                itemData[sub] = items;
              }
            }
          } catch (subError) {
            console.warn(`Failed to fetch sub-collection ${sub} for ${name}:`, subError);
          }
        }
      }

      // If explanation is missing or explicitly marked as not having one, generate it
      if (!itemData?.hasExplanation || !itemData?.explanation) {
        console.log(`Generating explanation for ${category}/${name}...`);
        try {
          const { explanation: generatedExplanation, mermaidCode: generatedMermaidCode } = await explainMetadata(category as MetadataCategory, name, itemData.content);
          itemData.explanation = generatedExplanation;
          itemData.mermaidCode = generatedMermaidCode;
          itemData.hasExplanation = true;
          itemData.explanationUpdatedAt = admin.firestore.FieldValue.serverTimestamp();

          // Update the document in Firestore with the new explanation
          await firestore
            .collection("orgs")
            .doc(safeOrgId)
            .collection("metadata")
            .doc(category)
            .collection("items")
            .doc(safeName)
            .set(itemData, { merge: true }); // Use set with merge to update or create

          console.log(`Explanation generated and saved for ${category}/${name}.`);
        } catch (explanationError: any) {
          console.error(`Failed to generate explanation for ${category}/${name}:`, explanationError);
          // Continue without explanation if generation fails
          itemData.explanation = "AI documentation generation failed for this component. You can try 'Retrieve Component' to regenerate.";
          itemData.hasExplanation = false; // Mark as failed
        }
      }

      res.json(itemData);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Store org-specific feature scan results
  app.post("/api/orgs/:orgId/release-notes/:releaseId/features/:featureTitle/scan", async (req, res) => {
    const { orgId, releaseId, featureTitle } = req.params;
    const { scanResults, orgImpact } = req.body;
    const firestore = getDb();
    if (!firestore) return res.status(500).json({ error: "Database not configured" });

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
    try {
      await firestore
        .collection("orgs")
        .doc(safeOrgId)
        .collection("releaseScans")
        .doc(releaseId)
        .collection("features")
        .doc(encodeURIComponent(featureTitle))
        .set({
          scanResults,
          orgImpact,
          scannedAt: new Date().toISOString()
        });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get org-specific feature scan results
  app.get("/api/orgs/:orgId/release-notes/:releaseId/features/:featureTitle/scan", async (req, res) => {
    const { orgId, releaseId, featureTitle } = req.params;
    const firestore = getDb();
    if (!firestore) return res.status(500).json({ error: "Database not configured" });

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
    try {
      const doc = await firestore
        .collection("orgs")
        .doc(safeOrgId)
        .collection("releaseScans")
        .doc(releaseId)
        .collection("features")
        .doc(encodeURIComponent(featureTitle))
        .get();
      
      if (doc.exists) {
        res.json(doc.data());
      } else {
        res.status(404).json({ error: "Not found" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Search for a specific component by name across all categories
  app.get("/api/orgs/:orgId/search-component", async (req, res) => {
    const { orgId } = req.params;
    const { name } = req.query;
    const firestore = getDb();
    
    if (!firestore) return res.status(500).json({ error: "Database not configured" });
    if (!name || typeof name !== 'string') return res.status(400).json({ error: "Component name is required" });

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
    const searchName = name.toLowerCase();
    
    try {
      // We'll search through the common categories
      const categories = ['classes', 'triggers', 'vfPages', 'lwcs', 'flows', 'objects', 'validationRules'];
      let foundComponent = null;

      for (const category of categories) {
        const snapshot = await firestore
          .collection("orgs")
          .doc(safeOrgId)
          .collection("metadata")
          .doc(category)
          .collection("items")
          .get();

        const doc = snapshot.docs.find(d => {
          const data = d.data();
          const itemName = (data.name || data.DeveloperName || data.Label || '').toLowerCase();
          return itemName === searchName || itemName.includes(searchName);
        });

        if (doc) {
          foundComponent = { ...doc.data(), category };
          break; // Stop searching once found
        }
      }

      if (foundComponent) {
        res.json(foundComponent);
      } else {
        res.status(404).json({ error: "Component not found in database" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get chat history
  app.get("/api/orgs/:orgId/chat-history", async (req, res) => {
    const { orgId } = req.params;
    const firestore = getDb();
    if (!firestore) return res.status(500).json({ error: "Database not configured" });

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
    try {
      const doc = await firestore
        .collection("orgs")
        .doc(safeOrgId)
        .collection("deepResearch")
        .doc("chatHistory")
        .get();
      
      if (doc.exists) {
        res.json(doc.data());
      } else {
        res.json({ messages: [] });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Save chat history
  app.post("/api/orgs/:orgId/chat-history", async (req, res) => {
    const { orgId } = req.params;
    const { messages, ownerUid, groundRules } = req.body;
    const firestore = getDb();
    if (!firestore) return res.status(500).json({ error: "Database not configured" });

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
    try {
      await firestore
        .collection("orgs")
        .doc(safeOrgId)
        .collection("deepResearch")
        .doc("chatHistory")
        .set({
          messages,
          ownerUid: ownerUid || 'system',
          groundRules: groundRules || null,
          updatedAt: new Date().toISOString()
        }, { merge: true }); // Use merge to avoid overwriting groundRules if only messages are sent, or vice versa
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete chat history
  app.delete("/api/orgs/:orgId/chat-history", async (req, res) => {
    const { orgId } = req.params;
    const firestore = getDb();
    if (!firestore) return res.status(500).json({ error: "Database not configured" });

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
    try {
      await firestore
        .collection("orgs")
        .doc(safeOrgId)
        .collection("deepResearch")
        .doc("chatHistory")
        .delete();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Fetch all stored metadata for a category
  app.get("/api/metadata/:orgId/:category", async (req, res) => {
    const { orgId, category } = req.params;
    const firestore = getDb();

    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');

    try {
      const snapshot = await firestore
        .collection("orgs")
        .doc(safeOrgId)
        .collection("metadata")
        .doc(category)
        .collection("items")
        .get();

      const items = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.data().metadataId // Ensure we return the original metadataId
      }));

      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update assignments for an object
  app.post("/api/metadata/update-assignments", async (req, res) => {
    const { orgId, name, assignments, type, ownerUid } = req.body;
    const firestore = getDb();

    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    if (!orgId || !name || !assignments || !type) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, "_");
    const safeName = String(name).replace(/[^a-zA-Z0-9]/g, "_");

    try {
      const itemRef = firestore
        .collection("orgs")
        .doc(safeOrgId)
        .collection("metadata")
        .doc("objects")
        .collection("items")
        .doc(safeName);

      const batch = firestore.batch();
      
      if (type === 'layouts') {
        const asgRef = itemRef.collection("assignments").doc("layouts");
        batch.set(asgRef, { 
          allAssignments: assignments, 
          ownerUid: ownerUid || 'system',
          updatedAt: admin.firestore.FieldValue.serverTimestamp() 
        }, { merge: true });
        batch.set(itemRef, { hasLayoutAssignments: true, ownerUid: ownerUid || 'system', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      } else if (type === 'flexiPages') {
        const fpAsgRef = itemRef.collection("assignments").doc("flexiPages");
        batch.set(fpAsgRef, { 
          allFlexiPageAssignments: assignments, 
          ownerUid: ownerUid || 'system',
          updatedAt: admin.firestore.FieldValue.serverTimestamp() 
        }, { merge: true });
        batch.set(itemRef, { hasFlexiPageAssignments: true, ownerUid: ownerUid || 'system', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }

      await batch.commit();
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating assignments:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update explanation for metadata
  app.post("/api/metadata/update-explanation", async (req, res) => {
    const { orgId, category, name, explanation } = req.body;
    const firestore = getDb();

    if (!firestore) {
      return res.status(500).json({ error: "Database not configured" });
    }

    const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
    const safeName = String(name).replace(/[^a-zA-Z0-9]/g, '_');

    try {
      const itemRef = firestore
        .collection("orgs")
        .doc(safeOrgId)
        .collection("metadata")
        .doc(category)
        .collection("items")
        .doc(safeName);

      await itemRef.set({
        explanation: explanation.explanation || explanation,
        mermaidCode: explanation.mermaidCode || null,
        hasExplanation: true,
        explanationUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      res.json({ success: true });
    } catch (error: any) {
      handleFirestoreError(error, res, "Update Explanation Error");
    }
  });

  // Save org analysis
  app.post("/api/metadata/:orgId/analysis", async (req, res) => {
    try {
      const { orgId } = req.params;
      const analysisData = req.body;
      const firestore = getDb();
      if (!firestore) {
        return res.status(500).json({ error: "Firebase not configured" });
      }
      const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
      
      // If analysis is too large, we might need to strip fieldUsages or store it separately
      // Firestore limit is 1MB. Let's check size roughly.
      const size = JSON.stringify(analysisData).length;
      if (size > 900000) { // Close to 1MB limit
        console.warn(`Org analysis for ${orgId} is large (${size} bytes). Stripping fieldUsages to prevent failure.`);
        delete analysisData.fieldUsages;
      }

      await firestore.collection("orgAnalysis").doc(safeOrgId).set({
        ...analysisData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      res.json({ success: true });
    } catch (error: any) {
      handleFirestoreError(error, res, "Error saving org analysis");
    }
  });

  // Get org analysis
  app.get("/api/metadata/:orgId/analysis", async (req, res) => {
    try {
      const { orgId } = req.params;
      const firestore = getDb();
      if (!firestore) {
        return res.status(500).json({ error: "Firebase not configured" });
      }
      const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
      const doc = await firestore.collection("orgAnalysis").doc(safeOrgId).get();
      if (doc.exists) {
        res.json(doc.data());
      } else {
        res.json(null);
      }
    } catch (error: any) {
      console.error("Error fetching org analysis:", error);
      res.status(500).json({ error: "Failed to fetch org analysis" });
    }
  });

  // Clear org analysis
  app.delete("/api/metadata/:orgId/analysis", async (req, res) => {
    try {
      const { orgId } = req.params;
      const firestore = getDb();
      if (!firestore) {
        return res.status(500).json({ error: "Firebase not configured" });
      }
      const safeOrgId = String(orgId).replace(/[^a-zA-Z0-9]/g, '_');
      await firestore.collection("orgAnalysis").doc(safeOrgId).delete();
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error clearing org analysis:", error);
      res.status(500).json({ error: "Failed to clear org analysis" });
    }
  });

  // Revoke Salesforce Token
  app.post("/api/sf/revoke", async (req, res) => {
    const { token, instanceUrl } = req.body;
    if (!token || !instanceUrl) {
      return res.status(400).json({ error: "Token and Instance URL are required" });
    }

    try {
      const revokeUrl = `${instanceUrl}/services/oauth2/revoke?token=${token}`;
      const response = await fetch(revokeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      res.status(response.status).json({ success: response.ok });
    } catch (error: any) {
      console.error("Revoke Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Enhanced Release Notes
  // Fetch all available release notes
  app.get("/api/release-notes", async (req, res) => {
    try {
      const firestore = getDb();
      if (!firestore) {
        return res.status(500).json({ error: "Firebase not configured" });
      }

      const snapshot = await firestore.collection("releasenotes").get();
      const releases = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      res.json(releases);
    } catch (error: any) {
      console.error("Error fetching release notes list:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Fetch Enhanced Release Notes for a specific release
  app.get("/api/enhanced-release-notes/:releaseId", async (req, res) => {
    try {
      const { releaseId } = req.params;
      const firestore = getDb();
      if (!firestore) {
        return res.status(500).json({ error: "Firebase not configured" });
      }
      
      const docRef = firestore.collection("releasenotes").doc(releaseId);
      const doc = await docRef.get();
      
      if (doc.exists) {
        const data = doc.data();
        if (data && data.jsonformat) {
          try {
            const parsed = JSON.parse(data.jsonformat);
            return res.json(parsed);
          } catch (e) {
            console.error("Failed to parse jsonformat string", e);
            return res.json({ raw: data.jsonformat });
          }
        }
        return res.json(data);
      }
      
      res.status(404).json({ error: `Release notes not found at releasenotes/${releaseId}` });
    } catch (error: any) {
      console.error("Error fetching enhanced release notes:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update Enhanced Release Notes for a specific release
  app.post("/api/enhanced-release-notes/:releaseId", async (req, res) => {
    try {
      const { releaseId } = req.params;
      const { data, categories } = req.body;
      
      const firestore = getDb();
      if (!firestore) {
        return res.status(500).json({ error: "Firebase not configured" });
      }

      const docRef = firestore.collection("releasenotes").doc(releaseId);
      
      if (data) {
        await docRef.set({
          jsonformat: JSON.stringify(data),
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }

      if (categories) {
        const batch = firestore.batch();
        for (const cat of categories) {
          const catRef = docRef.collection("categories").doc(cat.id);
          batch.set(catRef, {
            title: cat.title,
            modules: JSON.stringify(cat.modules),
            updatedAt: new Date().toISOString()
          });
        }
        await batch.commit();
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating enhanced release notes:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Enrich Release Notes with Links
  app.post("/api/enhanced-release-notes/:releaseId/enrich", async (req, res) => {
    try {
      const { releaseId } = req.params;
      const firestore = getDb();
      if (!firestore) {
        return res.status(500).json({ error: "Firebase not configured" });
      }

      // Start enrichment in background
      (async () => {
        try {
          const docRef = firestore.collection("releasenotes").doc(releaseId);
          const doc = await docRef.get();
          if (!doc.exists) return;

          const data = doc.data();
          if (!data || !data.jsonformat) return;

          const parsed = JSON.parse(data.jsonformat);
          const modules = parsed.modules || [];
          
          // Flatten features (keeping references)
          const allFeatures: any[] = [];
          modules.forEach((m: any) => {
            if (m.newFeatures) {
              m.newFeatures.forEach((f: any) => {
                allFeatures.push(f); // Push reference, not copy
              });
            }
          });

          // Enrich in chunks of 10 to avoid token limits
          const chunkSize = 10;
          for (let i = 0; i < allFeatures.length; i += chunkSize) {
            const chunk = allFeatures.slice(i, i + chunkSize);
            const enriched = await enrichReleaseNotesLinks(chunk, releaseId);
            
            // Update local data
            enriched.forEach((item: any) => {
              const feature = allFeatures.find(f => f.title === item.title);
              if (feature) {
                feature.Links = item.Links;
              }
            });
          }

          // Save back to Firestore
          await docRef.update({
            jsonformat: JSON.stringify(parsed),
            updatedAt: new Date().toISOString()
          });

        } catch (err) {
          console.error("Background enrichment failed:", err);
        }
      })();

      res.json({ success: true, message: "Enrichment started in background" });
    } catch (error: any) {
      console.error("Error starting enrichment:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete categorized release notes for a specific release
  app.delete("/api/enhanced-release-notes/:releaseId/categories", async (req, res) => {
    try {
      const { releaseId } = req.params;
      const firestore = getDb();
      if (!firestore) {
        return res.status(500).json({ error: "Firebase not configured" });
      }

      const categoriesSnapshot = await firestore
        .collection("releasenotes")
        .doc(releaseId)
        .collection("categories")
        .get();

      const batch = firestore.batch();
      categoriesSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting categories:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Fetch categorized release notes for a specific release
  app.get("/api/enhanced-release-notes/:releaseId/categories", async (req, res) => {
    try {
      const { releaseId } = req.params;
      const firestore = getDb();
      if (!firestore) {
        return res.status(500).json({ error: "Firebase not configured" });
      }

      const categoriesSnapshot = await firestore
        .collection("releasenotes")
        .doc(releaseId)
        .collection("categories")
        .get();

      if (categoriesSnapshot.empty) {
        return res.json([]);
      }

      const categories = categoriesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        modules: JSON.parse(doc.data().modules || '{}')
      }));

      res.json(categories);
    } catch (error: any) {
      console.error("Error fetching categorized release notes:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Fetch Overview Data for a specific release
  app.get("/api/enhanced-release-notes/:releaseId/overview", async (req, res) => {
    try {
      const { releaseId } = req.params;
      const firestore = getDb();
      if (!firestore) return res.status(500).json({ error: "Firebase not configured" });

      const docRef = firestore.collection("releasenotes").doc(releaseId).collection("metadata").doc("overview");
      const doc = await docRef.get();

      if (doc.exists) {
        return res.json(doc.data());
      }
      res.status(404).json({ error: "Overview not found" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Store Overview Data for a specific release
  app.post("/api/enhanced-release-notes/:releaseId/overview", async (req, res) => {
    try {
      const { releaseId } = req.params;
      const overviewData = req.body;
      const firestore = getDb();
      if (!firestore) return res.status(500).json({ error: "Firebase not configured" });

      const docRef = firestore.collection("releasenotes").doc(releaseId).collection("metadata").doc("overview");
      await docRef.set({
        ...overviewData,
        updatedAt: new Date().toISOString()
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Fetch Deep Dive for a specific feature
  app.get("/api/enhanced-release-notes/:releaseId/features/:featureTitle", async (req, res) => {
    try {
      const { releaseId, featureTitle } = req.params;
      const firestore = getDb();
      if (!firestore) return res.status(500).json({ error: "Firebase not configured" });

      const docRef = firestore.collection("releasenotes").doc(releaseId).collection("deepdives").doc(encodeURIComponent(featureTitle));
      const doc = await docRef.get();

      if (doc.exists) {
        return res.json(doc.data());
      }
      res.status(404).json({ error: "Deep dive not found" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Store Deep Dive for a specific feature
  app.post("/api/enhanced-release-notes/:releaseId/features/:featureTitle", async (req, res) => {
    try {
      const { releaseId, featureTitle } = req.params;
      const deepDiveData = req.body;
      const firestore = getDb();
      if (!firestore) return res.status(500).json({ error: "Firebase not configured" });

      const docRef = firestore.collection("releasenotes").doc(releaseId).collection("deepdives").doc(encodeURIComponent(featureTitle));
      await docRef.set({
        ...deepDiveData,
        updatedAt: new Date().toISOString()
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Jira API Proxy Routes
  const getJiraHeaders = () => {
    const email = process.env.JIRA_EMAIL || process.env.JIRA__EMAIL;
    const token = process.env.JIRA_API_TOKEN || process.env.JIRA_API_KEY;
    if (!email || !token) {
      throw new Error("Jira credentials (JIRA_EMAIL or JIRA_API_TOKEN) not configured in environment.");
    }
    const authToken = Buffer.from(`${email}:${token}`).toString('base64');
    return {
      'Authorization': `Basic ${authToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
  };

  const getJiraDomain = () => {
    let domain = process.env.JIRA_DOMAIN;
    if (!domain) {
      throw new Error("JIRA_DOMAIN not configured in environment.");
    }
    domain = domain.trim();
    if (!domain.startsWith('http')) {
      domain = `https://${domain}`;
    }
    try {
      const url = new URL(domain);
      return url.origin;
    } catch(e) {
      return domain.replace(/\/$/, '');
    }
  };

  app.get("/api/jira/stories", async (req, res) => {
    try {
      const type = req.query.type || 'Story';
      const searchTerm = req.query.search || '';
      const domain = getJiraDomain();
      
      let jql = `project IS NOT EMPTY AND issuetype = "${type}"`;
      if (searchTerm) {
        // Simple search in text or text matches issue key
        jql += ` AND (text ~ "${searchTerm}*" OR issuekey = "${searchTerm}")`;
      }
      jql += ` ORDER BY updated DESC`;

      const bodyPayload = {
        jql,
        maxResults: 50,
        fields: ['summary', 'status', 'issuetype', 'updated', 'description', 'attachment']
      };

      const urlToFetch = `${domain}/rest/api/3/search/jql`;
      console.log(`[JIRA DEBUG] fetching stories from URL: ${urlToFetch}`);
      const response = await fetch(urlToFetch, {
        method: 'POST',
        headers: getJiraHeaders(),
        body: JSON.stringify(bodyPayload)
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: `Jira API Error: ${err}` });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/jira/stories/:issueKey", async (req, res) => {
    try {
      const { issueKey } = req.params;
      const { fields } = req.body;
      const domain = getJiraDomain();
      
      const response = await fetch(`${domain}/rest/api/2/issue/${issueKey}`, {
        method: 'PUT',
        headers: getJiraHeaders(),
        body: JSON.stringify({ fields })
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: `Jira API Error: ${err}` });
      }

      // 204 No Content is successful for PUT
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/jira/stories/:issueKey/comment", async (req, res) => {
    try {
      const { issueKey } = req.params;
      const { body } = req.body;
      const domain = getJiraDomain();
      
      const response = await fetch(`${domain}/rest/api/2/issue/${issueKey}/comment`, {
        method: 'POST',
        headers: getJiraHeaders(),
        body: JSON.stringify({ body })
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: `Jira API Error: ${err}` });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/jira/attachment", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing attachment URL' });
      }
      
      const response = await fetch(url, {
        headers: getJiraHeaders()
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: `Jira API Error: ${err}` });
      }

      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      
      res.setHeader('Content-Type', contentType);
      res.send(Buffer.from(buffer));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/jira/stories/:issueKey", async (req, res) => {
    try {
      const { issueKey } = req.params;
      const domain = getJiraDomain();
      
      const response = await fetch(`${domain}/rest/api/3/issue/${issueKey}?expand=names,renderedFields`, {
        headers: getJiraHeaders()
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: `Jira API Error: ${err}` });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const isProduction = process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT;

  if (isProduction && !process.env.VERCEL) {
    app.use(express.static("dist"));
    // Handle SPA routing
    app.get(/.*/, (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.resolve("dist/index.html"));
    });
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Production server running on port ${PORT}`);
    });
  } else if (!process.env.VERCEL) {
    // Vite middleware for development
    (async () => {
      const viteModule = "vite";
      const { createServer: createViteServer } = await import(viteModule);
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Development server running on port ${PORT}`);
      });
    })();
  }

export default app;
