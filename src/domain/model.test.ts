import { describe, expect, it } from 'vitest'

import {
  HOLIDAY_WORK_SHIFT_TYPES,
  MANUAL_SPECIAL_DAY_TYPES,
  SPECIAL_DAY_TYPES,
  SHIFT_TYPES,
  WORK_SHIFT_TYPES,
  isManualSpecialDayType,
  isShiftType,
} from './model'
import type {
  Employee,
  MonthlySchedule,
  ScheduleEntry,
  SpecialDay,
} from './model'

describe('domain model', () => {
  it('keeps the ShiftType runtime list aligned with PLAN.md', () => {
    expect(SHIFT_TYPES).toEqual([
      'F05',
      'F13',
      'A',
      '休',
      '例',
      '國',
      '國05',
      '國13',
      '國A',
      '特',
      '公',
      'PT',
    ])
    expect(isShiftType('國A')).toBe(true)
    expect(isShiftType('國01')).toBe(false)
  })

  it('classifies work shifts used by rule validators', () => {
    expect(WORK_SHIFT_TYPES).toEqual(['F05', 'F13', 'A', '國05', '國13', '國A'])
    expect(HOLIDAY_WORK_SHIFT_TYPES).toEqual(['國05', '國13', '國A'])
  })

  it('supports independent employee role flags and previous-month shifts', () => {
    const employee = {
      id: 'emp-1',
      name: '屈澤宇',
      isSupervisor: true,
      isVeteran: true,
      isPT: false,
      isActive: true,
      prevMonthLastShift: '國A',
    } satisfies Employee

    expect(employee).toMatchObject({
      isSupervisor: true,
      isVeteran: true,
      prevMonthLastShift: '國A',
    })
  })

  it('distinguishes manual special days from generated four-week nodes', () => {
    expect(SPECIAL_DAY_TYPES).toEqual(['假日', '店務', '大清', '四周'])
    expect(MANUAL_SPECIAL_DAY_TYPES).toEqual(['假日', '店務', '大清'])
    expect(isManualSpecialDayType('店務')).toBe(true)
    expect(isManualSpecialDayType('四周')).toBe(false)

    const specialDay = {
      date: '2026-06-12',
      type: '四周',
    } satisfies SpecialDay

    expect(specialDay.type).toBe('四周')
  })

  it('models monthly schedules with carry-in, entries, and relaxed rules', () => {
    const entry = {
      employeeId: 'emp-1',
      date: '2026-06-12',
      shift: '例',
      isAutoRelaxed: false,
      isManualEdit: false,
    } satisfies ScheduleEntry

    const schedule = {
      month: '2026-06',
      prevFourWeekDate: '2026-05-15',
      cycleCarryIn: [{ employeeId: 'emp-1', reiCount: 3, xiuCount: 2 }],
      specialDays: [{ date: '2026-06-12', type: '四周' }],
      constraints: [
        {
          employeeId: 'emp-1',
          month: '2026-06',
          forcedDaysOff: ['2026-06-03'],
        },
      ],
      entries: [entry],
      relaxedRules: [
        {
          ruleId: 'R15',
          ruleName: '大清日人力',
          affectedDates: ['2026-06-20'],
        },
      ],
    } satisfies MonthlySchedule

    expect(schedule.cycleCarryIn[0]).toEqual({
      employeeId: 'emp-1',
      reiCount: 3,
      xiuCount: 2,
    })
    expect(schedule.entries).toEqual([entry])
  })
})
