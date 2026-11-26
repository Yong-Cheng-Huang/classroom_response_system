const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function formatSubmissionTime(timestamp: number) {
  const parts = Object.fromEntries(formatter.formatToParts(timestamp).map(part => [part.type, part.value]));
  const milliseconds = String(((timestamp % 1000) + 1000) % 1000).padStart(3, '0');
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${milliseconds}（Asia/Taipei）`;
}

export function elapsedMilliseconds(start: number | null, end: number | null, now: () => number = Date.now) {
  if (start === null) return 0;
  return Math.max(0, (end ?? now()) - start);
}
