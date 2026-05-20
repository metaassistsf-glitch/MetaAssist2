
export interface CallNode {
  name: string;
  value: number;
  children: CallNode[];
}

export const parseApexLogToTree = (logContent: string): CallNode => {
  const lines = logContent.split('\n');
  const root: CallNode = { name: 'Root', value: 0, children: [] };
  const stack: CallNode[] = [root];

  lines.forEach(line => {
    if (line.includes('METHOD_ENTRY')) {
      const parts = line.split('|');
      const methodName = parts[parts.length - 1];
      const newNode: CallNode = { name: methodName, value: 0, children: [] };
      stack[stack.length - 1].children.push(newNode);
      stack.push(newNode);
    } else if (line.includes('METHOD_EXIT')) {
      if (stack.length > 1) {
        stack.pop();
      }
    }
  });

  return root;
};
