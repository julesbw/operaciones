export function getLocalDate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export const OPERATIONS_TIME_ZONE = 'America/Mexico_City'

const OPERATIONAL_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: OPERATIONS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function getOperationalDate(date = new Date()): string {
  const parts = OPERATIONAL_DATE_FORMATTER.formatToParts(date)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`
}

export function formatLongDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${value}T12:00:00`))
}

export function getWeekday(value: string): number {
  return new Date(`${value}T12:00:00`).getDay()
}
