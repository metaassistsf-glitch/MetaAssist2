
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SalesforceOrgData } from '../types';
import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import { auth } from '../firebase';

interface DeepResearchProps {
  orgData: SalesforceOrgData;
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  images?: { data: string; mimeType: string }[];
}

const DeepResearch: React.FC<DeepResearchProps> = ({ orgData }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [chatSession, setChatSession] = useState<any>(null);
  const [selectedImages, setSelectedImages] = useState<{ data: string; mimeType: string; preview: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    const timer = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timer);
  }, [messages, isLoading]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        setSelectedImages(prev => [...prev, { 
          data: base64, 
          mimeType: file.type, 
          preview: reader.result as string 
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  const saveHistory = async (newMessages: ChatMessage[]) => {
    try {
      const ownerUid = auth.currentUser?.uid;
      await fetch(`/api/orgs/${orgData.orgId}/chat-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          messages: newMessages,
          ownerUid
        })
      });
    } catch (err) {
      console.error("Failed to save chat history:", err);
    }
  };

  const initChat = useCallback(async () => {
    setIsInitializing(true);
    try {
      let initialMessages: ChatMessage[] = [];

      try {
        const res = await fetch(`/api/orgs/${orgData.orgId}/chat-history?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          if (data.messages && data.messages.length > 0) {
            initialMessages = data.messages;
          }
        }
      } catch (err) {
        console.error("Failed to fetch chat history:", err);
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const searchComponentDeclaration: FunctionDeclaration = {
        name: "searchDatabaseForComponent",
        description: "Searches the local database for a specific Salesforce component (like an Apex Class, Trigger, LWC, Flow, Object, etc.) by its name and returns its metadata and code content.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            componentName: {
              type: Type.STRING,
              description: "The name of the Salesforce component to search for (e.g., 'AccountTrigger', 'MyController', 'Custom_Object__c')."
            }
          },
          required: ["componentName"]
        }
      };

      const geminiHistory = initialMessages.map(msg => {
        const parts: any[] = [{ text: msg.text }];
        if (msg.images) {
          msg.images.forEach(img => {
            parts.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
          });
        }
        return { role: msg.role, parts };
      });

      const session = ai.chats.create({
        model: "gemini-2.5-pro",
        history: geminiHistory.length > 0 ? geminiHistory : undefined,
        config: {
          systemInstruction: `You are an expert Salesforce Architect and Developer assistant. 
          The user's Org ID is ${orgData.orgId}.
          
          You help users analyze, explain, and enhance their Salesforce org. 
          When they ask about a component, use 'searchDatabaseForComponent' to get the real code.
          
          Focus on providing technical, accurate, and secure Salesforce solutions. 
          Identify performance bottlenecks, security risks (SOQLi, FLS), and recommend modern alternatives (LWC, Flows).`,
          tools: [{ functionDeclarations: [searchComponentDeclaration] }],
          temperature: 0.1
        }
      });

      setChatSession(session);
      
      if (initialMessages.length > 0) {
        setMessages(initialMessages);
      } else {
        const welcomeMsg: ChatMessage = { role: 'model', text: "Hello! I'm your Salesforce AI Assistant. I can search your org's database to explain components, analyze code, and suggest enhancements. What would you like to look at today?" };
        setMessages([welcomeMsg]);
        saveHistory([welcomeMsg]);
      }
    } catch (error) {
      console.error("Failed to initialize chat:", error);
    } finally {
      setIsInitializing(false);
    }
  }, [orgData]);

  useEffect(() => {
    if (orgData) {
      initChat();
    }
  }, [orgData, initChat]);

  const handleClearChat = async () => {
    try {
      setIsLoading(true);
      setShowClearConfirm(false);
      
      const res = await fetch(`/api/orgs/${orgData.orgId}/chat-history?t=${Date.now()}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        setMessages([]);
        setChatSession(null);
        setSelectedImages([]);
        setInput('');
        await initChat(); // Re-initialize chat session directly
        setIsLoading(false);
      } else {
        const errorData = await res.json();
        console.error("Clear chat failed:", errorData);
        alert("Failed to clear chat: " + (errorData.error || "Unknown error"));
        setIsLoading(false);
      }
    } catch (err) {
      console.error("Failed to clear chat history:", err);
      alert("An error occurred while clearing chat history.");
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!input.trim() && selectedImages.length === 0) || !chatSession || isLoading) return;

    const userText = input.trim();
    const currentImages = selectedImages.map(img => ({ data: img.data, mimeType: img.mimeType }));
    
    setInput('');
    setSelectedImages([]);
    
    const newMessages = [...messages, { role: 'user' as const, text: userText, images: currentImages }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      const messageParts: any[] = [{ text: userText || "Analyze the attached image(s)." }];
      currentImages.forEach(img => {
        messageParts.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
      });

      const response = await chatSession.sendMessage({ message: messageParts });
      let finalResponse = response;

      // Handle function calls in a loop for more complex reasoning
      if (response.functionCalls && response.functionCalls.length > 0) {
        let currentResponse = response;
        let iteration = 0;
        const MAX_ITERATIONS = 5;

        while (currentResponse.functionCalls && currentResponse.functionCalls.length > 0 && iteration < MAX_ITERATIONS) {
          iteration++;
          const call = currentResponse.functionCalls[0];
          
          if (call.name === 'searchDatabaseForComponent') {
            const args = call.args as any;
            const componentName = args.componentName;
            
            // Temporary message to show progress
            setMessages(prev => [...prev.filter(m => !m.text.includes('Searching database')), { role: 'model', text: `*Searching database for: **${componentName}**...*` }]);
            
            let searchResult;
            try {
              const res = await fetch(`/api/orgs/${orgData.orgId}/search-component?name=${encodeURIComponent(componentName)}`);
              if (res.ok) {
                const data = await res.json();
                searchResult = {
                  found: true,
                  category: data.category,
                  name: data.name || data.DeveloperName || data.Label,
                  content: data.content || data.Body || data.Markup || JSON.stringify(data, null, 2)
                };
              } else {
                searchResult = { found: false, message: `Component "${componentName}" not found in the local database.` };
              }
            } catch (err) {
              searchResult = { found: false, error: "Failed to query the database." };
            }

            currentResponse = await chatSession.sendMessage({
              message: [{
                functionResponse: {
                  name: call.name,
                  response: searchResult
                }
              }]
            });
            finalResponse = currentResponse;
            setMessages(prev => prev.filter(m => !m.text.includes('Searching database')));
          } else {
            break;
          }
        }

        if (iteration >= MAX_ITERATIONS) {
          console.warn("Exceeded max tool call iterations.");
        }
      }

      if (finalResponse.text) {
        const updatedMessages = [...newMessages, { role: 'model' as const, text: finalResponse.text }];
        setMessages(updatedMessages);
        saveHistory(updatedMessages);
      }
    } catch (error: any) {
      console.error("Chat error:", error);
      const errorMessages = [...newMessages, { role: 'model' as const, text: `Sorry, I encountered an error: ${error.message}. Please try refreshing or clear the chat if context is too large.` }];
      setMessages(errorMessages);
      saveHistory(errorMessages);
    } finally {
      setIsLoading(false);
    }
  };

  if (isInitializing) {
    return (
      <div className="animate-fadeIn h-[calc(100vh-180px)] flex flex-col items-center justify-center bg-white rounded-2xl border border-slate-200 shadow-sm mx-6">
        <div className="relative w-16 h-16 mb-6">
          <div className="absolute inset-0 border-4 border-[#FFE600]/30 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-[#FFE600] border-t-transparent rounded-full animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center text-[#2E2E38]">
            <i className="fas fa-robot text-2xl"></i>
          </div>
        </div>
        <h3 className="text-slate-900 font-bold text-lg mb-1">Initializing AI Assistant</h3>
        <p className="text-slate-500 font-medium">Restoring conversation context and ground rules...</p>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn h-[calc(100vh-180px)] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mx-6">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full bg-[#FFE600] flex items-center justify-center text-white shadow-md shadow-[#FFE600]/30">
            <i className="fas fa-robot text-lg"></i>
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Deep Research Assistant</h2>
            <p className="text-[10px] text-slate-500 font-black uppercase tracking-wider">Org-Aware Smart Intelligence</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
          {showClearConfirm ? (
            <div className="flex items-center space-x-2">
              <span className="text-xs text-red-600 font-bold mr-2">Are you sure?</span>
              <button 
                onClick={handleClearChat}
                disabled={isLoading}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                YES, CLEAR
              </button>
              <button 
                onClick={() => setShowClearConfirm(false)}
                disabled={isLoading}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50"
              >
                CANCEL
              </button>
            </div>
          ) : (
            <button 
              onClick={() => setShowClearConfirm(true)}
              disabled={isLoading}
              className="flex items-center space-x-2 px-4 py-2 rounded-xl text-[11px] font-bold text-slate-600 bg-white border border-slate-200 hover:text-red-600 hover:bg-red-50 hover:border-red-200 transition-all disabled:opacity-50"
            >
              <i className="fas fa-trash-alt"></i>
              <span>CLEAR HISTORY</span>
            </button>
          )}
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-50/20">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fadeIn`}>
            <div className={`max-w-[85%] lg:max-w-[75%] rounded-[32px] overflow-hidden ${
              msg.role === 'user' 
                ? 'bg-[#FFE600] text-[#2E2E38] shadow-xl shadow-[#FFE600]/30 rounded-tr-none' 
                : 'bg-white border border-slate-200 text-slate-700 shadow-sm rounded-tl-none'
            }`}>
              <div className="px-6 py-5">
                {msg.images && msg.images.length > 0 && (
                  <div className="flex flex-wrap gap-3 mb-4">
                    {msg.images.map((img, i) => (
                      <img 
                        key={i} 
                        src={`data:${img.mimeType};base64,${img.data}`} 
                        alt="Shared content" 
                        className="max-w-[300px] max-h-[300px] rounded-2xl border-2 border-white/10 shadow-lg object-cover"
                      />
                    ))}
                  </div>
                )}
                {msg.role === 'model' ? (
                  <div className="markdown-body text-sm prose prose-slate max-w-none prose-p:leading-relaxed prose-pre:bg-[#2E2E38] prose-pre:text-slate-50 prose-pre:rounded-2xl prose-code:text-indigo-600 prose-code:bg-indigo-50/50 prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm font-medium whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                )}
              </div>
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="flex justify-start animate-fadeIn">
            <div className="bg-white border border-slate-200 rounded-[24px] rounded-tl-none px-6 py-4 shadow-sm flex items-center space-x-3">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-[#FFE600]/100 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-[#FFE600]/100 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-2 h-2 bg-[#FFE600]/100 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
              </div>
              <span className="text-[10px] font-black text-[#2E2E38] uppercase tracking-widest">AI is thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} className="h-4" />
      </div>

      {/* Input Area */}
      <div className="p-6 bg-white border-t border-slate-100">
        {selectedImages.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-4 px-2">
            {selectedImages.map((img, idx) => (
              <div key={idx} className="relative group animate-fadeIn">
                <img src={img.preview} alt="Upload" className="w-20 h-20 rounded-2xl object-cover border-2 border-slate-100 shadow-sm" />
                <button 
                  onClick={() => removeImage(idx)}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] shadow-lg hover:bg-red-600 transition-all transform hover:scale-110"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={handleSendMessage} className="relative flex items-center space-x-3">
          <input 
            type="file"
            ref={fileInputRef}
            onChange={handleImageSelect}
            multiple
            accept="image/*"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-12 h-12 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-[20px] transition-all shrink-0"
            title="Attach Screenshots"
          >
            <i className="fas fa-camera text-sm"></i>
          </button>
          <div className="flex-1 relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about components, describe problems, or request enhancements..."
              className="w-full bg-slate-50 border border-slate-200 rounded-[20px] pl-5 pr-14 py-4 text-sm font-medium focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-[#FFE600]/30 transition-all"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={(!input.trim() && selectedImages.length === 0) || isLoading}
              className="absolute right-2 top-2 bottom-2 px-4 flex items-center justify-center bg-[#FFE600] hover:bg-[#E5CF00] disabled:bg-slate-200 text-white rounded-[14px] transition-all shadow-lg shadow-[#FFE600]/30 disabled:shadow-none"
            >
              <i className="fas fa-paper-plane text-[10px]"></i>
            </button>
          </div>
        </form>
        <div className="mt-4 flex items-center justify-center space-x-4 opacity-50">
          <div className="h-px w-8 bg-slate-200"></div>
          <p className="text-[9px] text-slate-400 uppercase tracking-[0.2em] font-black">
            Built with Gemini 2.5 Pro • Salesforce Org-Aware Analysis
          </p>
          <div className="h-px w-8 bg-slate-200"></div>
        </div>
      </div>
    </div>
  );
};

export default DeepResearch;