import { describe, expect, it, vi } from 'vitest'

import type { Employee, ScheduleEntry } from '../domain/model'
import { DEFAULT_RULES } from '../domain/rules'
import {
  prefillLockedEntries,
  runRelaxedScheduling,
  type AttemptSchedule,
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
