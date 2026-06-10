import { describe, expect, it, vi } from 'vitest'

import type { Employee, ScheduleEntry } from '../domain/model'
import { DEFAULT_RULES, validateRules } from '../domain/rules'
import {
  attemptBacktrackingSchedule,
  prefillLockedEntries,
  runRelaxedScheduling,
  type AttemptSchedule,
  type AttemptScheduleInput,
  type ScheduleRequest,
} from './scheduler'

const employees: Employee[] = [
  {
    id: 'emp-1',
    name: '員工一',
    isSupervisor: true,
    isVeteran: true,
    isPT: false,
    isActive: true,
    prevMonthLastShift: null,
  },
]

describe('scheduler orchestration', () => {
  it('prefills locked leave entries and forced days off without overwriting 特 or 公', () => {
    expect(
      prefillLockedEntries({
        lockedEntries: [
          makeEntry('emp-1', '2026-06-01', '特'),
          makeEntry('emp-1', '2026-06-02', '公'),
        ],
        constraints: [
          {
            employeeId: 'emp-1',
            month: '2026-06',
            forcedDaysOff: ['2026-06-01', '2026-06-03'],
          },
        ],
      }),
    ).toEqual([
      makeEntry('emp-1', '2026-06-01', '特'),
      makeEntry('emp-1', '2026-06-02', '公'),
      makeEntry('emp-1', '2026-06-03', '休'),
    ])
  })

  it('drops the lowest priority active rule until an attempt succeeds', () => {
    const request = makeRequest({
      rules: DEFAULT_RULES.filter((rule) => ['R14', 'R15'].includes(rule.id)),
    })
    const attemptSchedule = vi.fn<AttemptSchedule>((attempt) => {
      if (attempt.activeRules.some((rule) => rule.id === 'R15')) {
        return {
          success: false,
          conflictDates: ['2026-06-20'],
          reason: '大清日人力不足',
        }
      }

      return {
        success: true,
        entries: attempt.prefilledEntries,
      }
    })

    const result = runRelaxedScheduling(request, attemptSchedule)

    expect(result).toEqual({
      success: true,
      schedule: {
        month: '2026-06',
        prevFourWeekDate: '2026-05-15',
        cycleCarryIn: [],
        specialDays: [],
        constraints: [],
        entries: [],
        relaxedRules: [
          {
            ruleId: 'R15',
            ruleName: '大清日人力',
            affectedDates: ['2026-06-20'],
          },
        ],
      },
    })
    expect(attemptSchedule).toHaveBeenCalledTimes(2)
    expect(
      attemptSchedule.mock.calls.map(([attempt]) =>
        attempt.activeRules.map((rule) => rule.id),
      ),
    ).toEqual([['R14', 'R15'], ['R14']])
  })

  it('returns failure when every rule has been relaxed and the attempt still fails', () => {
    const request = makeRequest({
      rules: DEFAULT_RULES.filter((rule) => rule.id === 'R15'),
    })
    const attemptSchedule = vi.fn<AttemptSchedule>(() => ({
      success: false,
      conflictDates: ['2026-06-20'],
      reason: '仍無可行班表',
    }))

    expect(runRelaxedScheduling(request, attemptSchedule)).toEqual({
      success: false,
      reason: '仍無可行班表',
      conflictDates: ['2026-06-20'],
      relaxedRules: [
        {
          ruleId: 'R15',
          ruleName: '大清日人力',
          affectedDates: ['2026-06-20'],
        },
      ],
    })
    expect(attemptSchedule).toHaveBeenCalledTimes(2)
    expect(attemptSchedule.mock.calls[1][0].activeRules).toEqual([])
  })

  it('attemptBacktrackingSchedule fills missing entries while preserving prefilled forced leave', () => {
    const request = makeRequest({
      constraints: [
        {
          employeeId: 'emp-1',
          month: '2026-06',
          forcedDaysOff: ['2026-06-03'],
        },
      ],
      rules: DEFAULT_RULES.filter((rule) => rule.id === 'R01'),
    })
    const result = attemptBacktrackingSchedule(makeAttemptInput(request))

    expect(result.success).toBe(true)

    if (result.success) {
      expect(result.entries).toHaveLength(30)
      expect(
        result.entries.find(
          (entry) =>
            entry.employeeId === 'emp-1' && entry.date === '2026-06-03',
        ),
      ).toMatchObject({ shift: '休' })
    }
  })

  it('attemptBacktrackingSchedule avoids a cross-month late-to-early violation', () => {
    const request = makeRequest({
      employees: [{ ...employees[0], prevMonthLastShift: 'F13' }],
      rules: DEFAULT_RULES.filter((rule) => rule.id === 'R09'),
    })
    const result = attemptBacktrackingSchedule(makeAttemptInput(request))

    expect(result.success).toBe(true)

    if (result.success) {
      expect(
        result.entries.find(
          (entry) =>
            entry.employeeId === 'emp-1' && entry.date === '2026-06-01',
        ),
      ).toMatchObject({ shift: 'F13' })
    }
  })

  it('attemptBacktrackingSchedule reports conflicts that cannot overwrite locked leave', () => {
    const request = makeRequest({
      constraints: [
        {
          employeeId: 'emp-1',
          month: '2026-06',
          forcedDaysOff: ['2026-06-03'],
        },
      ],
      lockedEntries: [makeEntry('emp-1', '2026-06-03', '特')],
      rules: DEFAULT_RULES.filter((rule) => rule.id === 'R01'),
    })

    expect(attemptBacktrackingSchedule(makeAttemptInput(request))).toEqual({
      success: false,
      conflictDates: ['2026-06-03'],
      reason: '無法產生符合目前規則的班表',
    })
  })

  it('attemptBacktrackingSchedule builds a full-month schedule for the default staffing rules', () => {
    const realisticEmployees = makeRealisticEmployees()
    const request = makeRequest({
      employees: realisticEmployees,
      prevFourWeekDate: '2026-05-31',
      cycleCarryIn: realisticEmployees.map((employee) => ({
        employeeId: employee.id,
        reiCount: 0,
        xiuCount: 0,
      })),
      rules: DEFAULT_RULES,
    })
    const result = attemptBacktrackingSchedule(makeAttemptInput(request))

    expect(result.success).toBe(true)

    if (result.success) {
      expect(result.entries).toHaveLength(realisticEmployees.length * 30)
      expect(
        validateRules(
          {
            employees: realisticEmployees,
            month: request.month,
            prevFourWeekDate: request.prevFourWeekDate,
            cycleCarryIn: request.cycleCarryIn,
            specialDays: request.specialDays,
            constraints: request.constraints,
            entries: result.entries,
          },
          DEFAULT_RULES,
        ),
      ).toEqual([])
    }
  })

  it('attemptBacktrackingSchedule handles holiday, store-day, and deep-clean staffing in a full month', () => {
    const realisticEmployees = makeRealisticEmployees()
    const specialDays: ScheduleRequest['specialDays'] = [
      { date: '2026-06-10', type: '假日' },
      { date: '2026-06-16', type: '店務' },
      { date: '2026-06-24', type: '大清' },
    ]
    const request = makeRequest({
      employees: realisticEmployees,
      prevFourWeekDate: '2026-05-31',
      cycleCarryIn: realisticEmployees.map((employee) => ({
        employeeId: employee.id,
        reiCount: 0,
        xiuCount: 0,
      })),
      specialDays,
      rules: DEFAULT_RULES,
    })
    const result = attemptBacktrackingSchedule(makeAttemptInput(request))

    expect(result.success).toBe(true)

    if (result.success) {
      expect(
        validateRules(
          {
            employees: realisticEmployees,
            month: request.month,
            prevFourWeekDate: request.prevFourWeekDate,
            cycleCarryIn: request.cycleCarryIn,
            specialDays,
            constraints: request.constraints,
            entries: result.entries,
          },
          DEFAULT_RULES,
        ),
      ).toEqual([])
      expect(shiftsOn(result.entries, '2026-06-10')).toEqual(
        expect.arrayContaining(['國05', '國13', '國']),
      )
      expect(
        shiftsOn(result.entries, '2026-06-16').filter((shift) => shift === 'A'),
      ).toHaveLength(4)
      expect(
        shiftsOn(result.entries, '2026-06-24').filter((shift) =>
          ['F05', 'F13', 'A', '國05', '國13', '國A'].includes(shift),
        ).length,
      ).toBeGreaterThanOrEqual(8)
    }
  })
})

