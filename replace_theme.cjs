const fs = require('fs');
const path = require('path');

const dirs = [path.join(__dirname, 'components'), path.join(__dirname, 'src')];

const replaceInFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  
  const original = content;

  // Swap out the softer yellow #EAB308 for the ultra-bright #FFE600
  content = content.replace(/#EAB308/g, '#FFE600');
  
  // Swap out the hover #CA8A04 for #E5CF00
  content = content.replace(/#CA8A04/g, '#E5CF00');

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

dirs.forEach(dir => {
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(file => {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isFile() && (file.endsWith('.tsx') || file.endsWith('.ts'))) {
        replaceInFile(fullPath);
      }
    });
  }
});
console.log('Done mapping components to softer yellow theme');
