
import React, { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import QuickPinchZoom, { make3dTransformValue } from 'react-quick-pinch-zoom';

mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'loose',
  fontFamily: 'Inter',
  themeVariables: {
    primaryColor: '#ffffff',
    primaryTextColor: '#1e293b',
    primaryBorderColor: '#94a3b8',
    lineColor: '#94a3b8',
    secondaryColor: '#ffffff',
    tertiaryColor: '#ffffff',
    fontSize: '14px',
    mainBkg: '#ffffff',
    nodeBkg: '#ffffff',
    nodeBorder: '#94a3b8',
    clusterBkg: '#ffffff',
    clusterBorder: '#cbd5e1',
    defaultLinkColor: '#94a3b8',
    titleColor: '#1e293b',
    edgeLabelBackground: '#ffffff',
  },
  flowchart: {
    useMaxWidth: false,
    htmlLabels: true,
    curve: 'linear',
    padding: 30,
    nodeSpacing: 80,
    rankSpacing: 100,
  },
});

interface MermaidProps {
  chart: string;
}

const MermaidRenderer: React.FC<MermaidProps> = ({ chart }) => {
  const ref = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<any>(null);
  const [error, setError] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [renderCount, setRenderCount] = useState<number>(0);
  const [svgContent, setSvgContent] = useState<string>('');

  const transformRef = useRef({ x: 0, y: 0, scale: 1 });

  const onUpdate = useCallback(({ x, y, scale }: { x: number; y: number; scale: number }) => {
    const el = ref.current;
    if (el) {
      transformRef.current = { x, y, scale };
      const value = make3dTransformValue({ x, y, scale });
      el.style.setProperty('transform', value);
    }
  }, []);

  useEffect(() => {
    if (svgContent && zoomRef.current && ref.current) {
        // Initial fit to view
        const container = ref.current.parentElement?.parentElement;
        const svg = ref.current.querySelector('svg');
        if (container && svg) {
          const containerWidth = container.clientWidth - 40;
          const containerHeight = container.clientHeight - 40;
          const svgWidth = svg.viewBox.baseVal.width || svg.width.baseVal.value || 800;
          const svgHeight = svg.viewBox.baseVal.height || svg.height.baseVal.value || 600;
          
          const scaleW = containerWidth / svgWidth;
          const scaleH = containerHeight / svgHeight;
          const initialScale = Math.min(scaleW, scaleH, 1) * 0.95;
          
          zoomRef.current.scaleTo({
            scale: initialScale,
            x: 0,
            y: 0
          });
        }
    }
  }, [svgContent]);

  useEffect(() => {
    if (chart) {
      setError(false);
      const renderId = 'mermaid-svg-' + Math.random().toString(36).substr(2, 9);
      
      const renderChart = async () => {
        try {
          try {
            await mermaid.parse(chart);
          } catch (parseErr: any) {
            console.error("Mermaid Parse Error:", parseErr);
            setError(true);
            setErrorMsg(parseErr?.message || parseErr?.toString() || "Parse Error");
            return;
          }

          const { svg } = await mermaid.render(renderId, chart);
          setSvgContent(svg);
        } catch (e: any) {
          console.error("Mermaid Render Exception:", e);
          setError(true);
          setErrorMsg(e?.message || e?.toString() || "Render Error");
        }
      };

      renderChart();
    }
  }, [chart, renderCount]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-slate-50 border border-slate-100 text-center animate-fadeIn w-full overflow-auto">
        <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-500 mb-6 shadow-sm">
          <i className="fas fa-exclamation-triangle text-xl"></i>
        </div>
        <h4 className="text-lg font-black text-slate-800 mb-2">Visualization Error</h4>
        <p className="text-sm text-slate-500 max-w-lg mx-auto mb-4 font-medium leading-relaxed">
          {errorMsg || "The complex logic structure of this component requires a fresh perspective to visualize."}
        </p>
        
        {chart && (
          <div className="w-full max-w-2xl text-left bg-slate-900 rounded-xl p-4 overflow-auto text-xs font-mono text-slate-300 whitespace-pre-wrap mt-4 mb-8">
            {chart}
          </div>
        )}

        <button 
          onClick={() => {
            setError(false);
            setErrorMsg(null);
            setRenderCount(prev => prev + 1);
          }}
          className="px-8 py-4 bg-indigo-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 active:scale-95 flex items-center space-x-3"
        >
          <i className="fas fa-magic"></i>
          <span>Redo Magic Visualization</span>
        </button>
      </div>
    );
  }

  const handleZoom = (type: 'in' | 'out') => {
    if (zoomRef.current) {
      const { x, y, scale } = transformRef.current;
      const factor = type === 'in' ? 1.2 : 0.8;
      const newScale = scale * factor;
      
      zoomRef.current.scaleTo({
        scale: newScale,
        x: x,
        y: y,
      });
    }
  };

  return (
    <div className="relative w-full bg-white rounded-[32px] border border-slate-100 shadow-inner overflow-hidden min-h-[400px] cursor-grab active:cursor-grabbing">
      {/* ... indicators ... */}
      <div className="absolute top-4 left-4 z-10 flex flex-col space-y-2">
        <div className="px-3 py-1.5 bg-white/80 backdrop-blur-md rounded-full border border-slate-100 shadow-sm flex items-center space-x-2">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></div>
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Interactive Canvas</span>
        </div>
        <div className="px-3 py-1.5 bg-indigo-50/50 rounded-full border border-indigo-100/50 flex items-center space-x-2">
          <i className="fas fa-magnifying-glass text-[10px] text-indigo-400"></i>
          <span className="text-[9px] font-bold text-indigo-600 uppercase tracking-tighter">Pinch to Zoom • Drag to Move</span>
        </div>
      </div>

      <QuickPinchZoom
        ref={zoomRef}
        onUpdate={onUpdate}
        wheelScaleFactor={0.005}
        draggableUnZoomed={true}
        enforceBoundsDuringZoom={false}
      >
        <div ref={ref} className="flex justify-center p-20 transition-transform duration-75 will-change-transform">
          <div 
            dangerouslySetInnerHTML={{ __html: svgContent }} 
            className="mermaid-svg-wrapper flex items-center justify-center p-8 bg-white/50 rounded-3xl"
          />
        </div>
      </QuickPinchZoom>

      <div className="absolute bottom-4 right-4 flex space-x-2">
        <button 
          onClick={() => handleZoom('out')}
          className="w-10 h-10 bg-white/90 backdrop-blur rounded-xl border border-slate-100 shadow-lg text-slate-400 hover:text-indigo-600 transition-all active:scale-90"
        >
          <i className="fas fa-minus text-xs"></i>
        </button>
        <button 
          onClick={() => handleZoom('in')}
          className="w-10 h-10 bg-white/90 backdrop-blur rounded-xl border border-slate-100 shadow-lg text-slate-400 hover:text-indigo-600 transition-all active:scale-90"
        >
          <i className="fas fa-plus text-xs"></i>
        </button>
      </div>
    </div>
  );
};

export default MermaidRenderer;
