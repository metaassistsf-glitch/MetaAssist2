
import React, { useState, useRef, useEffect } from 'react';
import { SalesforceOrgData } from '../types';
import { chatWithOrg } from '../services/geminiService';
import MermaidRenderer from './MermaidRenderer';
import ReactMarkdown from 'react-markdown';
import AppLogo from './AppLogo';

interface Message {
  role: 'user' | 'model';
  text: string;
}

interface AIChatBotProps {
  orgData: SalesforceOrgData;
  isOpen: boolean;
  onClose: () => void;
}

const AIChatBot: React.FC<AIChatBotProps> = ({ orgData, isOpen, onClose }) => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', text: `Hello! I'm your Metaassist. I've analyzed your org "${orgData.orgName}". How can I help you today?` }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'gemini-3-pro-preview' | 'gemini-3-flash-preview'>('gemini-3-pro-preview');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  if (!isOpen) return null;

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    const userMessage: Message = { role: 'user', text: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    try {
      const history = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      const { text: responseText } = await chatWithOrg(orgData, input, history, selectedModel);
      setMessages(prev => [...prev, { role: 'model', text: responseText }]);
    } catch (error: any) {
      if (error.message === "QUOTA_EXHAUSTED") {
        setMessages(prev => [...prev, { 
          role: 'model', 
          text: `The **${selectedModel === 'gemini-3-pro-preview' ? 'Gemini 3 Pro' : 'Gemini 3 Flash'}** model limit has been exhausted. You can try switching to the other model using the toggle in the header, or select a paid API key to continue.` 
        }]);
      } else {
        setMessages(prev => [...prev, { role: 'model', text: "I'm sorry, I encountered an error. Please try again." }]);
      }
    } finally {
      setIsTyping(false);
    }
  };

  const handleOpenKeySelector = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
    }
  };

  const renderMessageContent = (text: string) => {
    const parts = text.split(/(```mermaid[\s\S]*?```)/g);

    return parts.map((part, index) => {
      if (part.startsWith('```mermaid')) {
        const chart = part.replace(/```mermaid\n?/, '').replace(/```$/, '').trim();
        return <MermaidRenderer key={index} chart={chart} />;
      }
      if (part.includes("quota") || part.includes("API key") || part.includes("exhausted")) {
        return (
          <div key={index} className="space-y-4">
            <div className="prose prose-slate max-w-none text-[13px] leading-relaxed">
              <ReactMarkdown>{part}</ReactMarkdown>
            </div>
            <button 
              onClick={handleOpenKeySelector}
              className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl text-[10px] uppercase tracking-widest transition-all shadow-lg shadow-amber-500/20"
            >
              Select Paid API Key
            </button>
            <p className="text-[9px] text-slate-400 text-center italic">
              Note: You must use a key from a project with billing enabled. <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="underline">Learn more</a>
            </p>
          </div>
        );
      }
      return (
        <div key={index} className="prose prose-slate max-w-none text-[13px] leading-relaxed">
          <ReactMarkdown>{part}</ReactMarkdown>
        </div>
      );
    });
  };

  return (
    <div className="fixed bottom-24 right-6 w-[450px] h-[600px] bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col z-[100] animate-slideUp">
      {/* Chat Header */}
      <div className="px-6 py-4 bg-[#2E2E38] text-white flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <AppLogo size="sm" />
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-widest">Metaassist</h2>
            <div className="flex items-center space-x-2 mt-1">
              <div className="flex bg-slate-800 p-0.5 rounded-lg">
                <button
                  onClick={() => setSelectedModel('gemini-3-pro-preview')}
                  className={`px-2 py-0.5 text-[8px] font-semibold uppercase tracking-tighter rounded-md transition-all ${selectedModel === 'gemini-3-pro-preview' ? 'bg-[#FFE600] text-[#2E2E38]' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  Pro
                </button>
                <button
                  onClick={() => setSelectedModel('gemini-3-flash-preview')}
                  className={`px-2 py-0.5 text-[8px] font-semibold uppercase tracking-tighter rounded-md transition-all ${selectedModel === 'gemini-3-flash-preview' ? 'bg-[#FFE600] text-[#2E2E38]' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  Flash
                </button>
              </div>
            </div>
          </div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
          <i className="fas fa-times"></i>
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-50/50">
        {messages.map((m, idx) => (
          <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-fadeIn`}>
            <div className={`max-w-[90%] flex space-x-3 ${m.role === 'user' ? 'flex-row-reverse space-x-reverse' : 'flex-row'}`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm ${
                m.role === 'user' ? 'bg-[#FFE600] text-[#2E2E38]' : 'bg-white border border-slate-200 text-slate-600'
              }`}>
                <i className={`fas ${m.role === 'user' ? 'fa-user' : 'fa-robot'} text-xs`}></i>
              </div>
              <div className={`p-4 rounded-2xl shadow-sm ${
                m.role === 'user' 
                  ? 'bg-[#FFE600] text-[#2E2E38] rounded-tr-none' 
                  : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none'
              }`}>
                {renderMessageContent(m.text)}
              </div>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start animate-fadeIn">
            <div className="flex space-x-3">
              <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                <i className="fas fa-robot text-xs"></i>
              </div>
              <div className="bg-white border border-slate-200 p-4 rounded-2xl rounded-tl-none shadow-sm">
                <div className="flex space-x-1">
                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-6 bg-white border-t border-slate-100">
        <div className="relative flex items-end space-x-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask about your metadata..."
            rows={1}
            className="w-full pl-6 pr-12 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-medium resize-none max-h-32 custom-scrollbar"
            style={{ height: 'auto', minHeight: '56px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className="shrink-0 w-12 h-12 bg-[#FFE600] text-[#2E2E38] rounded-xl flex items-center justify-center shadow-lg shadow-[#FFE600]/30 hover:bg-[#E5CF00] disabled:bg-slate-300 disabled:shadow-none transition-all mb-1"
          >
            <i className="fas fa-paper-plane"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIChatBot;
