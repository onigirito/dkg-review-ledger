const element = (tag, text, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
const status = document.querySelector('#status');
const repository = document.querySelector('#repository');
async function api(path, values) {
  const response = await fetch(path + '?' + new URLSearchParams(values));
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}
async function inspect(source, name) {
  const pull = /\/pull\/(\d+)$/.exec(source)?.[1];
  if (!pull) return;
  const result = await api('api/review-state', { repository: repository.value, pull, name });
  const target = document.querySelector('#evidence'); target.replaceChildren();
  target.append(element('h2', 'Captured review state'), element('p', 'Head ' + result.evidence.headSha),
    element('p', 'Observed ' + result.observedAt + ' · ' + result.memoryLayer));
  for (const review of result.evidence.reviews) target.append(element('p', review.author + ': ' + review.reviewState + ' — ' + (review.appliesToCapturedHead ? 'matches captured head' : 'describes an earlier commit')));
  for (const check of result.evidence.checks) target.append(element('p', check.name + ': ' + (check.conclusion || check.status) + ' — ' + (check.appliesToCapturedHead ? 'matches captured head' : 'describes a different commit')));
  target.append(element('p', result.evidence.interpretation, 'note'));
}
async function search() {
  status.textContent = 'Querying DKG Working Memory…';
  const result = await api('api/search', { repository: repository.value, q: document.querySelector('#query').value });
  const target = document.querySelector('#snapshots'); target.replaceChildren();
  for (const row of result.snapshots) {
    const card = element('article', '');
    const link = element('a', row.title); link.href = row.source; link.rel = 'noopener noreferrer'; link.target = '_blank';
    const button = element('button', 'Inspect commit correspondence'); button.type = 'button';
    button.addEventListener('click', () => inspect(row.source, row.name).catch(error => { status.textContent = error.message; }));
    card.append(link, element('p', 'Head ' + row.head), element('p', 'Observed ' + row.observed), button); target.append(card);
  }
  status.textContent = result.snapshots.length + ' captured snapshots. Previous revisions remain available through the history API.';
}
document.querySelector('#search').addEventListener('submit', event => { event.preventDefault(); search().catch(error => { status.textContent = error.message; }); });
api('api/projects', {}).then(projects => {
  for (const name of projects.repositories) { const option = element('option', name); option.value = name; repository.append(option); }
  return search();
}).catch(error => { status.textContent = error.message; });
