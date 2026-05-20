import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface Change {
  title: string;
  summary: string;
  url: string;
}

interface ReleaseDocument {
  name: string;
  date: string;
  url: string;
  changes: Change[];
}

const ReleaseNotes: React.FC = () => {
  const releases: ReleaseDocument[] = [
    {
      name: "Spring '26",
      date: "February 2026",
      url: "https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&type=5&release=260",
      changes: [
        {
          title: "Agentforce Service Agent",
          summary: "Deploy autonomous AI agents that can resolve customer issues across any channel. These agents use real-time data to provide personalized support without human intervention.",
          url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_agentforce_service.htm&release=260&type=5"
        },
        {
          title: "Data Cloud: Real-Time Triggers",
          summary: "Trigger flows and actions instantly based on real-time data changes in Data Cloud. This enables immediate response to customer behaviors as they happen.",
          url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_data_cloud_triggers.htm&release=260&type=5"
        },
        {
          title: "Einstein Copilot for Developers",
          summary: "New AI-powered coding assistant features that help developers write Apex code, LWC components, and SOQL queries faster with natural language prompts.",
          url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_einstein_copilot_dev.htm&release=260&type=5"
        },
        {
          title: "LWC Local Development (GA)",
          summary: "Lightning Web Components local development is now Generally Available, offering real-time preview of components without deploying to an org.",
          url: "#"
        },
        {
          title: "Flow Builder: Reactive Screen Components",
          summary: "Screen flows now support full reactivity across all standard and custom components, reducing the need for multiple screens.",
          url: "#"
        },
        {
          title: "Apex: Null Coalescing Operator",
          summary: "Simplify your Apex code with the new ?? operator to easily provide default values for null variables.",
          url: "#"
        },
        {
          title: "SOQL: Improved Aggregate Queries",
          summary: "New SOQL functions and improved limits for aggregate queries, making it easier to process large datasets directly in the database.",
          url: "#"
        },
        {
          title: "Omni-Channel: AI-Driven Routing",
          summary: "Omni-Channel now uses Einstein to predict the best agent for a case based on historical success rates and current capacity.",
          url: "#"
        },
        {
          title: "Salesforce Scheduler: Multi-Resource Booking",
          summary: "Customers can now book appointments that require multiple resources (e.g., a room and a specialist) in a single transaction.",
          url: "#"
        },
        {
          title: "Experience Cloud: Enhanced LWC Support",
          summary: "Build faster, more responsive digital experiences with expanded support for Lightning Web Components in Experience Builder.",
          url: "#"
        },
        {
          title: "Security Center: Automated Threat Mitigation",
          summary: "Automatically take action on detected security threats, such as revoking sessions or freezing users, based on custom policies.",
          url: "#"
        },
        {
          title: "MuleSoft Direct for Data Cloud",
          summary: "Seamlessly connect external systems to Data Cloud using pre-built MuleSoft integrations without writing code.",
          url: "#"
        }
      ]
    },
    {
      name: "Winter '26",
      date: "October 2025",
      url: "https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&type=5&release=258",
      changes: [
        {
          title: "Agentforce Launch",
          summary: "The official debut of Agentforce, a suite of autonomous AI agents designed to work alongside humans. Includes pre-built agents for sales, service, and marketing.",
          url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_agentforce_launch.htm&release=258&type=5"
        },
        {
          title: "Enhanced Lightning Experience",
          summary: "Significant performance improvements for Lightning pages, reducing load times by up to 30% for complex record pages with many components.",
          url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_lightning_performance.htm&release=258&type=5"
        },
        {
          title: "Salesforce Flow: AI-Powered Mapping",
          summary: "Automatically map fields and variables in Flow using Einstein AI, reducing the manual effort required to build complex business processes.",
          url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_flow_ai_mapping.htm&release=258&type=5"
        },
        {
          title: "Data Cloud: Data Spaces",
          summary: "Logically separate data, metadata, and processes across different departments or brands within a single Data Cloud instance.",
          url: "#"
        },
        {
          title: "Einstein Trust Layer Updates",
          summary: "Enhanced data masking and zero-retention policies for all generative AI features, ensuring enterprise data security.",
          url: "#"
        },
        {
          title: "Apex REST API Improvements",
          summary: "Increased payload limits and improved serialization options for custom Apex REST endpoints.",
          url: "#"
        },
        {
          title: "LWC Offline Support",
          summary: "Build mobile-first Lightning Web Components that function seamlessly without an internet connection using the new Offline API.",
          url: "#"
        },
        {
          title: "Field Service: Predictive Maintenance",
          summary: "Use IoT data and Einstein AI to predict equipment failures and automatically schedule maintenance appointments.",
          url: "#"
        },
        {
          title: "CPQ: Performance Engine",
          summary: "A new calculation engine for Salesforce CPQ that significantly speeds up quote generation for complex configurations.",
          url: "#"
        },
        {
          title: "Marketing Cloud: Generative Content",
          summary: "Create personalized email copy and subject lines instantly using Einstein Generative AI directly within Content Builder.",
          url: "#"
        }
      ]
    },
    {
      name: "Summer '25",
      date: "June 2025",
      url: "https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&type=5&release=256",
      changes: [
        {
          title: "Einstein GPT for Flow",
          summary: "Generate entire flows from natural language descriptions. Simply describe the business process, and Einstein GPT builds the initial flow structure for you.",
          url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_einstein_gpt_flow.htm&release=256&type=5"
        },
        {
          title: "Data Cloud for Industries",
          summary: "Tailored Data Cloud solutions for Financial Services, Health Cloud, and Manufacturing, featuring industry-specific data models and pre-built insights.",
          url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_data_cloud_industries.htm&release=256&type=5"
        },
        {
          title: "Lightning Web Components: Workspace API",
          summary: "New Workspace API for LWC allows developers to programmatically control tabs and subtabs in the Lightning Console directly from their components.",
          url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_lwc_workspace_api.htm&release=256&type=5"
        },
        {
          title: "Flow Orchestration Updates",
          summary: "New capabilities for managing complex, multi-user workflows, including parallel work steps and enhanced debugging tools.",
          url: "#"
        },
        {
          title: "Apex: User Mode Database Operations",
          summary: "Enforce object and field-level security automatically in Apex using the new 'WITH USER_MODE' syntax for DML operations.",
          url: "#"
        },
        {
          title: "SOQL: WITH USER_MODE",
          summary: "Easily enforce sharing rules and field-level security in SOQL queries without complex describe calls.",
          url: "#"
        },
        {
          title: "Lightning Design System (SLDS) 2.0",
          summary: "A modernized version of SLDS featuring design tokens, improved accessibility, and a refreshed visual language.",
          url: "#"
        },
        {
          title: "Sales Cloud: Revenue Intelligence",
          summary: "Purpose-built analytics for sales leaders to track pipeline health, forecast accuracy, and team performance.",
          url: "#"
        },
        {
          title: "Service Cloud Voice Enhancements",
          summary: "Deeper integration with Amazon Connect and new real-time transcription features for agents.",
          url: "#"
        },
        {
          title: "Net Zero Cloud Updates",
          summary: "Automated carbon footprint calculations and new reporting dashboards for ESG compliance.",
          url: "#"
        }
      ]
    }
  ];

  const [selectedRelease, setSelectedRelease] = useState<ReleaseDocument>(releases[0]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setSearchQuery('');
  }, [selectedRelease.name]);

  const filteredChanges = useMemo(() => {
    if (!searchQuery.trim()) return selectedRelease.changes;
    const lowerQuery = searchQuery.toLowerCase();
    return selectedRelease.changes.filter(
      (change) =>
        change.title.toLowerCase().includes(lowerQuery) ||
        change.summary.toLowerCase().includes(lowerQuery)
    );
  }, [selectedRelease, searchQuery]);

  return (
    <div className="flex h-full bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-8 border-b border-slate-100">
          <div className="flex items-center space-x-3 mb-2">
            <div className="w-8 h-8 bg-[#2E2E38] text-white rounded-lg flex items-center justify-center">
              <i className="fas fa-newspaper text-sm"></i>
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Releases</h1>
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Platform Updates</p>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {releases.map((release) => (
            <button
              key={release.name}
              onClick={() => setSelectedRelease(release)}
              className={`w-full text-left p-4 rounded-2xl transition-all flex items-center justify-between group ${
                selectedRelease.name === release.name 
                  ? 'bg-[#2E2E38] text-white shadow-lg shadow-slate-200' 
                  : 'hover:bg-slate-50 text-slate-600'
              }`}
            >
              <div>
                <p className={`font-bold ${selectedRelease.name === release.name ? 'text-white' : 'text-slate-900'}`}>
                  {release.name}
                </p>
                <p className={`text-[10px] font-semibold uppercase tracking-widest ${selectedRelease.name === release.name ? 'text-white/50' : 'text-slate-400'}`}>
                  {release.date}
                </p>
              </div>
              <i className={`fas fa-chevron-right text-[10px] transition-transform ${selectedRelease.name === release.name ? 'translate-x-1' : 'opacity-0 group-hover:opacity-100'}`}></i>
            </button>
          ))}
        </div>

        <div className="p-6 border-t border-slate-100 bg-slate-50/50">
          <a 
            href="https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&type=5" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center justify-center space-x-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:text-[#2E2E38] transition-colors"
          >
            <span>Full Archive</span>
            <i className="fas fa-external-link-alt"></i>
          </a>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto bg-slate-50">
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedRelease.name}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="p-12 max-w-5xl mx-auto"
          >
            {/* Header */}
            <div className="flex justify-between items-end mb-8">
              <div>
                <h2 className="text-5xl font-black text-slate-900 tracking-tight mb-4">{selectedRelease.name}</h2>
                <div className="flex items-center space-x-4">
                  <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold uppercase tracking-widest rounded-full">Major Release</span>
                  <span className="text-sm font-medium text-slate-500 italic">Released {selectedRelease.date}</span>
                </div>
              </div>
              <a 
                href={selectedRelease.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="px-6 py-3 bg-white border border-slate-200 text-slate-700 text-xs font-bold uppercase tracking-widest rounded-full hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm flex items-center space-x-2"
              >
                <span>Full Release Notes</span>
                <i className="fas fa-external-link-alt"></i>
              </a>
            </div>

            {/* Search Bar */}
            <div className="mb-8 relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <i className="fas fa-search text-slate-400"></i>
              </div>
              <input
                type="text"
                placeholder={`Search ${selectedRelease.changes.length} updates in ${selectedRelease.name}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-4 bg-white border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm transition-all"
              />
            </div>

            {/* Changes List */}
            <div className="space-y-6">
              {filteredChanges.length > 0 ? (
                filteredChanges.map((change, index) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    key={index} 
                    className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm hover:shadow-md transition-shadow group relative overflow-hidden"
                  >
                    <div className="absolute top-0 left-0 w-1 h-full bg-[#FFE600]/100 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <div className="flex items-start space-x-6">
                      <div className="w-12 h-12 bg-[#FFE600]/10 rounded-2xl flex items-center justify-center flex-shrink-0 text-[#2E2E38]">
                        <i className="fas fa-rocket"></i>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-slate-900 mb-3 pr-12">{change.title}</h3>
                        <p className="text-slate-600 leading-relaxed text-sm">{change.summary}</p>
                        
                        <div className="mt-6 pt-6 border-t border-slate-50 flex items-center justify-between">
                          <a 
                            href={change.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-xs font-bold text-[#2E2E38] uppercase tracking-widest hover:text-blue-800 flex items-center space-x-2"
                          >
                            <i className="fas fa-link"></i>
                            <span>View Documentation</span>
                            <i className="fas fa-arrow-right ml-1 opacity-0 group-hover:opacity-100 transition-opacity translate-x-[-10px] group-hover:translate-x-0"></i>
                          </a>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="p-12 text-center bg-white rounded-[32px] border border-slate-100 shadow-sm">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i className="fas fa-search text-2xl text-slate-300"></i>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">No updates found</h3>
                  <p className="text-slate-500">No release notes match your search "{searchQuery}".</p>
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="mt-4 text-[#2E2E38] font-semibold hover:text-blue-700 text-sm"
                  >
                    Clear search
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default ReleaseNotes;
