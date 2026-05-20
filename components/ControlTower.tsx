import React, { useState, useEffect } from 'react';
import { GitHubPullRequest, GitHubFile, PRReviewResult } from '../types';
import { GitHubService } from '../services/githubService';
import { reviewPRDiff } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';

export default function ControlTower() {
  const [token, setToken] = useState('');
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [prs, setPrs] = useState<GitHubPullRequest[]>([]);
  const [selectedPr, setSelectedPr] = useState<GitHubPullRequest | null>(null);
  const [files, setFiles] = useState<GitHubFile[]>([]);
  const [reviewResults, setReviewResults] = useState<PRReviewResult[]>([]);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedToken = localStorage.getItem('github_token');
    const savedOwner = localStorage.getItem('github_owner');
    const savedRepo = localStorage.getItem('github_repo');
    if (savedToken && savedOwner && savedRepo) {
      setToken(savedToken);
      setOwner(savedOwner);
      setRepo(savedRepo);
      setIsConfigured(true);
    }
  }, []);

  const handleSaveConfig = () => {
    localStorage.setItem('github_token', token);
    localStorage.setItem('github_owner', owner);
    localStorage.setItem('github_repo', repo);
    setIsConfigured(true);
    fetchPRs();
  };

  const fetchPRs = async () => {
    setLoading(true);
    setError(null);
    try {
      const gh = new GitHubService(token, owner, repo);
      const openPrs = await gh.getOpenPRs();
      setPrs(openPrs);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isConfigured) {
      fetchPRs();
    }
  }, [isConfigured]);

  const handleSelectPR = async (pr: GitHubPullRequest) => {
    setSelectedPr(pr);
    setFiles([]);
    setReviewResults([]);
    setLoading(true);
    setError(null);
    try {
      const gh = new GitHubService(token, owner, repo);
      const prFiles = await gh.getPRFiles(pr.number);
      setFiles(prFiles);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReviewFiles = async () => {
    if (!files.length) return;
    setIsReviewing(true);
    setError(null);
    try {
      const diffs = files.filter(f => f.patch).map(f => ({
        filename: f.filename,
        patch: f.patch
      }));
      if (diffs.length === 0) {
        throw new Error("No code changes found in this PR to review.");
      }
      const results = await reviewPRDiff(diffs);
      setReviewResults(results);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsReviewing(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!selectedPr || !reviewResults.length) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const gh = new GitHubService(token, owner, repo);
      
      const hasShowStopper = reviewResults.some(r => r.isShowStopper);
      const eventInfo = hasShowStopper ? 'REQUEST_CHANGES' : 'COMMENT';
      
      let bodyString = `## AI Code Review via MetaAssist Control Tower\n\n`;
      if (hasShowStopper) {
        bodyString += `**Status: ❌ Changes Requested**\nCrucial issues were identified that must be resolved before merging.\n\n`;
      } else {
        bodyString += `**Status: ⚠️ Findings**\nReview the following findings.\n\n`;
      }

      reviewResults.forEach(r => {
        bodyString += `### ${r.file}\n`;
        if (r.isShowStopper) bodyString += `**🚨 SHOWSTOPPER IDENTIFIED**\n`;
        bodyString += `- **Issues:** ${r.issues.join(', ')}\n`;
        bodyString += `- **Comments:** ${r.comments.join(' ')}\n\n`;
      });

      await gh.submitPRReview(selectedPr.number, eventInfo, bodyString, []);
      alert(`Review submitted successfully as ${eventInfo}!`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isConfigured) {
    return (
      <div className="h-full flex flex-col p-8 bg-slate-50">
        <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-4 mb-6 flex items-start space-x-3 shadow-sm max-w-lg">
          <i className="fas fa-info-circle mt-0.5 text-blue-500 text-lg"></i>
          <div>
            <h4 className="text-sm font-bold">Build in Progress</h4>
            <p className="text-xs mt-1 font-medium">This functionality is currently being built and will be released by the first week of July.</p>
          </div>
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-6 font-space">Control Tower Setup</h2>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm max-w-lg space-y-4">
          <p className="text-sm text-slate-600 mb-4">Enter your GitHub organization/repository and a Personal Access Token to connect the Control Tower.</p>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-2">GitHub Token (PAT)</label>
            <input type="password" value={token} onChange={e => setToken(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFE600] transition-shadow" placeholder="ghp_..." />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-2">Repository Owner</label>
            <input type="text" value={owner} onChange={e => setOwner(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFE600] transition-shadow" placeholder="e.g., myorg" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-2">Repository Name</label>
            <input type="text" value={repo} onChange={e => setRepo(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFE600] transition-shadow" placeholder="e.g., salesforce-app" />
          </div>
          <button onClick={handleSaveConfig} className="w-full bg-[#FFE600] text-[#2E2E38] font-bold text-sm tracking-wide rounded-xl px-4 py-3 hover:bg-[#F2DA00] transition-colors mt-4">
            Connect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-8 bg-slate-50 overflow-hidden">
      <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-4 mb-6 flex items-start space-x-3 shadow-sm shrink-0">
        <i className="fas fa-info-circle mt-0.5 text-blue-500 text-lg"></i>
        <div>
          <h4 className="text-sm font-bold">Build in Progress</h4>
          <p className="text-xs mt-1 font-medium">This functionality is currently being built and will be released by the first week of July.</p>
        </div>
      </div>
      <div className="flex items-center justify-between mb-8 shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 font-space tracking-tight">Control Tower</h2>
          <p className="text-sm font-medium text-slate-500 mt-1">Review GitHub PRs for PMD and Best Practices</p>
        </div>
        <div className="flex items-center space-x-4">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest border border-slate-200 py-1.5 px-3 rounded-lg bg-white shadow-sm">
            <i className="fab fa-github mr-2"></i>
            {owner}/{repo}
          </p>
          <button onClick={() => setIsConfigured(false)} className="text-xs font-bold text-slate-500 uppercase tracking-widest hover:text-slate-800 transition-colors">
            Configure
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl mb-6 text-sm font-medium">
          <i className="fas fa-exclamation-triangle mr-2"></i> {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden space-x-6">
        {/* PR List */}
        <div className="w-1/3 flex flex-col bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest">Open PRs</h3>
            <button onClick={fetchPRs} disabled={loading} className="text-slate-400 hover:text-[#FFE600] transition-colors">
              <i className={`fas fa-sync-alt ${loading ? 'animate-spin' : ''}`}></i>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {prs.length === 0 && !loading && (
              <p className="text-sm text-slate-500 text-center py-8">No open PRs found.</p>
            )}
            {prs.map(pr => (
              <button 
                key={pr.id} 
                onClick={() => handleSelectPR(pr)}
                className={`w-full text-left p-4 rounded-xl border transition-all ${selectedPr?.id === pr.id ? 'border-[#FFE600] bg-[#FFE600]/10 shadow-sm' : 'border-slate-100 hover:border-slate-300 bg-white'}`}
              >
                <div className="flex items-center space-x-3 mb-2">
                  <span className="text-emerald-500"><i className="fas fa-code-branch"></i></span>
                  <span className="text-sm font-bold text-slate-800 break-words flex-1">#{pr.number} {pr.title}</span>
                </div>
                <div className="flex items-center space-x-2 text-xs text-slate-500">
                  <img src={pr.user.avatar_url} alt="author" className="w-5 h-5 rounded-full" />
                  <span>{pr.user.login}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* PR Detail & Analysis */}
        <div className="w-2/3 flex flex-col bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          {!selectedPr ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
              <i className="fas fa-satellite-dish text-4xl mb-4 text-slate-200"></i>
              <p className="text-sm">Select a Pull Request to scan for issues.</p>
            </div>
          ) : (
            <>
              <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 font-space tracking-tight mb-1">{selectedPr.title}</h3>
                  <a href={selectedPr.html_url} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline">
                    View on GitHub <i className="fas fa-external-link-alt text-[10px]"></i>
                  </a>
                </div>
                {!reviewResults.length ? (
                  <button onClick={handleReviewFiles} disabled={isReviewing || loading || files.length === 0} className="bg-slate-900 text-white text-xs font-bold uppercase tracking-widest px-4 py-2.5 rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50 flex items-center">
                    {isReviewing ? <><i className="fas fa-spinner animate-spin mr-2"></i> Scanning</> : <><i className="fas fa-search mr-2"></i> Scan PR</>}
                  </button>
                ) : (
                  <button onClick={handleSubmitReview} disabled={isSubmitting} className="bg-[#FFE600] text-[#2E2E38] text-xs font-bold uppercase tracking-widest px-4 py-2.5 rounded-xl hover:bg-[#F2DA00] transition-colors disabled:opacity-50 flex items-center shadow-sm">
                    {isSubmitting ? <><i className="fas fa-spinner animate-spin mr-2"></i> Submitting</> : <><i className="fab fa-github mr-2"></i> Submit Review</>}
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                {!reviewResults.length ? (
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Changed Files ({files.length})</h4>
                    {files.map(f => (
                      <div key={f.sha} className="flex items-center justify-between p-3 border border-slate-100 rounded-lg text-sm bg-slate-50">
                        <span className="font-mono text-slate-600 truncate mr-4"><i className="fas fa-file-code text-slate-400 mr-2"></i> {f.filename}</span>
                        <div className="flex space-x-3 text-xs font-bold">
                          <span className="text-emerald-500">+{f.additions}</span>
                          <span className="text-rose-500">-{f.deletions}</span>
                        </div>
                      </div>
                    ))}
                    {files.length === 0 && !loading && <p className="text-sm text-slate-500">Checking files...</p>}
                  </div>
                ) : (
                  <div className="space-y-6">
                    <h4 className="flex justify-between items-center text-xs font-bold text-slate-800 uppercase tracking-widest mb-4 pb-2 border-b border-slate-100">
                      <span>Analysis Results</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] ${reviewResults.some(r => r.isShowStopper) ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>
                        {reviewResults.some(r => r.isShowStopper) ? 'CHANGES REQUESTED' : 'READY TO APPROVE'}
                      </span>
                    </h4>
                    {reviewResults.map((r, i) => (
                      <div key={i} className={`p-5 rounded-xl border ${r.isShowStopper ? 'bg-rose-50 border-rose-200' : 'bg-slate-50 border-slate-200'}`}>
                        <h5 className="font-mono text-sm font-bold text-slate-800 mb-3 flex items-center">
                          {r.isShowStopper ? <i className="fas fa-ban text-rose-500 mr-2"></i> : <i className="fas fa-exclamation-circle text-amber-500 mr-2"></i>}
                          {r.file}
                        </h5>
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Issues Found</p>
                            <ul className="list-disc pl-4 text-sm text-slate-700 space-y-1">
                              {r.issues.map((iss, j) => <li key={j}>{iss}</li>)}
                            </ul>
                          </div>
                          <div>
                            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Recommended Comments</p>
                            <div className="bg-white border border-slate-200 p-3 rounded-lg text-sm text-slate-600 prose prose-sm max-w-none">
                              {r.comments.map((c, j) => <p key={j} className="mb-1 last:mb-0"><ReactMarkdown>{c}</ReactMarkdown></p>)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {reviewResults.length === 0 && (
                      <p className="text-emerald-600 text-sm font-bold bg-emerald-50 p-4 rounded-xl border border-emerald-200 text-center shadow-sm">
                        <i className="fas fa-check-circle mr-2 mb-2 text-2xl drop-shadow-sm"></i><br/>
                        No issues or violations found. The code looks solid!
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
