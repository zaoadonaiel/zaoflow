export function calcNextRunMulti(frequency: string, times: string[], now: Date = new Date()): Date {
  const sorted = [...times].sort()

  for (const t of sorted) {
    const [h, m] = t.split(':').map(Number)
    const candidate = new Date(now)
    candidate.setHours(h, m, 0, 0)
    if (candidate > now) return candidate
  }

  const nextDay = advanceByFrequency(frequency, new Date(now))
  const [h, m] = sorted[0].split(':').map(Number)
  nextDay.setHours(h, m, 0, 0)
  return nextDay
}

function advanceByFrequency(frequency: string, from: Date): Date {
  const d = new Date(from)
  switch (frequency) {
    case 'daily':         d.setDate(d.getDate() + 1);      break
    case 'every_48h':    d.setDate(d.getDate() + 2);      break
    case 'weekly':       d.setDate(d.getDate() + 7);      break
    case 'twice_monthly':
      if (d.getDate() < 15) { d.setDate(15) }
      else { d.setMonth(d.getMonth() + 1, 1) }
      break
    case 'monthly':      d.setMonth(d.getMonth() + 1);    break
    default:             d.setDate(d.getDate() + 1)
  }
  return d
}
