import React, { useState, useRef, useEffect } from 'react';
import { useNotifications } from '../src/contexts/NotificationContext';
import { GoogleGenAI } from "@google/genai";
import * as d3 from 'd3';
import { parseApexLogToTree, CallNode } from '../src/utils/logParser';
import ReactMarkdown from 'react-markdown';

const LogAnalyzer: React.FC = () => {
  const [logContent, setLogContent] = useState<string>('');
  const [analysis, setAnalysis] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { addNotification } = useNotifications();
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContent && chartRef.current) {
      const tree = parseApexLogToTree(logContent);
      renderVisualization(tree);
    }
  }, [logContent]);

  const renderVisualization = (treeData: CallNode) => {
    if (!chartRef.current) return;
    
    d3.select(chartRef.current).selectAll('*').remove();

    const width = chartRef.current.clientWidth;
    const height = 800;
    
    const svg = d3.select(chartRef.current)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', 'translate(60,0)'); // Increased left padding

    const root = d3.hierarchy(treeData) as any;
    root.x0 = height / 2;
    root.y0 = 0;

    // Collapse all nodes except root initially
    if (root.children) {
      root.children.forEach(collapse);
    }

    function collapse(d: any) {
      if (d.children) {
        d._children = d.children;
        d._children.forEach(collapse);
        d.children = null;
      }
    }

    update(root);

    function update(source: any) {
      const treeLayout = d3.tree().size([height, width - 300]); // Adjusted width
      const treeData = treeLayout(root);

      // Compute the new tree layout.
      const nodes = treeData.descendants();
      const links = treeData.links();

      // Normalize for fixed-depth.
      nodes.forEach((d: any) => { d.y = d.depth * 250; }); // Increased depth spacing

      // ****************** Nodes section ***************************

      // Update the nodes...
      const node = svg.selectAll('g.node')
        .data(nodes, (d: any) => d.id || (d.id = Math.random().toString()));

      // Enter any new modes at the parent's previous position.
      const nodeEnter = node.enter().append('g')
        .attr('class', 'node')
        .attr('transform', (d: any) => `translate(${source.y0},${source.x0})`)
        .on('click', click);

      nodeEnter.append('circle')
        .attr('class', 'node')
        .attr('r', 1e-6)
        .style('fill', (d: any) => d._children ? '#2563eb' : '#fff')
        .style('stroke', (d: any) => d.data.name.includes('EXCEPTION') ? '#ef4444' : '#2563eb')
        .style('stroke-width', '2px');

      nodeEnter.append('text')
        .attr('dy', '.35em')
        .attr('x', (d: any) => d.children || d._children ? -13 : 13)
        .attr('text-anchor', (d: any) => d.children || d._children ? 'end' : 'start')
        .text((d: any) => d.data.name)
        .style('font-size', '12px')
        .style('fill', (d: any) => d.data.name.includes('EXCEPTION') ? '#ef4444' : '#334155')
        .style('font-weight', (d: any) => d.data.name.includes('EXCEPTION') ? 'semibold' : 'normal')
        .style('fill-opacity', 1e-6);

      // UPDATE
      const nodeUpdate = node.merge(nodeEnter as any);

      // Transition to the proper position for the node
      nodeUpdate.transition()
        .duration(200)
        .attr('transform', (d: any) => `translate(${d.y},${d.x})`);

      // Update the node attributes and style
      nodeUpdate.select('circle.node')
        .attr('r', 6)
        .style('fill', (d: any) => d._children ? '#2563eb' : '#fff')
        .attr('cursor', 'pointer');

      nodeUpdate.select('text')
        .style('fill-opacity', 1);

      // Remove any exiting nodes
      const nodeExit = node.exit().transition()
        .duration(200)
        .attr('transform', (d: any) => `translate(${source.y},${source.x})`)
        .remove();

      nodeExit.select('circle')
        .attr('r', 1e-6);

      nodeExit.select('text')
        .style('fill-opacity', 1e-6);

      // ****************** Links section ***************************

      // Update the links...
      const link = svg.selectAll('path.link')
        .data(links, (d: any) => d.target.id);

      // Enter any new links at the parent's previous position.
      const linkEnter = link.enter().insert('path', 'g')
        .attr('class', 'link')
        .attr('d', (d: any) => {
          const o = { x: source.x0, y: source.y0 };
          return diagonal(o, o);
        })
        .attr('fill', 'none')
        .attr('stroke', '#cbd5e1')
        .attr('stroke-width', '1.5px');

      // UPDATE
      const linkUpdate = link.merge(linkEnter as any);

      // Transition back to the parent element position
      linkUpdate.transition()
        .duration(200)
        .attr('d', (d: any) => diagonal(d.source, d.target));

      // Remove any exiting links
      link.exit().transition()
        .duration(200)
        .attr('d', (d: any) => {
          const o = { x: source.x, y: source.y };
          return diagonal(o, o);
        })
        .remove();

      // Store the old positions for transition.
      nodes.forEach((d: any) => {
        d.x0 = d.x;
        d.y0 = d.y;
      });

      // Creates a curved (diagonal) path from parent to the child nodes
      function diagonal(s: any, d: any) {
        return `M ${s.y} ${s.x}
                C ${(s.y + d.y) / 2} ${s.x},
                  ${(s.y + d.y) / 2} ${d.x},
                  ${d.y} ${d.x}`;
      }

      // Toggle children on click.
      function click(event: any, d: any) {
        if (d.children) {
          d._children = d.children;
          d.children = null;
        } else {
          d.children = d._children;
          d._children = null;
        }
        update(d);
        
        // Also show insight
        addNotification('Method Insight', `Analyzing: ${d.data.name}`, 'info');
      }
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setLogContent(e.target?.result as string);
        addNotification('File Uploaded', 'Log file loaded successfully.', 'success');
      };
      reader.readAsText(file);
    }
  };

  const analyzeLogs = async () => {
    if (!logContent) {
      addNotification('Error', 'Please upload a log file first.', 'error');
      return;
    }

    setIsAnalyzing(true);
    setAnalysis('');

    try {
      const apiKey = process.env.GEMINI_API_KEY || '';
      if (!apiKey) throw new Error('API Key missing');

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Analyze the following Salesforce debug log and identify any errors, warnings, or performance bottlenecks. Focus on slow SOQL, high-impact DML, and time-heavy Apex methods:\n\n${logContent.substring(0, 20000)}`,
      });

      setAnalysis(response.text || 'No analysis generated.');
      addNotification('Analysis Complete', 'Log analysis finished.', 'success');
    } catch (error) {
      console.error('Log analysis failed', error);
      addNotification('Analysis Failed', 'Failed to analyze logs.', 'error');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="p-8 h-full overflow-y-auto bg-slate-50">
      <h2 className="text-2xl font-semibold text-slate-800 mb-6">Apex Log Analyzer</h2>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <label className="block text-sm font-semibold text-slate-700 mb-2">Upload Apex Debug Log</label>
            <input 
              type="file" 
              onChange={handleFileUpload}
              className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-[#FFE600]/10 file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>

          {logContent && (
            <button 
              onClick={analyzeLogs}
              disabled={isAnalyzing}
              className="w-full px-6 py-3 bg-[#FFE600] text-[#2E2E38] font-semibold rounded-xl hover:bg-[#E5CF00] transition-all disabled:opacity-50"
            >
              {isAnalyzing ? 'Analyzing...' : 'Analyze Logs'}
            </button>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-h-[300px]">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Flame Chart / Call Tree</h3>
            <div ref={chartRef} className="w-full h-full flex items-center justify-center text-slate-400">
              {!logContent && 'Upload a log to visualize'}
            </div>
          </div>

          {analysis && (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">AI Performance Insights</h3>
              <div className="markdown-body text-sm text-slate-700 leading-relaxed">
                <ReactMarkdown>{analysis}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LogAnalyzer;
