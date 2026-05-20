const fs = require('fs');
const file = './services/salesforceService.ts';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(/LIMIT 500/g, 'LIMIT 5000');
content = content.replace(/LIMIT 1000/g, 'LIMIT 5000');
fs.writeFileSync(file, content);
console.log('Done');
