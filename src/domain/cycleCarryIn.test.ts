import { describe, expect, it } from 'vitest'

import type { Employee, MonthlySchedule } from './model'
import {
  applyPreviousMonthLastShifts,
  calculateCycleCarryInFromSchedule,
  previousMonth,
} from './cycleCarryIn'

describe('cycle carry-in calculation', () => {
  const employees: Employee[] = [
    {
      id: 'emp-1',
      name: '主管',
      isSupervisor: true,
      isVeteran: true,
      isPT: false,
      isActive: true,
      prevMonthLastShift: null,
    },
    {
      id: 'emp-2',
      name: '老手',
      isSupervisor: false,
      isVeteran: true,
      isPT: false,
      isActive: true,
      prevMonthLastShift: null,
    },
    {
      id: 'emp-new',
      name: '新員工',
      isSupervisor: false,
      isVeteran: false,
      isPT: false,
      isActive: true,
      prevMonthLastShift: null,
    },
  ]

  it('counts previous-month rei and xiu entries in the first cross-month cycle', () => {
    expect(
      calculateCycleCarryInFromSchedule({
        employees,
        month: '2026-06',
        prevFourWeekDate: '2026-05-15',
        previousSchedule: {
          ...makePreviousSchedule(),
          entries: [
            makeEntry('emp-1', '2026-05-15', '例'),
            makeEntry('emp-1', '2026-05-16', '例'),
            makeEntry('emp-1', '2026-05-17', '休'),
            makeEntry('emp-1', '2026-05-31', '例'),
            makeEntry('emp-1', '2026-06-01', '休'),
            makeEntry('emp-2', '2026-05-16', '休'),
            makeEntry('emp-2', '2026-05-20', '休'),
            makeEntry('emp-2', '2026-05-21', '國'),
          ],
        },
      }),
    ).toEqual([
      { employeeId: 'emp-1', reiCount: 2, xiuCount: 1 },
      { employeeId: 'emp-2', reiCount: 0, xiuCount: 2 },
      { employeeId: 'emp-new', reiCount: 0, xiuCount: 0 },
    ])
  })

  it('returns zero carry-in when the first cycle starts in the current month', () => {
    expect(
      calculateCycleCarryInFromSchedule({
        employees,
        month: '2026-06',
        prevFourWeekDate: '2026-05-31',
        previousSchedule: makePreviousSchedule(),
      }),
    ).toEqual([
      { employeeId: 'emp-1', reiCount: 0, xiuCount: 0 },
      { employeeId: 'emp-2', reiCount: 0, xiuCount: 0 },
      { employeeId: 'emp-new', reiCount: 0, xiuCount: 0 },
    ])
  })

  it('formats the previous month across year boundaries', () => {
    expect(previousMonth('2026-01')).toBe('2025-12')
    expect(previousMonth('2026-06')).toBe('2026-05')
  })

  it('applies last-day shifts from the previous-month schedule to matching employees', () => {
    expect(
      applyPreviousMonthLastShifts(employees, {
        ...makePreviousSchedule(),
        entries: [
          makeEntry('emp-1', '2026-05-30', '休'),
          makeEntry('emp-1', '2026-05-31', 'F13'),
          makeEntry('emp-2', '2026-05-31', '國A'),
        ],
      }),
    ).toEqual([
      expect.objectContaining({ id: 'emp-1', prevMonthLastShift: 'F13' }),
      expect.objectContaining({ id: 'emp-2', prevMonthLastShift: '國A' }),
      expect.objectContaining({ id: 'emp-new', prevMonthLastShift: null }),
    ])
  })
})

function makePreviousSchedule(): MonthlySchedule {
  return {
    month: '2026-05',
    prevFourWeekDate: '2026-04-17',
    cycleCarryIn: [],
    specialDays: [],
    constraints: [],
    entries: [],
    relaxedRules: [],
  }
}

function makeEntry(
  employeeId: string,
  date: MonthlySchedule['entries'][number]['date'],
  shift: MonthlySchedule['entries'][number]['shift'],
): MonthlySchedule['entries'][number] {
  return {
    employeeId,
    date,
    shift,
    isAutoRelaxed: false,
    isManualEdit: false,
  }
}
