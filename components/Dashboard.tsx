import React, { useEffect, useState } from "react";
import { useNotifications } from "../src/contexts/NotificationContext";
import { SalesforceOrgData } from "../types";
import { analyzeOrg, OrgAnalysisResult } from "../utils/orgAnalyzer";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LabelList,
} from "recharts";

interface DashboardProps {
  orgData: SalesforceOrgData;
  isSyncing?: boolean;
}

const Gauge = ({
  value = 0,
  label,
  colorClass,
  strokeColor,
}: {
  value: number;
  label: string;
  colorClass: string;
  strokeColor: string;
}) => {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - ((value || 0) / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-20 h-20">
        <svg
          className="w-full h-full transform -rotate-90"
          viewBox="0 0 100 100"
        >
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="transparent"
            stroke="#f1f5f9"
            strokeWidth="8"
          />
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="transparent"
            stroke={strokeColor}
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-lg font-semibold ${colorClass}`}>{value || 0}</span>
        </div>
      </div>
      <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 mt-2 text-center">
        {label}
      </span>
    </div>
  );
};

const Dashboard: React.FC<DashboardProps> = ({ orgData, isSyncing }) => {
  const { addNotification } = useNotifications();
  const [analysis, setAnalysis] = useState<OrgAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedSeverity, setSelectedSeverity] = useState<"Critical" | "Medium" | "Low" | null>(null);
  const [activeModal, setActiveModal] = useState<"Overall" | "Security" | "Metadata" | "Improvement" | null>(null);
  const [selectedImprovement, setSelectedImprovement] = useState<string | null>(null);

  const getImprovementDetails = (recommendation: string) => {
    const lower = recommendation.toLowerCase();
    if (lower.includes("system.debug")) {
      return { time: "2–4 hours", title: "Remove System.debug statements", impact: ["Unnecessary log clutter", "Potential exposure of sensitive data in logs", "Slight performance degradation"] };
    } else if (lower.includes("sharing")) {
      return { time: "1–2 days", title: "Enforce Sharing Rules", impact: ["Possible unauthorized data access", "Security vulnerabilities", "Failing security audits"] };
    } else if (lower.includes("crud") || lower.includes("fls")) {
      return { time: "3–5 days", title: "Implement CRUD/FLS Checks", impact: ["Data exposure risks", "Unauthorized record access", "Security compliance issues"] };
    } else if (lower.includes("test class")) {
      return { time: "2–4 days", title: "Add Missing Test Classes", impact: ["Cannot deploy to production", "Undetected bugs", "Lower code coverage"] };
    } else if (lower.includes("hardcoded id")) {
      return { time: "4–8 hours", title: "Remove Hardcoded IDs", impact: ["Deployment failures across environments", "Maintenance overhead", "Brittle code"] };
    } else if (lower.includes("security_enforced") || lower.includes("security enforced")) {
      return { time: "1–3 days", title: "Enforce SOQL Security", impact: ["Data exposure risks", "Unauthorized record access", "Security compliance issues"] };
    } else if (lower.includes("loop")) {
      return { time: "2–3 days", title: "Bulkify Apex Code", impact: ["Governor limit exceptions", "Poor performance", "Unscalable code"] };
    } else if (lower.includes("unused")) {
      return { time: "1–2 weeks", title: "Remove Unused Metadata", impact: ["Cluttered codebase", "Confusion for developers", "Approaching org limits"] };
    } else {
      return { time: "2–4 days", title: "Code Improvement", impact: ["Higher technical debt", "Poor maintainability", "Slower development cycles"] };
    }
  };

  useEffect(() => {
    if (isSyncing) return;

    const fetchOrAnalyze = async () => {
      setIsAnalyzing(true);
      try {
        // Try to fetch from backend
        const res = await fetch(`/api/metadata/${orgData.orgId}/analysis`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.technicalDebtBreakdown) {
            setAnalysis(data);
            setIsAnalyzing(false);
            return;
          }
        }

        // If not found, analyze and save
        const result = analyzeOrg(orgData);
        setAnalysis(result);

        const saveRes = await fetch(`/api/metadata/${orgData.orgId}/analysis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        });

        if (!saveRes.ok) {
          const errorData = await saveRes.json();
          if (errorData.isQuotaExceeded) {
            addNotification(
              "Firestore Quota Exceeded",
              errorData.message,
              "error"
            );
          }
        }
      } catch (e) {
        console.error("Failed to fetch or save analysis", e);
        // Fallback to local analysis
        setAnalysis(analyzeOrg(orgData));
      } finally {
        setIsAnalyzing(false);
      }
    };

    fetchOrAnalyze();
  }, [orgData, isSyncing]);

  const metadataOverview = [
    { name: "Objects", count: orgData.objects.length, fill: "#3b82f6" },
    { name: "Flows", count: orgData.flows.length, fill: "#10b981" },
    { name: "Apex", count: orgData.classes.length, fill: "#6366f1" },
    { name: "Dashboards", count: orgData.dashboards.length, fill: "#f43f5e" },
  ].filter((item) => item.count > 0);

  const flowDistribution = orgData.syncedCategories.flows
    ? [
        {
          name: "Active",
          value: orgData.flows.filter((f) => f.status === "Active").length,
        },
        {
          name: "Inactive",
          value: orgData.flows.filter(
            (f) => f.status === "Inactive" || f.status === "Obsolete",
          ).length,
        },
        {
          name: "Draft",
          value: orgData.flows.filter((f) => f.status === "Draft").length,
        },
      ]
    : [];

  const PIE_COLORS = ["#10b981", "#f43f5e", "#f59e0b"];

  const getGradeColor = (grade: string | undefined) => {
    if (!grade) return "text-slate-500 bg-slate-50 border-slate-200";
    if (grade.startsWith("A"))
      return "text-emerald-500 bg-emerald-50 border-emerald-200";
    if (grade.startsWith("B"))
      return "text-[#2E2E38] bg-[#FFE600]/10 border-[#FFE600]/30";
    if (grade.startsWith("C"))
      return "text-yellow-500 bg-yellow-50 border-yellow-200";
    if (grade.startsWith("D"))
      return "text-orange-500 bg-orange-50 border-orange-200";
    return "text-red-500 bg-red-50 border-red-200";
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Welcome Hero */}
      <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm overflow-hidden relative">
        <div className="absolute top-0 right-0 p-8 opacity-[0.03] rotate-12">
          <i className="fas fa-rocket text-[12rem]"></i>
        </div>
        <div className="relative z-10">
          <div className="flex items-center space-x-3 mb-2">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.2em]">
              Connection Established
            </span>
          </div>
          <h2 className="text-3xl font-semibold text-slate-800 tracking-tight">
            System Overview: {orgData.orgName}
          </h2>
          <p className="text-slate-500 font-medium mt-1 italic">
            AI Powered Metadata Assist has indexed your{" "}
            <span className="text-[#2E2E38] font-semibold">{orgData.instance}</span>{" "}
            node.
          </p>
        </div>
      </div>

      {/* Org Health Dashboard */}
      {analysis && (
        <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center space-x-4">
              <div>
                <h3 className="text-xl font-semibold text-slate-800 tracking-tight">
                  Org Health Score
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Automated analysis of metadata and code quality
                </p>
              </div>
              <button
                onClick={async () => {
                  setIsAnalyzing(true);
                  try {
                    // Clear existing analysis
                    await fetch(`/api/metadata/${orgData.orgId}/analysis`, {
                      method: "DELETE",
                    });

                    // Re-analyze
                    const result = analyzeOrg(orgData);
                    setAnalysis(result);

                    // Save new analysis
                    const saveRes = await fetch(`/api/metadata/${orgData.orgId}/analysis`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(result),
                    });

                    if (!saveRes.ok) {
                      const errorData = await saveRes.json();
                      if (errorData.isQuotaExceeded) {
                        addNotification(
                          "Firestore Quota Exceeded",
                          errorData.message,
                          "error"
                        );
                      }
                    }
                  } catch (e) {
                    console.error("Re-scan failed", e);
                  } finally {
                    setIsAnalyzing(false);
                  }
                }}
                disabled={isAnalyzing}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[10px] font-semibold uppercase tracking-widest transition-all flex items-center space-x-2"
              >
                <i className={`fas fa-sync-alt ${isAnalyzing ? 'animate-spin' : ''}`}></i>
                <span>{isAnalyzing ? 'Analyzing...' : 'Re-scan Org Health'}</span>
              </button>
            </div>
            <div
              className={`px-6 py-3 rounded-2xl border ${getGradeColor(analysis.grade)} flex items-center space-x-3`}
            >
              <div className="flex items-center space-x-2">
                <span className="text-xs font-semibold uppercase tracking-widest opacity-80">
                  Grade
                </span>
                <div className="group relative">
                  <i className="fas fa-info-circle text-[10px] cursor-help opacity-50 hover:opacity-100 transition-opacity"></i>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-3 bg-[#2E2E38] text-white text-[10px] rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
                    <p className="font-bold mb-1 border-b border-white/10 pb-1 uppercase tracking-widest">Grading Scale</p>
                    <div className="space-y-1 font-medium">
                      <div className="flex justify-between"><span>A (Excellent)</span><span className="text-emerald-400">90-100</span></div>
                      <div className="flex justify-between"><span>B (Good)</span><span className="text-[#FFE600]">80-89</span></div>
                      <div className="flex justify-between"><span>C (Fair)</span><span className="text-yellow-400">70-79</span></div>
                      <div className="flex justify-between"><span>D (Poor)</span><span className="text-orange-400">60-69</span></div>
                      <div className="flex justify-between"><span>F (Critical)</span><span className="text-red-400">0-59</span></div>
                    </div>
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900"></div>
                  </div>
                </div>
              </div>
              <span className="text-3xl font-semibold">{analysis.grade || 'N/A'}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
            <div 
              className="flex flex-col items-center justify-center p-6 bg-slate-50 rounded-3xl border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors"
              onClick={() => setActiveModal('Metadata')}
            >
              <div className="flex space-x-4 mb-2">
                <div className="text-center">
                  <p className="text-2xl font-bold text-emerald-600">{orgData.objects.length + orgData.classes.length + orgData.triggers.length + orgData.flows.length + orgData.dashboards.length - new Set(analysis.issues.map(i => i.metadataName)).size}</p>
                  <p className="text-[8px] font-bold text-emerald-500 uppercase tracking-widest">Pass</p>
                </div>
                <div className="w-px h-8 bg-slate-200 self-center"></div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-rose-600">{new Set(analysis.issues.map(i => i.metadataName)).size}</p>
                  <p className="text-[8px] font-bold text-rose-500 uppercase tracking-widest">Fail</p>
                </div>
              </div>
              <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 text-center">
                Metadata Health
              </span>
            </div>
            <div 
              className="flex items-center justify-center p-6 bg-slate-50 rounded-3xl border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors"
              onClick={() => setActiveModal('Overall')}
            >
              <Gauge
                value={analysis.score}
                label="Overall Score"
                colorClass="text-[#2E2E38]"
                strokeColor="#2563eb"
              />
            </div>
            <div 
              className="flex items-center justify-center p-6 bg-slate-50 rounded-3xl border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors"
              onClick={() => setActiveModal('Security')}
            >
              <Gauge
                value={analysis.securityScore}
                label="Security"
                colorClass="text-emerald-600"
                strokeColor="#10b981"
              />
            </div>
            <div
              className="flex flex-col items-center justify-center p-6 bg-slate-50 rounded-3xl border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors text-center"
              onClick={() => setActiveModal('TechDebt')}
            >
              <p className="text-3xl font-bold text-amber-600 mb-1">{analysis.technicalDebtRatio}%</p>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Tech Debt Ratio</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 mb-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div 
                className={`bg-red-50 border p-6 rounded-2xl flex items-center justify-between cursor-pointer transition-all ${selectedSeverity === 'Critical' ? 'border-red-500 ring-2 ring-red-200' : 'border-red-100 hover:bg-red-100'}`}
                onClick={() => setSelectedSeverity(selectedSeverity === 'Critical' ? null : 'Critical')}
              >
                <div>
                  <p className="text-[10px] font-semibold text-red-500 uppercase tracking-widest mb-1">
                    Critical Issues
                  </p>
                  <p className="text-2xl font-semibold text-red-700">
                    {analysis.criticalIssues || 0}
                  </p>
                </div>
                <div className="w-10 h-10 bg-red-100 text-red-500 rounded-xl flex items-center justify-center">
                  <i className="fas fa-exclamation-triangle"></i>
                </div>
              </div>
              <div 
                className={`bg-orange-50 border p-6 rounded-2xl flex items-center justify-between cursor-pointer transition-all ${selectedSeverity === 'Medium' ? 'border-orange-500 ring-2 ring-orange-200' : 'border-orange-100 hover:bg-orange-100'}`}
                onClick={() => setSelectedSeverity(selectedSeverity === 'Medium' ? null : 'Medium')}
              >
                <div>
                  <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-widest mb-1">
                    Medium Issues
                  </p>
                  <p className="text-2xl font-semibold text-orange-700">
                    {analysis.mediumIssues || 0}
                  </p>
                </div>
                <div className="w-10 h-10 bg-orange-100 text-orange-500 rounded-xl flex items-center justify-center">
                  <i className="fas fa-exclamation-circle"></i>
                </div>
              </div>
              <div 
                className={`bg-[#FFE600]/10 border p-6 rounded-2xl flex items-center justify-between cursor-pointer transition-all ${selectedSeverity === 'Low' ? 'border-[#FFE600]/30 ring-2 ring-blue-200' : 'border-[#FFE600]/30 hover:bg-blue-100'}`}
                onClick={() => setSelectedSeverity(selectedSeverity === 'Low' ? null : 'Low')}
              >
                <div>
                  <p className="text-[10px] font-semibold text-[#2E2E38] uppercase tracking-widest mb-1">
                    Low Issues
                  </p>
                  <p className="text-2xl font-semibold text-blue-700">
                    {analysis.lowIssues || 0}
                  </p>
                </div>
                <div className="w-10 h-10 bg-blue-100 text-[#2E2E38] rounded-xl flex items-center justify-center">
                  <i className="fas fa-info-circle"></i>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <h4 className="text-sm font-semibold text-slate-800 uppercase tracking-widest mb-4 flex items-center">
                <i className={`fas ${selectedSeverity === 'Critical' ? 'fa-exclamation-triangle text-red-500' : selectedSeverity === 'Medium' ? 'fa-exclamation-circle text-orange-500' : selectedSeverity === 'Low' ? 'fa-info-circle text-[#2E2E38]' : 'fa-list text-slate-500'} mr-2`}></i>
                {selectedSeverity ? `${selectedSeverity} Issues` : 'All Issues'}
              </h4>
              <div className="space-y-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                {(analysis.issues || [])
                  .filter((i) => !selectedSeverity || i.type === selectedSeverity)
                  .length > 0 ? (
                  (analysis.issues || [])
                    .filter((i) => !selectedSeverity || i.type === selectedSeverity)
                    .map((issue, idx) => (
                      <div
                        key={idx}
                        className={`p-4 bg-white border rounded-2xl shadow-sm ${issue.type === 'Critical' ? 'border-red-100' : issue.type === 'Medium' ? 'border-orange-100' : 'border-[#FFE600]/30'}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-[9px] font-semibold px-2 py-1 rounded uppercase tracking-widest ${issue.type === 'Critical' ? 'text-red-600 bg-red-50' : issue.type === 'Medium' ? 'text-orange-600 bg-orange-50' : 'text-[#2E2E38] bg-[#FFE600]/10'}`}>
                            {issue.category}
                          </span>
                          <span className="text-[10px] font-semibold text-slate-500">
                            {issue.metadataName}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-slate-800 mb-2">
                          {issue.description}
                        </p>
                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">
                            Recommendation
                          </p>
                          <p className="text-xs text-slate-600">
                            {issue.recommendation}
                          </p>
                        </div>
                      </div>
                    ))
                ) : (
                  <div className="p-6 text-center bg-slate-50 rounded-2xl border border-slate-100">
                    <i className="fas fa-check-circle text-emerald-500 text-2xl mb-2"></i>
                    <p className="text-xs font-semibold text-slate-600">
                      No {selectedSeverity ? selectedSeverity.toLowerCase() : ''} issues found!
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-slate-800 uppercase tracking-widest mb-4 flex items-center">
                <i className="fas fa-lightbulb text-amber-500 mr-2"></i>
                Improvement Recommendations
              </h4>
              <div className="space-y-3">
                {(analysis.recommendations || []).length > 0 ? (
                  (analysis.recommendations || []).slice(0, 5).map((rec, idx) => (
                    <div
                      key={idx}
                      className="flex items-start space-x-3 p-4 bg-amber-50/30 border border-amber-100/50 rounded-2xl cursor-pointer hover:bg-amber-50 transition-colors"
                      onClick={() => {
                        setSelectedImprovement(rec);
                        setActiveModal('Improvement');
                      }}
                    >
                      <div className="w-6 h-6 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[10px] font-semibold">
                          {idx + 1}
                        </span>
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-medium text-slate-700 leading-relaxed mb-1">
                          {rec}
                        </p>
                        <p className="text-[10px] font-semibold text-amber-600 flex items-center">
                          <i className="far fa-clock mr-1"></i> Estimated Fix Time: {getImprovementDetails(rec).time}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-6 text-center bg-slate-50 rounded-2xl border border-slate-100">
                    <i className="fas fa-star text-amber-400 text-2xl mb-2"></i>
                    <p className="text-xs font-semibold text-slate-600">
                      Your org is in great shape!
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {activeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2E2E38]/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-slate-100 p-6 flex items-center justify-between z-10">
              <div>
                <h3 className="text-xl font-bold text-slate-800">
                  {activeModal === 'Security' && 'Security Score Explanation'}
                  {activeModal === 'Overall' && 'Overall Score Explanation'}
                  {activeModal === 'Metadata' && 'Metadata Health Explanation'}
                  {activeModal === 'Improvement' && 'Improvement Details'}
                  {activeModal === 'TechDebt' && 'Technical Debt Explanation'}
                </h3>
                {activeModal === 'Security' && <p className="text-sm font-semibold text-slate-500 mt-1">Security Score: {analysis?.securityScore} / 100</p>}
                {activeModal === 'Overall' && <p className="text-sm font-semibold text-slate-500 mt-1">Overall Score: {analysis?.score} / 100</p>}
                {activeModal === 'TechDebt' && <p className="text-sm font-semibold text-slate-500 mt-1">Tech Debt Ratio (TDR): {analysis?.technicalDebtRatio}% | Cost: ${analysis?.remediationCost?.toLocaleString()}</p>}
              </div>
              <button onClick={() => { setActiveModal(null); setSelectedImprovement(null); }} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors">
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="p-6 space-y-6">
              {activeModal === 'Security' && analysis && (
                <div>
                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3">Why this score was given</h4>
                  <p className="text-sm text-slate-600 mb-4">The security score evaluates your org's adherence to Salesforce security best practices, focusing on data access and record-level security.</p>
                  
                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3">Detected Issues</h4>
                  <ul className="list-disc pl-5 space-y-2 text-sm text-slate-600 mb-6">
                    {analysis.issues.filter(i => i.description.includes("sharing") || i.description.includes("CRUD") || i.description.includes("security_enforced") || i.description.includes("FLS")).map((issue, idx) => (
                      <li key={idx}><span className="font-semibold">{issue.metadataName}</span>: {issue.description}</li>
                    ))}
                    {analysis.issues.filter(i => i.description.includes("sharing") || i.description.includes("CRUD") || i.description.includes("security_enforced") || i.description.includes("FLS")).length === 0 && (
                      <li>No security issues detected!</li>
                    )}
                  </ul>

                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3">Score Calculation</h4>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-6">
                    <p className="text-sm text-slate-700 font-semibold mb-2">Start Score: 100</p>
                    <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">Deductions:</p>
                    <ul className="space-y-1 text-sm text-slate-600">
                      <li>Security rules missing ("sharing" or "CRUD") &rarr; -0.25 points each</li>
                    </ul>
                  </div>

                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3">Impact if Not Fixed</h4>
                  <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
                    <li>Data exposure risks</li>
                    <li>Unauthorized record access</li>
                    <li>Security compliance issues</li>
                    <li>Potential audit failures</li>
                  </ul>
                </div>
              )}

              {activeModal === 'Overall' && analysis && (
                <div>
                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3">Score Breakdown</h4>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Critical Issues</p>
                      <p className="text-2xl font-bold text-red-600">{analysis.criticalIssues}</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Medium Issues</p>
                      <p className="text-2xl font-bold text-orange-600">{analysis.mediumIssues}</p>
                    </div>
                  </div>

                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3">Calculation Logic</h4>
                  <p className="text-sm text-slate-600 mb-2">Overall Score is calculated based on deductions from 100:</p>
                  <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600 mb-4">
                    <li>Critical Issues &rarr; -0.15 points each (max -50)</li>
                    <li>Medium Issues &rarr; -0.1 points each (max -30)</li>
                    <li>Low Issues &rarr; -0.01 points each (max -20)</li>
                  </ul>
                  <div className="bg-[#FFE600]/10 p-4 rounded-2xl border border-[#FFE600]/30 text-blue-800 font-mono text-sm">
                    Score = 100 - (Critical &times; 0.15) - (Medium &times; 0.1) - (Low &times; 0.01)
                  </div>
                </div>
              )}

              {activeModal === 'TechDebt' && analysis && (
                <div>
                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3">Technical Debt Breakdown</h4>
                  <p className="text-sm text-slate-600 mb-4">Technical debt evaluates the remediation cost (time and money required) to fix structural issues and calculates the Technical Debt Ratio (TDR) representing code health.</p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Estimated Hours</p>
                      <p className="text-2xl font-bold text-amber-600">{analysis.technicalDebtScore} <span className="text-xs text-slate-400">hrs</span></p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Remediation Cost</p>
                      <p className="text-2xl font-bold text-amber-600">${analysis.remediationCost?.toLocaleString()}</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">TDR Percentage</p>
                      <p className="text-2xl font-bold text-amber-600">{analysis.technicalDebtRatio}%</p>
                    </div>
                  </div>

                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3">Issue Breakdown</h4>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex justify-between items-center">
                      <p className="text-xs text-slate-500 font-semibold mb-1">Apex Violations</p>
                      <p className="text-lg font-bold text-amber-600">{analysis.technicalDebtBreakdown?.apexViolations || 0}</p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex justify-between items-center">
                      <p className="text-xs text-slate-500 font-semibold mb-1">Security Issues</p>
                      <p className="text-lg font-bold text-amber-600">{analysis.technicalDebtBreakdown?.securityIssues || 0}</p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex justify-between items-center">
                      <p className="text-xs text-slate-500 font-semibold mb-1">Flow Complexity</p>
                      <p className="text-lg font-bold text-amber-600">{analysis.technicalDebtBreakdown?.flowComplexity || 0}</p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex justify-between items-center">
                      <p className="text-xs text-slate-500 font-semibold mb-1">Unused Metadata</p>
                      <p className="text-lg font-bold text-amber-600">{analysis.technicalDebtBreakdown?.unusedMetadata || 0}</p>
                    </div>
                  </div>

                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3">Calculation Logic</h4>
                  <p className="text-sm text-slate-600 mb-2 font-semibold">1. Remediation Cost (The "Principal")</p>
                  <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600 mb-4">
                    <li>Apex Violations &rarr; 5 hours each</li>
                    <li>Security Issues &rarr; 4 hours each</li>
                    <li>Flow Complexity &rarr; 3 hours each</li>
                    <li>Unused Metadata &rarr; 2 hours each</li>
                    <li>Assumed Developer Rate &rarr; $100/hour</li>
                  </ul>
                  
                  <p className="text-sm text-slate-600 mb-2 font-semibold">2. Technical Debt Ratio (TDR)</p>
                  <p className="text-sm text-slate-600 mb-4">Compares the cost of fixing the debt against the total estimated cost of developing the software. An acceptable TDR is generally ~5%.</p>

                  <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 text-amber-800 font-mono text-sm break-all">
                    Remediation Cost = Estimated Hours &times; Developer Rate<br/>
                    TDR = (Remediation Cost / Total Dev Cost) &times; 100%
                  </div>
                </div>
              )}

              {activeModal === 'Metadata' && analysis && (
                <div>
                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3">Metadata Health Summary</h4>
                  <div className="flex space-x-8 mb-6">
                    <div>
                      <p className="text-3xl font-bold text-emerald-600">{orgData.objects.length + orgData.classes.length + orgData.triggers.length + orgData.flows.length + orgData.dashboards.length - new Set(analysis.issues.map(i => i.metadataName)).size}</p>
                      <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Passed Checks</p>
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-rose-600">{new Set(analysis.issues.map(i => i.metadataName)).size}</p>
                      <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">Failed Checks</p>
                    </div>
                  </div>

                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3">Examples of failures</h4>
                  <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600 mb-6">
                    <li>System.debug statements in production code</li>
                    <li>Missing sharing keywords</li>
                    <li>Missing CRUD/FLS checks</li>
                    <li>Hardcoded IDs</li>
                    <li>Missing test classes</li>
                  </ul>

                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3">Impact if Not Fixed</h4>
                  <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
                    <li>Higher technical debt</li>
                    <li>Poor maintainability</li>
                    <li>Slower development cycles</li>
                    <li>Production performance issues</li>
                  </ul>
                </div>
              )}

              {activeModal === 'Improvement' && selectedImprovement && analysis && (() => {
                const details = getImprovementDetails(selectedImprovement);
                const relatedIssues = analysis.issues.filter(i => i.recommendation === selectedImprovement);
                const issue = relatedIssues[0]; // Show the first one or list them

                return (
                  <div>
                    <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 mb-6">
                      <h4 className="text-sm font-bold text-amber-800 uppercase tracking-widest mb-1">Improvement Title</h4>
                      <p className="text-lg font-semibold text-amber-900">{details.title}</p>
                    </div>

                    <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3">Affected Components</h4>
                    <div className="space-y-3 mb-6 max-h-48 overflow-y-auto custom-scrollbar pr-2">
                      {relatedIssues.map((iss, idx) => (
                        <div key={idx} className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex justify-between items-center">
                          <div>
                            <p className="text-xs font-bold text-slate-800">{iss.metadataName}</p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest">{iss.category}</p>
                          </div>
                          <span className={`text-[10px] font-semibold px-2 py-1 rounded uppercase tracking-widest ${iss.type === 'Critical' ? 'text-red-600 bg-red-50' : iss.type === 'Medium' ? 'text-orange-600 bg-orange-50' : 'text-[#2E2E38] bg-[#FFE600]/10'}`}>
                            {iss.type}
                          </span>
                        </div>
                      ))}
                      {relatedIssues.length === 0 && (
                        <p className="text-sm text-slate-500 italic">No specific components linked to this recommendation.</p>
                      )}
                    </div>

                    <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3">Problem Description</h4>
                    <p className="text-sm text-slate-600 mb-6">{issue?.description || 'General improvement recommendation.'}</p>

                    <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3">Suggested Fix</h4>
                    <p className="text-sm text-slate-600 mb-6">{selectedImprovement}</p>

                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Estimated Fix Time</p>
                        <p className="text-lg font-semibold text-slate-800 flex items-center">
                          <i className="far fa-clock text-slate-400 mr-2"></i>
                          {details.time}
                        </p>
                      </div>
                    </div>

                    <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3">Impact if not fixed</h4>
                    <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
                      {details.impact.map((imp, idx) => (
                        <li key={idx}>{imp}</li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Dashboard;
