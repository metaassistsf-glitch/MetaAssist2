
import React, { useState, useEffect } from 'react';
import { OAuthAuthConfig, AuthResponse } from '../types';
import AppLogo from './AppLogo';

interface OAuthAuthFormProps {
  onConnect: (authData: AuthResponse) => void;
  isConnecting: boolean;
  error?: string | null;
}

const OAuthAuthForm: React.FC<OAuthAuthFormProps> = ({ onConnect, isConnecting, error: externalError }) => {
  const [envType, setEnvType] = useState<'prod' | 'sandbox' | 'custom'>('prod');
  const [error, setError] = useState<string | null>(externalError || null);
  const [isStartingFlow, setIsStartingFlow] = useState(false);
  
  const [config, setConfig] = useState<OAuthAuthConfig>({
    instanceUrl: 'https://login.salesforce.com',
    clientId: '',
    clientSecret: '',
  });

  const [showClientId, setShowClientId] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    setError(externalError || null);
  }, [externalError]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Validate origin
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.endsWith('.railway.app') && !origin.includes('localhost')) {
        return;
      }

      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        onConnect(event.data.data);
        setIsStartingFlow(false);
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        setError(event.data.error || 'Authentication failed');
        setIsStartingFlow(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onConnect]);

  const handleEnvChange = (type: 'prod' | 'sandbox' | 'custom') => {
    let baseUrl = '';
    if (type === 'prod') baseUrl = 'https://login.salesforce.com';
    else if (type === 'sandbox') baseUrl = 'https://test.salesforce.com';
    else baseUrl = '';
    
    setEnvType(type);
    setConfig({ ...config, instanceUrl: baseUrl });
  };

  const handleOAuthLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsStartingFlow(true);

    try {
      const redirectUri = `${window.location.origin}/auth/callback`;
      
      const response = await fetch('/api/auth/salesforce/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          redirectUri
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to get authorization URL');
      }

      const { url } = await response.json();

      // Open popup
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      
      const authWindow = window.open(
        url,
        'salesforce_oauth',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
      );

      if (!authWindow) {
        throw new Error('Popup blocked. Please allow popups for this site.');
      }
    } catch (err: any) {
      setError(err.message);
      setIsStartingFlow(false);
    }
  };

  return (
    <div className="max-w-xl w-full bg-white rounded-[32px] shadow-2xl overflow-hidden border border-slate-200 animate-fadeIn">
      <div className="bg-[#2E2E38] p-10 text-white relative overflow-hidden">
        <div className="absolute -right-10 -bottom-10 text-white/5 text-[12rem]">
          <i className="fas fa-shield-halved"></i>
        </div>
        
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-4">
              <AppLogo size="lg" />
              <div>
                <h1 className="text-xl font-semibold tracking-tighter uppercase leading-tight">Metaassist</h1>
                <p className="text-[#FFE600] text-[10px] font-semibold uppercase tracking-[0.3em]">OAuth 2.0 Authorization</p>
              </div>
            </div>
          </div>
          <p className="text-slate-400 text-sm leading-relaxed max-w-sm">
            Connect securely using Salesforce Authorization Code flow. This method is more secure and recommended for production environments.
          </p>
        </div>
      </div>

      <div className="px-10 pt-8 flex items-center justify-between">
        <div className="flex p-1 bg-slate-100 rounded-xl">
          <div className="px-6 py-2 text-[10px] font-bold uppercase tracking-widest text-[#2E2E38] bg-white rounded-lg shadow-sm">
            OAuth Login
          </div>
        </div>

        <div className="flex p-1 bg-slate-100 rounded-xl">
          {(['prod', 'sandbox', 'custom'] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => handleEnvChange(type)}
              className={`px-4 py-2 text-[9px] font-semibold uppercase tracking-widest rounded-lg transition-all ${
                envType === type ? 'bg-white text-[#2E2E38] shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {type === 'prod' ? 'Prod' : type === 'sandbox' ? 'Sandbox' : 'Custom'}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleOAuthLogin} className="p-10 space-y-6">
        <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl text-xs text-blue-800 space-y-2">
          <p className="font-semibold">Important Configuration Step:</p>
          <p>Please ensure you have added the following <strong>Callback URL</strong> to your Salesforce Connected App settings:</p>
          <code className="block p-2 bg-white rounded border border-blue-200 break-all select-all font-mono text-[10px]">
            {typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : ''}
          </code>
        </div>
        
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

        <div className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest ml-1">Instance URL</label>
            <input 
              type="text" 
              required
              readOnly={envType !== 'custom'}
              placeholder="e.g. https://mycompany.my.salesforce.com"
              className={`w-full px-5 py-3.5 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-semibold ${
                envType !== 'custom' ? 'bg-slate-100 text-slate-500' : 'bg-slate-50 text-slate-700'
              }`}
              value={config.instanceUrl}
              onChange={(e) => setConfig({...config, instanceUrl: e.target.value})}
            />
          </div>

          <div className="space-y-1.5 relative">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest ml-1">Consumer Key (Client ID)</label>
            <div className="relative">
              <input 
                type={showClientId ? "text" : "password"} 
                required
                placeholder="Enter Client ID"
                className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-mono"
                value={config.clientId}
                onChange={(e) => setConfig({...config, clientId: e.target.value})}
              />
              <button type="button" onClick={() => setShowClientId(!showClientId)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-[#2E2E38] transition-colors">
                <i className={`fas ${showClientId ? 'fa-eye-slash' : 'fa-eye'} text-xs`} />
              </button>
            </div>
          </div>

          <div className="space-y-1.5 relative">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest ml-1">Consumer Secret</label>
            <div className="relative">
              <input 
                type={showSecret ? "text" : "password"} 
                required
                placeholder="Enter Client Secret"
                className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-mono"
                value={config.clientSecret}
                onChange={(e) => setConfig({...config, clientSecret: e.target.value})}
              />
              <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-[#2E2E38] transition-colors">
                <i className={`fas ${showSecret ? 'fa-eye-slash' : 'fa-eye'} text-xs`} />
              </button>
            </div>
          </div>
        </div>

        <div className="p-5 bg-[#FFE600]/10 border border-[#FFE600]/30 rounded-2xl flex items-start space-x-3">
          <i className="fas fa-info-circle text-[#FFE600] mt-1"></i>
          <div className="text-[11px] font-semibold text-blue-700 leading-relaxed">
            <p className="mb-1">Required Redirect URI:</p>
            <code className="bg-white px-2 py-1 rounded border border-[#FFE600]/30 block mt-1 break-all select-all">
              {window.location.origin}/api/auth/salesforce/callback
            </code>
            <p className="mt-2 opacity-75">Ensure this URL is added to your Salesforce Connected App's Callback URLs.</p>
          </div>
        </div>

        <button 
          type="submit"
          disabled={isConnecting || isStartingFlow}
          className="w-full py-5 bg-[#FFE600] hover:bg-[#E5CF00] disabled:bg-blue-400 text-white font-semibold rounded-2xl transition-all shadow-2xl shadow-[#FFE600]/30 flex items-center justify-center space-x-3"
        >
          {isConnecting || isStartingFlow ? (
            <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div><span className="uppercase tracking-widest text-xs">Waiting for Authorization...</span></>
          ) : (
            <><i className="fab fa-salesforce text-lg"></i><span className="uppercase tracking-widest text-xs">Authorize with Salesforce</span></>
          )}
        </button>
      </form>
    </div>
  );
};

export default OAuthAuthForm;
