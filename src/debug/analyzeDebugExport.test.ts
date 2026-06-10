import { describe, expect, it } from 'vitest'

import type { Employee, MonthlySchedule } from '../domain/model'
import type { StorageDebugExport } from '../persistence/persistence'
import {
  analyzeDebugExport,
  formatDebugAnalysisReport,
} from './analyzeDebugExport'

describe('debug export analysis', () => {
  it('summarizes active rules, relaxed rules, and rule violations by schedule', () => {
    const debugExport = makeDebugExport({
      employees: [
        makeEmployee('sup-1', '主管一', {
          isSupervisor: true,
          isVeteran: true,
        }),
        makeEmployee('sup-2', '主管二', {
          isSupervisor: true,
          isVeteran: true,
        }),
        makeEmployee('staff-1', '員工一'),
        makeEmployee('pt-1', 'PT', { isPT: true }),
      ],
      schedule: {
        month: '2026-07',
        entries: [
          makeEntry('sup-1', '2026-07-01', '休'),
          makeEntry('sup-2', '2026-07-01', 'F13'),
          makeEntry('staff-1', '2026-07-01', 'F05'),
          makeEntry('pt-1', '2026-07-01', 'PT'),
        ],
        relaxedRules: [
          {
            ruleId: 'R03',
            ruleName: '主管班別覆蓋',
            affectedDates: ['2026-07-01'],
          },
        ],
      },
    })

    expect(analyzeDebugExport(debugExport)).toMatchObject({
      schemaVersion: 1,
      exportedAt: '2026-06-10T00:00:00.000Z',
      employeeSummary: {
        total: 4,
        schedulable: 3,
        pt: 1,
        supervisors: 2,
        veterans: 2,
      },
      activeRuleIds: ['R03'],
      schedules: [
        {
          month: '2026-07',
          entryCount: 4,
          relaxedRules: [
            {
              ruleId: 'R03',
              ruleName: '主管班別覆蓋',
              affectedDates: ['2026-07-01'],
            },
          ],
          violations: [
            {
              ruleId: 'R03',
              ruleName: '主管班別覆蓋',
              dates: expect.arrayContaining(['2026-07-01']),
              employeeNames: [],
            },
          ],
        },
      ],
    })
  })

  it('formats a concise terminal report', () => {
    const analysis = analyzeDebugExport(
      makeDebugExport({
        employees: [
          makeEmployee('sup-1', '主管一', {
            isSupervisor: true,
            isVeteran: true,
          }),
        ],
        schedule: {
          month: '2026-07',
          entries: [makeEntry('sup-1', '2026-07-01', '休')],
          relaxedRules: [],
        },
      }),
    )

    expect(formatDebugAnalysisReport(analysis)).toContain(
      'Debug export: 2026-06-10T00:00:00.000Z',
    )
    expect(formatDebugAnalysisReport(analysis)).toContain(
      '2026-07: entries 1, relaxed 0, violations 1',
    )
  })
})

function makeDebugExport({
  employees,
  schedule,
}: {
  employees: Employee[]
  schedule: Pick<MonthlySchedule, 'month' | 'entries' | 'relaxedRules'> &
    Partial<MonthlySchedule>
}): StorageDebugExport {
  return {
    schemaVersion: 1,
    exportedAt: '2026-06-10T00:00:00.000Z',
    localStorage: {
      employees,
      ruleSettings: [
        {
          ruleId: 'R03',
          priority: 1,
          isEnabled: true,
        },
      ],
    },
    indexedDB: {
      scheduleMonths: [schedule.month],
      monthlySchedules: [
        {
          prevFourWeekDate: '2026-06-07',
          cycleCarryIn: [],
          specialDays: [],
          constraints: [],
          ...schedule,
        },
      ],
    },
  }
}

function makeEmployee(
  id: string,
  name: string,
  overrides: Partial<Omit<Employee, 'id' | 'name'>> = {},
): Employee {
  return {
    id,
    name,
    isSupervisor: false,
    isVeteran: false,
    isPT: false,
    isActive: true,
    prevMonthLastShift: null,
    ...overrides,
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
