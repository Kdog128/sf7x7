// Population milestones: a banner and a feed post the first time the city passes each mark.
// Progress is derived from the population on load, so nothing extra goes into the save.
import { post } from './city.js';

export const MILESTONES = [
  { pop: 10000, title: '10,000 residents', post: 'Ten thousand of us now. The corner store ran out of sourdough by 9am.', who: 'burrito_index' },
  { pop: 50000, title: '50,000 residents', post: 'Fifty thousand residents. Muni is officially a lifestyle now.', who: 'muni_diaries' },
  { pop: 100000, title: '100,000 residents', post: 'A hundred thousand people. The fog has never had this many witnesses.', who: 'karl_the_fog' },
  { pop: 250000, title: '250,000 residents', post: 'Quarter of a million. Rents noticed before anyone else did.', who: 'sf_rent_watch' },
  { pop: 500000, title: '500,000 residents', post: 'Half a million people. This is a real city now.', who: 'twin_peaks_tess' },
  { pop: 1000000, title: '1 million residents', post: 'One million residents. Somewhere a cable car gripman just rang the bell twice.', who: 'fog_watch' },
];

let reached = 0, banner = null, hideAt = 0;
const passed = (pop) => { let k = 0; while (k < MILESTONES.length && pop >= MILESTONES[k].pop) k++; return k; };

// Call after a new city starts or a save loads: marks already passed are not celebrated again.
export function resetMilestones(pop) { reached = passed(pop); }

// Call each UI update. Celebrates only the highest newly passed mark, and never again after a dip and recovery.
export function checkMilestones(pop, cityName) {
  const k = passed(pop);
  if (banner && performance.now() > hideAt) { banner.remove(); banner = null; }
  if (k <= reached) return;
  reached = k;
  const m = MILESTONES[k - 1];
  post(m.post, 'life', m.who);
  show(cityName || 'Your city', m.title);
}

function show(name, title) {
  if (banner) banner.remove();
  banner = document.createElement('div');
  banner.className = 'milestone';
  banner.setAttribute('role', 'status');
  const head = document.createElement('b'), sub = document.createElement('span');
  head.textContent = title; sub.textContent = `${name} just passed a milestone`;
  banner.append(head, sub);
  document.body.appendChild(banner);
  hideAt = performance.now() + 4500;
}
