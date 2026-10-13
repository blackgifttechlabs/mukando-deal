// Small SVG/HTML charts with no library. Every chart animates in (unless the visitor asks for less motion),
// shows a tooltip on hover and keyboard focus, and offers its numbers as a table.
// Text from data is always inserted with textContent, never as HTML.
const SVG = 'http://www.w3.org/2000/svg';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const money = value => new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(value);
export const compact = value => value >= 1000 ? `$${+(value / 1000).toFixed(1)}K` : `$${Math.round(value)}`;
function svg(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  parent?.append(node); return node;
}
function html(tag, className, text, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.append(node); return node;
}
// ---- one shared tooltip ----
let tip;
function tipBox() {
  if (!tip) { tip = html('div', 'viz-tip'); tip.setAttribute('role', 'tooltip'); tip.hidden = true; document.body.append(tip); }
  return tip;
}
export function showTip(target, { title, rows }, event) {
  const box = tipBox(); box.replaceChildren();
  html('strong', 'viz-tip-title', title, box);
  for (const row of rows) {
    const line = html('div', 'viz-tip-row', undefined, box);
    if (row.color) { const key = html('i', 'viz-tip-key', undefined, line); key.style.background = row.color; }
    html('span', 'viz-tip-value', row.value, line); html('span', 'viz-tip-label', row.label, line);
  }
  box.hidden = false;
  const rect = target.getBoundingClientRect();
  const x = event && event.clientX ? event.clientX : rect.left + rect.width / 2;
  const y = event && event.clientY ? event.clientY : rect.top;
  const width = box.offsetWidth, height = box.offsetHeight;
  box.style.left = Math.max(8, Math.min(innerWidth - width - 8, x - width / 2)) + 'px';
  box.style.top = (y - height - 14 < 8 ? y + 18 : y - height - 14) + 'px';
}
export const hideTip = () => { if (tip) tip.hidden = true; };
function attachTip(node, content) {
  node.addEventListener('pointermove', event => showTip(node, content(), event));
  node.addEventListener('pointerleave', hideTip);
  node.addEventListener('focus', () => showTip(node, content()));
  node.addEventListener('blur', hideTip);
}
const niceMax = value => { const power = 10 ** Math.floor(Math.log10(Math.max(value, 1))); const step = [1, 2, 2.5, 5, 10].find(item => item * power >= value / 4) * power; return Math.ceil(value / step) * step; };
// ---- stacked column chart ----
// labels: short x labels; series: [{ name, color, values }] stacked bottom-to-top; details: full titles for the tooltip.
export function columnChart(container, { labels, details = labels, series, format = money, ariaLabel, height: fixedHeight }) {
  container.replaceChildren(); container.classList.add('viz');
  const legend = html('div', 'viz-legend', undefined, container);
  for (const item of series) { const entry = html('span', 'viz-legend-item', undefined, legend); const swatch = html('i', 'viz-swatch', undefined, entry); swatch.style.background = item.color; html('span', '', item.name, entry); }
  const tableButton = html('button', 'viz-toggle', 'View as table', legend); tableButton.type = 'button'; tableButton.setAttribute('aria-pressed', 'false');
  const stage = html('div', 'viz-stage', undefined, container);
  const tableWrap = html('div', 'viz-table table-scroll', undefined, container); tableWrap.hidden = true;
  const table = html('table', 'member-table', undefined, tableWrap);
  const head = html('tr', '', undefined, html('thead', '', undefined, table));
  for (const heading of ['Cycle', ...series.map(item => item.name), 'Total']) { const cell = html('th', '', heading, head); cell.scope = 'col'; }
  const body = html('tbody', '', undefined, table);
  labels.forEach((label, index) => {
    const row = html('tr', '', undefined, body); html('td', '', details[index], row);
    for (const item of series) html('td', '', format(item.values[index]), row);
    html('td', '', format(series.reduce((sum, item) => sum + item.values[index], 0)), row);
  });
  tableButton.addEventListener('click', () => {
    const show = tableWrap.hidden; tableWrap.hidden = !show; stage.hidden = show;
    tableButton.setAttribute('aria-pressed', String(show)); tableButton.textContent = show ? 'View as chart' : 'View as table';
    hideTip();
  });
  let animate = !reduceMotion();
  function draw() {
    stage.replaceChildren();
    const width = Math.max(260, stage.clientWidth), height = fixedHeight ?? (width < 520 ? 220 : 270);
    const margin = { left: 46, right: 8, top: 10, bottom: 26 }, plotWidth = width - margin.left - margin.right, plotHeight = height - margin.top - margin.bottom;
    const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': ariaLabel ?? 'Column chart' }, stage);
    const totals = labels.map((_, index) => series.reduce((sum, item) => sum + item.values[index], 0));
    const max = niceMax(Math.max(...totals, 1));
    for (let tick = 0; tick <= 4; tick++) {
      const value = max / 4 * tick, y = margin.top + plotHeight - value / max * plotHeight;
      svg('line', { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: tick === 0 ? 'viz-axis' : 'viz-grid' }, root);
      const text = svg('text', { x: margin.left - 8, y: y + 3.5, 'text-anchor': 'end', class: 'viz-tick' }, root); text.textContent = compact(value);
    }
    const band = plotWidth / labels.length, barWidth = Math.min(24, band * 0.62), every = band < 26 ? 2 : 1;
    labels.forEach((label, index) => {
      const x = margin.left + band * index + (band - barWidth) / 2, group = svg('g', { class: 'viz-bar' + (animate ? ' is-animated' : ''), style: `--i:${index}` }, root);
      const visible = series.map((item, order) => ({ item, order, value: item.values[index] })).filter(part => part.value > 0);
      let floor = margin.top + plotHeight;
      visible.forEach((part, position) => {
        const full = Math.max(2, part.value / max * plotHeight), top = floor - full, last = position === visible.length - 1;
        const y = last ? top : top + 2, h = last ? full : Math.max(1, full - 2), r = last ? Math.min(4, barWidth / 2, h) : 0;   // 2px surface gap; 4px rounded data end
        const d = `M${x},${y + h}V${y + r}${r ? `Q${x},${y} ${x + r},${y}H${x + barWidth - r}Q${x + barWidth},${y} ${x + barWidth},${y + r}` : `H${x + barWidth}`}V${y + h}Z`;
        svg('path', { d, fill: part.item.color, class: 'viz-seg' }, group); floor = top;
      });
      if (index % every === 0 || index === labels.length - 1) { const text = svg('text', { x: x + barWidth / 2, y: height - 8, 'text-anchor': 'middle', class: 'viz-tick' }, root); text.textContent = label; }
      const hit = svg('rect', { x: margin.left + band * index, y: margin.top, width: band, height: plotHeight + 2, fill: 'transparent', tabindex: 0, class: 'viz-hit', 'aria-label': `${details[index]}: ${series.map(item => `${item.name} ${format(item.values[index])}`).join(', ')}` }, root);
      const content = () => ({ title: details[index], rows: [...series].reverse().map(item => ({ color: item.color, value: format(item.values[index]), label: item.name })) });
      attachTip(hit, content);
      hit.addEventListener('pointerenter', () => group.classList.add('is-hover')); hit.addEventListener('pointerleave', () => group.classList.remove('is-hover'));
      hit.addEventListener('focus', () => group.classList.add('is-hover')); hit.addEventListener('blur', () => group.classList.remove('is-hover'));
    });
    animate = false;   // only the first draw animates; resizing just redraws
  }
  draw();
  let last = stage.clientWidth, timer;
  new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(() => { if (Math.abs(stage.clientWidth - last) > 4 && !stage.hidden) { last = stage.clientWidth; draw(); } }, 120); }).observe(stage);
}
// ---- donut with a centre figure and a legend ----
// segments: [{ label, value, color, icon, format }]; icons make the meaning independent of colour.
export function donut(container, { segments, centerValue, centerLabel, ariaLabel, small = false }) {
  container.replaceChildren(); container.classList.add('viz', 'viz-donut'); container.classList.toggle('viz-donut-sm', small);
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  const radius = 58, circumference = 2 * Math.PI * radius, gap = segments.filter(item => item.value > 0).length > 1 ? 3 : 0;
  const figure = html('div', 'viz-donut-figure', undefined, container);
  const root = svg('svg', { viewBox: '0 0 160 160', class: 'viz-donut-svg', role: 'img', 'aria-label': ariaLabel ?? 'Donut chart' }, figure);
  svg('circle', { cx: 80, cy: 80, r: radius, class: 'viz-track', 'stroke-width': 14, fill: 'none' }, root);
  let used = 0;
  segments.forEach((item, index) => {
    if (item.value <= 0 || total <= 0) return;
    const length = item.value / total * circumference, dash = Math.max(0.5, length - gap);
    const ring = svg('circle', { cx: 80, cy: 80, r: radius, fill: 'none', stroke: item.color, 'stroke-width': 14, 'stroke-dasharray': `${dash} ${circumference - dash}`, 'stroke-dashoffset': -used, transform: 'rotate(-90 80 80)', class: 'viz-ring' + (reduceMotion() ? '' : ' is-animated'), tabindex: 0, 'aria-label': `${item.label}: ${item.format ? item.format(item.value) : item.value}`, style: `--c:${circumference};--i:${index}` }, root);
    attachTip(ring, () => ({ title: item.label, rows: [{ color: item.color, value: item.format ? item.format(item.value) : String(item.value), label: `${Math.round(item.value / total * 100)}% of ${total === 1 ? 'total' : (item.format ? item.format(total) : total)}` }] }));
    used += length;
  });
  const center = html('div', 'viz-donut-center', undefined, figure);
  html('strong', '', centerValue, center); html('span', '', centerLabel, center);
  const list = html('ul', 'viz-donut-legend', undefined, container);
  for (const item of segments) {
    const row = html('li', '', undefined, list);
    const swatch = html('i', 'viz-swatch', undefined, row); swatch.style.background = item.color;
    if (item.icon) { const icon = html('i', `fa-solid fa-${item.icon} viz-icon`, undefined, row); icon.setAttribute('aria-hidden', 'true'); }
    html('span', 'viz-legend-name', item.label, row);
    html('strong', '', item.format ? item.format(item.value) : String(item.value), row);
  }
}
// ---- sparkline: 2px line, wash under it, ringed end dot ----
export function sparkline(container, values, color = 'currentColor') {
  container.replaceChildren(); if (values.length < 2) return;
  const width = 120, height = 36, pad = 5, max = Math.max(...values, 1), min = Math.min(...values, 0);
  const point = (value, index) => [pad + index * (width - pad * 2) / (values.length - 1), height - pad - (value - min) / (max - min || 1) * (height - pad * 2)];
  const points = values.map(point), line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'viz-spark', 'aria-hidden': 'true' }, container);
  svg('path', { d: `${line}L${points.at(-1)[0]},${height}L${points[0][0]},${height}Z`, fill: color, opacity: 0.12 }, root);
  svg('path', { d: line, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1, class: reduceMotion() ? '' : 'viz-draw' }, root);
  const [x, y] = points.at(-1); svg('circle', { cx: x, cy: y, r: 4, fill: color, class: 'viz-dot' }, root);
}
// ---- count a number up to its value ----
export function countUp(node, target, format = String, duration = 900) {
  if (reduceMotion() || !Number.isFinite(target)) { node.textContent = format(target); return; }
  const start = performance.now();
  const tick = now => { const t = Math.min(1, (now - start) / duration), eased = 1 - (1 - t) ** 3; node.textContent = format(target * eased); if (t < 1) requestAnimationFrame(tick); else node.textContent = format(target); };
  requestAnimationFrame(tick);
}
