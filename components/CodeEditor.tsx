
import React from 'react';
import Editor from '@monaco-editor/react';

interface CodeEditorProps {
  code: string;
  language: string;
  onChange: (value: string | undefined) => void;
  readOnly?: boolean;
}

const CodeEditor: React.FC<CodeEditorProps> = ({ code, language, onChange, readOnly = false }) => {
  return (
    <div className="w-full h-[500px] border border-slate-200 rounded-2xl overflow-hidden shadow-inner bg-[#2E2E38]">
      <Editor
        height="100%"
        defaultLanguage={language}
        defaultValue={code}
        value={code}
        onChange={onChange}
        theme="vs-dark"
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: 'JetBrains Mono, Fira Code, monospace',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 20, bottom: 20 },
          lineNumbers: 'on',
          glyphMargin: false,
          folding: true,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 3,
        }}
      />
    </div>
  );
};

export default CodeEditor;
