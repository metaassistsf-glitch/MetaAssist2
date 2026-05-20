import { GitHubPullRequest, GitHubFile } from '../types';

export class GitHubService {
  private token: string;
  private owner: string;
  private repo: string;
  private baseUrl = 'https://api.github.com';

  constructor(token: string, owner: string, repo: string) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
  }

  private get headers() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async getOpenPRs(): Promise<GitHubPullRequest[]> {
    const res = await fetch(`${this.baseUrl}/repos/${this.owner}/${this.repo}/pulls?state=open`, {
      headers: this.headers
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch PRs: ${res.statusText}`);
    }
    return res.json();
  }

  async getPRFiles(prNumber: number): Promise<GitHubFile[]> {
    const res = await fetch(`${this.baseUrl}/repos/${this.owner}/${this.repo}/pulls/${prNumber}/files`, {
      headers: this.headers
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch PR files: ${res.statusText}`);
    }
    return res.json();
  }

  async submitPRReview(prNumber: number, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string, comments: any[]): Promise<any> {
    const res = await fetch(`${this.baseUrl}/repos/${this.owner}/${this.repo}/pulls/${prNumber}/reviews`, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        body,
        event,
        comments
      })
    });
    
    if (!res.ok) {
        const err = await res.text();
      throw new Error(`Failed to submit review: ${res.statusText}. ${err}`);
    }
    return res.json();
  }
}
