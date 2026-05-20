import fetch from 'node-fetch';

async function search() {
  const q = encodeURIComponent('"search/jql" site:developer.atlassian.com');
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`);
  const html = await res.text();
  const results = html.match(/<a class="result__snippet[^>]+>(.*?)<\/a>/gi);
  if (results) {
    results.forEach(r => {
      console.log(r.replace(/<[^>]+>/g, ''));
    });
  } else {
    console.log("No results");
  }
}

search();
