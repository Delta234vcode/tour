/**
 * Витягує дати з вільного тексту: DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD.
 */
export function parseTourDatesFromText(raw: string): string[] {
  const s = (raw || '').trim();
  if (!s) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  const pushIso = (y: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return;
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!seen.has(iso)) {
      seen.add(iso);
      out.push(iso);
    }
  };

  const reDMY = /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = reDMY.exec(s)) !== null) {
    pushIso(parseInt(m[3], 10), parseInt(m[2], 10), parseInt(m[1], 10));
  }

  const reISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = reISO.exec(s)) !== null) {
    pushIso(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
  }

  out.sort();
  return out;
}
