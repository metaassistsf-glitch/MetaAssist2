
import React, { useState, useEffect } from 'react';
import AppLogo from './AppLogo';
import { auth } from '../firebase';

interface SalesforceOAuthLoginProps {
  onSuccess: (data: any) => void;
}

const SalesforceOAuthLogin: React.FC<SalesforceOAuthLoginProps> = ({ onSuccess }) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [envType, setEnvType] = useState<'prod' | 'sandbox' | 'custom'>('prod');
  const [customUrl, setCustomUrl] = useState('');
  
  // Custom Credentials State
  const [useCustomCreds, setUseCustomCreds] = useState(false);
  const [username, setUsername] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saveCreds, setSaveCreds] = useState(true);
  const [isCheckingCreds, setIsCheckingCreds] = useState(false);
  const [credsFound, setCredsFound] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Validate origin
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.endsWith('.railway.app') && !origin.includes('localhost')) {
        return;
      }
      
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsConnecting(false);
        onSuccess(event.data.data);
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        setIsConnecting(false);
        setError(event.data.error || 'Authentication failed');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSuccess]);

  const checkExistingCreds = async () => {
    if (!username || username.length < 3) return;
    
    setIsCheckingCreds(true);
    try {
      const res = await fetch(`/api/auth/check/${encodeURIComponent(username)}`);
      const data = await res.json();
      if (data.exists) {
        setCredsFound(true);
        // We don't fetch the actual creds here for security, 
        // the server will fetch them during the OAuth URL generation.
      } else {
        setCredsFound(false);
      }
    } catch (e) {
      console.error("Failed to check credentials", e);
    } finally {
      setIsCheckingCreds(false);
    }
  };

  const handleLogin = async () => {
    setIsConnecting(true);
    setError(null);
    
    try {
      const instanceUrl = envType === 'prod' 
        ? 'https://login.salesforce.com' 
        : envType === 'sandbox' 
          ? 'https://test.salesforce.com' 
          : customUrl;

      if (!instanceUrl) {
        throw new Error('Please provide a valid instance URL');
      }

      const ownerUid = auth.currentUser?.uid;

      // If using custom creds and they are new, save them first
      if (useCustomCreds && !credsFound && clientId && clientSecret) {
        const saveRes = await fetch('/api/auth/salesforce/creds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, clientId, clientSecret, instanceUrl, ownerUid })
        });
        if (!saveRes.ok) {
          const data = await saveRes.json();
          throw new Error(data.error || 'Failed to save custom credentials');
        }
      }

      let urlQuery = `instanceUrl=${encodeURIComponent(instanceUrl)}`;
      if (username) urlQuery += `&username=${encodeURIComponent(username)}`;
      if (useCustomCreds && clientId) urlQuery += `&clientId=${encodeURIComponent(clientId)}`;
      if (ownerUid) urlQuery += `&authUid=${encodeURIComponent(ownerUid)}`;

      const response = await fetch(`/api/auth/salesforce/url?${urlQuery}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to get authorization URL');
      }
      
      const { url } = await response.json();
      
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      
      const authWindow = window.open(
        url,
        'salesforce_oauth_popup',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
      );

      if (!authWindow) {
        throw new Error('Popup blocked. Please allow popups for this site.');
      }
    } catch (err: any) {
      setError(err.message);
      setIsConnecting(false);
    }
  };

  return (
    <div className="max-w-xl w-full bg-white rounded-[32px] shadow-2xl overflow-hidden border border-slate-200 animate-fadeIn">
      <div className="bg-[#2E2E38] p-10 text-white relative overflow-hidden">
        <div className="absolute -right-10 -bottom-10 text-white/5 text-[12rem]">
          <i className="fab fa-salesforce"></i>
        </div>
        
        <div className="relative z-10">
          <div className="flex items-center space-x-4 mb-4">
            <AppLogo size="lg" />
            <div>
              <h1 className="text-xl font-semibold tracking-tighter uppercase leading-tight text-white">Metaassist</h1>
              <p className="text-[#FFE600] text-[10px] font-semibold uppercase tracking-[0.3em]">Salesforce Intelligence Suite</p>
            </div>
          </div>
          <p className="text-slate-400 text-sm leading-relaxed max-w-sm">
            Securely connect to your Salesforce organization using the official Authorization Code flow.
          </p>
        </div>
      </div>

      <div className="p-10 space-y-6">
        {error && (
          <div className="bg-rose-50 border border-rose-200 p-5 rounded-2xl animate-shake">
            <div className="flex items-start space-x-3 text-rose-600">
              <i className="fas fa-exclamation-circle mt-1 shrink-0"></i>
              <div className="text-xs font-semibold leading-relaxed">
                <p className="uppercase tracking-tight mb-1">Authentication Error:</p>
                <p>{error}</p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest ml-1">Environment</label>
          </div>
          <div className="flex p-1 bg-slate-100 rounded-xl">
            {(['prod', 'sandbox', 'custom'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setEnvType(type)}
                className={`flex-1 px-4 py-2 text-[9px] font-semibold uppercase tracking-widest rounded-lg transition-all ${
                  envType === type ? 'bg-white text-[#2E2E38] shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {type === 'prod' ? 'Prod' : type === 'sandbox' ? 'Sandbox' : 'Custom'}
              </button>
            ))}
          </div>
        </div>

        {envType === 'custom' && (
          <div className="space-y-1.5 animate-fadeIn">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest ml-1">Custom Domain URL</label>
            <input 
              type="text" 
              placeholder="https://mycompany.my.salesforce.com"
              className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-semibold"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
            />
          </div>
        )}

        <div className="space-y-4 border-t border-slate-100 pt-6">
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest ml-1 flex items-center justify-between">
              <span>Identity / Username</span>
              {isCheckingCreds && <i className="fas fa-circle-notch fa-spin text-[#2E2E38]"></i>}
            </label>
            <div className="relative">
              <input 
                type="text" 
                placeholder="e.g. MyOrg or user@example.com"
                className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-semibold"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onBlur={checkExistingCreds}
              />
              {credsFound && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-emerald-500 flex items-center space-x-1">
                  <i className="fas fa-check-circle text-xs"></i>
                  <span className="text-[9px] font-bold uppercase tracking-tighter">Stored</span>
                </div>
              )}
            </div>
          </div>

          <div className="pt-2">
            <details className="group">
              <summary className="flex items-center cursor-pointer list-none text-[10px] font-semibold text-slate-400 uppercase tracking-widest hover:text-[#2E2E38] transition-colors">
                <i className="fas fa-cog mr-2 group-open:rotate-90 transition-transform"></i>
                Advanced Settings
              </summary>
              <div className="mt-4 p-4 bg-slate-50 rounded-xl space-y-4 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-700">Custom Connected App</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Use your own Client ID and Secret for OAuth</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={useCustomCreds}
                      onChange={(e) => setUseCustomCreds(e.target.checked)}
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#FFE600]"></div>
                  </label>
                </div>
              </div>
            </details>
          </div>

          {useCustomCreds && !credsFound && (
            <div className="space-y-4 animate-fadeIn">
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest ml-1">Consumer Key (Client ID)</label>
                <input 
                  type="text" 
                  placeholder="Enter Client ID"
                  className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-mono"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest ml-1">Consumer Secret</label>
                <input 
                  type="password" 
                  placeholder="Enter Client Secret"
                  className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-mono"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <div className="pt-4">
          <button 
            onClick={handleLogin}
            disabled={isConnecting || isCheckingCreds}
            className="w-full py-5 bg-[#FFE600] hover:bg-[#E5CF00] disabled:bg-blue-400 text-white font-semibold rounded-2xl transition-all shadow-2xl shadow-[#FFE600]/30 flex items-center justify-center space-x-3"
          >
            {isConnecting ? (
              <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div><span className="uppercase tracking-widest text-xs">Opening Salesforce...</span></>
            ) : (
              <><i className="fab fa-salesforce text-lg"></i><span className="uppercase tracking-widest text-xs">Connect to Salesforce</span></>
            )}
          </button>
        </div>

        <div className="text-center">
          <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
            {credsFound 
              ? "Using stored Connected App credentials for this identity." 
              : "By connecting, you authorize Metaassist to access your Salesforce metadata and data."}
          </p>
        </div>
      </div>
    </div>
  );
};

export default SalesforceOAuthLogin;
