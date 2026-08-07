export function getLocalDate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
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
