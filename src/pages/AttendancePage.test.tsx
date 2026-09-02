import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AttendanceStatusControls } from './AttendancePage'

describe('AttendanceStatusControls', () => {
  it('keeps the current status visible while locking a paid attendance', () => {
    const markup = renderToStaticMarkup(
      <AttendanceStatusControls
        paid
        status="present"
        attendanceType="half"
        onChange={vi.fn()}
      />,
    )

    expect(markup).toContain('attendance-present')
    expect(markup).toContain('Pagado · No modificable')
    expect(markup).toContain('Medio turno')
    expect(markup.match(/disabled=""/g)).toHaveLength(5)
  })

  it('leaves unpaid status controls editable', () => {
    const markup = renderToStaticMarkup(
      <AttendanceStatusControls
        status="absent"
        onChange={vi.fn()}
      />,
    )

    expect(markup).toContain('attendance-absent')
    expect(markup).not.toContain('Pagado · No modificable')
    expect(markup).not.toContain('disabled=""')
  })
})
