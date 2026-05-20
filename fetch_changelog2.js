const fetch = globalThis.fetch || require('node-fetch');
fetch('https://developer.atlassian.com/changelog')
  .then(res => res.text())
  .then(text => {
    const normalized = text.replace(/\n/g, ' ');
    const match = normalized.match(/(.{0,500}CHANGE-2046.{0,1000})/i);
    if(match) console.log(match[1].replace(/<[^>]+>/g, ' '));
    else console.log('not found');
  })
  .catch(console.error);