function makeRequest(
  overrides: Partial<ScheduleRequest> = {},
): ScheduleRequest {
  return {
    employees,
    month: '2026-06',
    prevFourWeekDate: '2026-05-15',
    cycleCarryIn: [],
    specialDays: [],
    constraints: [],
    lockedEntries: [],
    rules: DEFAULT_RULES,
    ...overrides,
  }
}

function makeAttemptInput(request: ScheduleRequest): AttemptScheduleInput {
  return {
    ...request,
    activeRules: request.rules ?? DEFAULT_RULES,
    prefilledEntries: prefillLockedEntries(request),
  }
}

function makeEntry(
  employeeId: string,
  date: ScheduleEntry['date'],
  shift: ScheduleEntry['shift'],
): ScheduleEntry {
  return {
    employeeId,
    date,
    shift,
    isAutoRelaxed: false,
    isManualEdit: false,
  }
}

function shiftsOn(entries: ScheduleEntry[], date: ScheduleEntry['date']) {
  return entries
    .filter((entry) => entry.date === date)
    .map((entry) => entry.shift)
}

function makeRealisticEmployees(): Employee[] {
  return [
    makeEmployee('sup-a', { isSupervisor: true, isVeteran: true }),
    makeEmployee('sup-b', { isSupervisor: true }),
    makeEmployee('sup-c', { isSupervisor: true }),
    makeEmployee('vet-a', { isVeteran: true }),
    makeEmployee('vet-b', { isVeteran: true }),
    makeEmployee('vet-c', { isVeteran: true }),
    makeEmployee('emp-02', { isVeteran: true }),
    makeEmployee('emp-01', { isSupervisor: true }),
    makeEmployee('emp-03', { isVeteran: true }),
    makeEmployee('emp-04'),
    makeEmployee('emp-05'),
    makeEmployee('emp-06'),
    makeEmployee('emp-07'),
    makeEmployee('emp-08'),
  ]
}

function makeEmployee(
  id: string,
  overrides: Partial<Omit<Employee, 'id' | 'name'>> = {},
): Employee {
  return {
    id,
    name: id,
    isSupervisor: false,
    isVeteran: false,
    isPT: false,
    isActive: true,
    prevMonthLastShift: null,
    ...overrides,
  }
}
