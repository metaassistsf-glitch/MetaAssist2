
import React, { useState, useEffect } from 'react';
import { AuthConfig, ProxyProvider, AuthResponse } from '../types';
import AppLogo from './AppLogo';

interface AuthFormProps {
  onConnect: (config: AuthConfig) => void;
  isConnecting: boolean;
  error?: string | null;
}
const AuthForm: React.FC<AuthFormProps> = ({ onConnect, isConnecting, error }) => {
  const [envType, setEnvType] = useState<'prod' | 'sandbox' | 'custom'>('prod');
  const [credsExist, setCredsExist] = useState(false);
  const [isCheckingCreds, setIsCheckingCreds] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [usernameChecked, setUsernameChecked] = useState(false);
  
  const [config, setConfig] = useState<AuthConfig>({
    instanceUrl: 'https://login.salesforce.com',
    clientId: '',
    clientSecret: '',
    username: '',
    password: '',
    useProxy: true,
    proxyProvider: 'allorigins',
    useHybridMode: true
  });

  const [showClientId, setShowClientId] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Check for existing creds when username changes
  useEffect(() => {
    if (!config.username || config.username.length < 5) {
      setCredsExist(false);
      setUsernameChecked(false);
      return;
    }
    // We only check on submit now as per request
  }, [config.username]);

  const handleEnvChange = (type: 'prod' | 'sandbox' | 'custom') => {
    let baseUrl = '';
    if (type === 'prod') baseUrl = 'https://login.salesforce.com';
    else if (type === 'sandbox') baseUrl = 'https://test.salesforce.com';
    else baseUrl = '';
    
    setEnvType(type);
    setConfig({ ...config, instanceUrl: baseUrl });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (authMode === 'login') {
      setIsCheckingCreds(true);
      try {
        const res = await fetch(`/api/auth/check/${encodeURIComponent(config.username)}`);
        const data = await res.json();
        
        if (data.message === "Database not configured") {
          // Database is missing (likely .env issue)
          setCredsExist(false);
          setUsernameChecked(true);
          setIsCheckingCreds(false);
          // We can optionally set a more specific error message here if needed
          return;
        }

        if (!data.exists) {
          // User not found in DB - Show specific error
          setCredsExist(false);
          setUsernameChecked(true);
          setIsCheckingCreds(false);
          return;
        }
        setCredsExist(true);
        setUsernameChecked(true);
      } catch (e) {
        console.error("Check failed", e);
      } finally {
        setIsCheckingCreds(false);
      }
    }
    
    onConnect(config);
  };

  const isUsernameValid = config.username.length >= 5;

  return (
    <div className="max-w-xl w-full bg-white rounded-[32px] shadow-2xl overflow-hidden border border-slate-200 animate-fadeIn">
      <div className="bg-[#2E2E38] p-10 text-white relative overflow-hidden">
        <div className="absolute -right-10 -bottom-10 text-white/5 text-[12rem]">
          <i className="fas fa-robot"></i>
        </div>
        
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-4">
              <AppLogo size="lg" />
              <div>
                <h1 className="text-xl font-semibold tracking-tighter uppercase leading-tight">Metaassist</h1>
                <p className="text-[#FFE600] text-[10px] font-semibold uppercase tracking-[0.3em]">Salesforce Intelligence Suite</p>
              </div>
            </div>
          </div>
          <p className="text-slate-400 text-sm leading-relaxed max-w-sm">
            {authMode === 'login' 
              ? "Welcome back! Access your Salesforce Org with just your credentials."
              : "First-time setup: Register your Salesforce Client Credentials and Security Token."}
          </p>
        </div>
      </div>

      <div className="px-10 pt-8 flex items-center justify-between">
        <div className="flex p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setAuthMode('login')}
            className={`px-6 py-2 text-[10px] font-semibold uppercase tracking-widest rounded-lg transition-all ${
              authMode === 'login' ? 'bg-white text-[#2E2E38] shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => setAuthMode('register')}
            className={`px-6 py-2 text-[10px] font-semibold uppercase tracking-widest rounded-lg transition-all ${
              authMode === 'register' ? 'bg-white text-[#2E2E38] shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            New User
          </button>
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

      <form onSubmit={handleSubmit} className="p-10 space-y-6">
        {error && (
          <div className="bg-rose-50 border border-rose-200 p-5 rounded-2xl animate-shake">
            <div className="flex items-start space-x-3 text-rose-600">
              <i className="fas fa-exclamation-circle mt-1 shrink-0"></i>
              <div className="text-xs font-semibold leading-relaxed">
                <p className="uppercase tracking-tight mb-1">Connection Error:</p>
                <p>
                  {error.includes("invalid_grant") 
                    ? "Authentication failed. Your Password or Security Token might be incorrect or expired. Please check your credentials."
                    : error}
                </p>
                {error.includes("OAUTH_400") && (
                  <div className="mt-3 p-3 bg-rose-100/50 rounded-xl border border-rose-200">
                    <p className="font-semibold text-[10px] uppercase tracking-widest mb-1">💡 Pro Tip:</p>
                    <p className="text-[11px] font-medium leading-relaxed">
                      Salesforce often requires you to append your <b>Security Token</b> directly to the end of your <b>Password</b> (e.g. <code>MyPassword123ABCtokenXYZ</code>) if you are connecting from an untrusted IP.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
           <div className="space-y-1.5 md:col-span-2">
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

          <div className="space-y-1.5 md:col-span-2">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest ml-1 flex items-center justify-between">
              <span>Salesforce Username</span>
              {isCheckingCreds && <i className="fas fa-circle-notch fa-spin text-[#2E2E38]"></i>}
            </label>
            <input 
              type="text" 
              required
              placeholder="user@example.com"
              className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-semibold"
              value={config.username}
              onChange={(e) => setConfig({...config, username: e.target.value})}
            />
          </div>

          {authMode === 'login' && usernameChecked && !credsExist && (
            <div className="md:col-span-2 p-5 bg-rose-50 border border-rose-100 rounded-2xl flex items-start space-x-3 animate-fadeIn">
              <i className="fas fa-user-slash text-rose-400 mt-1"></i>
              <p className="text-[11px] font-semibold text-rose-700 leading-relaxed">
                Account not found. Please <button type="button" onClick={() => setAuthMode('register')} className="underline font-semibold hover:text-rose-900 transition-colors">sign up / register</button> your Client Credentials first to proceed.
              </p>
            </div>
          )}

          {authMode === 'register' && (
            <>
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
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-mono"
                    value={config.clientSecret}
                    onChange={(e) => setConfig({...config, clientSecret: e.target.value})}
                  />
                  <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-[#2E2E38] transition-colors">
                    <i className={`fas ${showSecret ? 'fa-eye-slash' : 'fa-eye'} text-xs`} />
                  </button>
                </div>
              </div>
            </>
          )}

          <div className="space-y-1.5 relative md:col-span-2">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest ml-1">Password</label>
            <div className="relative">
              <input 
                type={showPassword ? "text" : "password"} 
                required
                placeholder="Enter Salesforce Password"
                className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-semibold"
                value={config.password}
                onChange={(e) => setConfig({...config, password: e.target.value})}
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-[#2E2E38] transition-colors">
                <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'} text-xs`} />
              </button>
            </div>
          </div>

          {authMode === 'register' && (
            <div className="md:col-span-2 p-5 bg-[#FFE600]/10 border border-[#FFE600]/30 rounded-2xl flex items-start space-x-3 animate-fadeIn">
              <i className="fas fa-info-circle text-[#FFE600] mt-1"></i>
              <p className="text-[11px] font-semibold text-blue-700 leading-relaxed">
                Note: Ensure your Salesforce Org allows login from this server's IP range, or that your Connected App has "IP Relaxation" set to "Relax IP restrictions".
              </p>
            </div>
          )}

          <div className="md:col-span-2 pt-4 border-t border-slate-100">
            <details className="group">
              <summary className="flex items-center cursor-pointer list-none text-[10px] font-semibold text-slate-400 uppercase tracking-widest hover:text-[#2E2E38] transition-colors">
                <i className="fas fa-cog mr-2 group-open:rotate-90 transition-transform"></i>
                Advanced Settings
              </summary>
              <div className="mt-4 p-4 bg-slate-50 rounded-xl space-y-4 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-700">Direct Mode</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Bypass proxy and connect directly from browser (Requires CORS)</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={!config.useProxy}
                      onChange={(e) => {
                        const isDirect = e.target.checked;
                        setConfig({
                          ...config,
                          useProxy: !isDirect,
                          useHybridMode: !isDirect // Disable hybrid mode if direct mode is on
                        });
                      }}
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#FFE600]"></div>
                  </label>
                </div>
              </div>
            </details>
          </div>
        </div>

        <button 
          type="submit"
          disabled={isConnecting || isCheckingCreds}
          className="w-full py-5 bg-[#FFE600] hover:bg-[#E5CF00] disabled:bg-blue-400 text-white font-semibold rounded-2xl transition-all shadow-2xl shadow-[#FFE600]/30 flex items-center justify-center space-x-3"
        >
          {isConnecting ? (
            <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div><span className="uppercase tracking-widest text-xs">Connecting...</span></>
          ) : (
            <><i className="fab fa-salesforce text-lg"></i><span className="uppercase tracking-widest text-xs">Connect to Salesforce</span></>
          )}
        </button>
      </form>
    </div>
  );
};

export default AuthForm;
