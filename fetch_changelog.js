const fetch = globalThis.fetch || require('node-fetch');
fetch('https://developer.atlassian.com/changelog/')
  .then(res => res.text())
  .then(text => console.log(text.substring(0, 1000)))
  .catch(console.error);
