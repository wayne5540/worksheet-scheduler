import { describe, expect, it } from 'vitest'

import type { DateString, Employee, ShiftType, SpecialDay } from './model'
import {
  DEFAULT_RULES,
  validateRule,
  type RuleId,
  type RuleValidationInput,
} from './rules'

const employees: Employee[] = [
  makeEmployee('sup-early', { isSupervisor: true, isVeteran: true }),
  makeEmployee('sup-late', { isSupervisor: true }),
  makeEmployee('vet-early', { isVeteran: true }),
  makeEmployee('emp-a'),
  makeEmployee('emp-b'),
  makeEmployee('emp-c'),
  makeEmployee('emp-d'),
  makeEmployee('emp-off'),
]

const defaultShiftByEmployeeId: Record<string, ShiftType> = {
  'sup-early': 'F05',
  'sup-late': 'F13',
  'vet-early': 'F05',
  'emp-a': 'F05',
  'emp-b': 'F13',
  'emp-c': 'F13',
  'emp-d': 'F13',
  'emp-off': '休',
}

describe('rule validators', () => {
  it('defines the R01-R15 default priority order from PLAN.md', () => {
    expect(
      DEFAULT_RULES.map(({ id, name, priority }) => ({ id, name, priority })),
    ).toEqual([
      { id: 'R01', name: '指定休假', priority: 1 },
      { id: 'R02', name: '四周合規', priority: 2 },
      { id: 'R03', name: '主管班別覆蓋', priority: 3 },
      { id: 'R04', name: '主管不兼任', priority: 4 },
      { id: 'R05', name: '主管不同天全休', priority: 5 },
      { id: 'R06', name: '老手早班保障', priority: 6 },
      { id: 'R07', name: '老手不同天全休', priority: 7 },
      { id: 'R08', name: '平日人力', priority: 8 },
      { id: 'R09', name: '晚班隔天禁排早班', priority: 9 },
      { id: 'R10', name: '假日人力', priority: 10 },
      { id: 'R11', name: '店務日班別轉換', priority: 11 },
      { id: 'R12', name: '國定假日「國」分配', priority: 12 },
      { id: 'R13', name: '每週至少一個例假', priority: 13 },
      { id: 'R14', name: '不連續排超過五天', priority: 14 },
      { id: 'R15', name: '大清日人力', priority: 15 },
    ])
  })

  it('R01 requires forced days off to be scheduled as 休', () => {
    const input = makeInput({
      constraints: [
        {
          employeeId: 'sup-early',
          month: '2026-06',
          forcedDaysOff: ['2026-06-03'],
        },
      ],
    })

    expectViolation('R01', input, {
      dates: ['2026-06-03'],
      employeeIds: ['sup-early'],
    })

    expect(
      validateRule(
        'R01',
        makeInput({
          constraints: input.constraints,
          overrides: { '2026-06-03': { 'sup-early': '休' } },
        }),
      ),
    ).toEqual([])
  })

  it('R02 counts 例 and 休 inside each four-week cycle with carry-in', () => {
    const [employee] = employees
    const compliant = makeInput({
      employees: [employee],
      prevFourWeekDate: '2026-05-15',
      cycleCarryIn: [{ employeeId: employee.id, reiCount: 3, xiuCount: 2 }],
      overrides: {
        '2026-06-01': { [employee.id]: '例' },
        '2026-06-02': { [employee.id]: '休' },
        '2026-06-03': { [employee.id]: '休' },
      },
    })

    expect(validateRule('R02', compliant)).toEqual([])

    expectViolation('R02', makeInput({ ...compliant, cycleCarryIn: [] }), {
      dates: ['2026-06-12'],
      employeeIds: [employee.id],
    })
  })

  it('R03 requires supervisor coverage for early and late shifts each day', () => {
    expect(validateRule('R03', makeInput())).toEqual([])

    expectViolation(
      'R03',
      makeInput({ overrides: { '2026-06-03': { 'sup-late': '休' } } }),
      {
        dates: ['2026-06-03'],
      },
    )
  })

  it('R04 rejects one supervisor covering early and late shifts on the same day', () => {
    expectViolation(
      'R04',
      makeInput({
        entries: [
          makeEntry('sup-early', '2026-06-01', 'F05'),
          makeEntry('sup-early', '2026-06-01', 'F13'),
        ],
      }),
      {
        dates: ['2026-06-01'],
        employeeIds: ['sup-early'],
      },
    )
  })

  it('R05 prevents all supervisors from resting on the same day', () => {
    expectViolation(
      'R05',
      makeInput({
        overrides: {
          '2026-06-04': { 'sup-early': '休', 'sup-late': '例' },
        },
      }),
      {
        dates: ['2026-06-04'],
        employeeIds: ['sup-early', 'sup-late'],
      },
    )
  })

  it('R06 requires a veteran on every early shift date', () => {
    expectViolation(
      'R06',
      makeInput({
        overrides: {
          '2026-06-05': { 'sup-early': 'F13', 'vet-early': 'F13' },
        },
      }),
      {
        dates: ['2026-06-05'],
      },
    )
  })

  it('R07 prevents all veterans from resting on the same day', () => {
    expectViolation(
      'R07',
      makeInput({
        overrides: {
          '2026-06-06': { 'sup-early': '休', 'vet-early': '國' },
        },
      }),
      {
        dates: ['2026-06-06'],
        employeeIds: ['sup-early', 'vet-early'],
      },
    )
  })

  it('R08 requires exactly three F05 and four F13 shifts on non-holidays', () => {
    expect(validateRule('R08', makeInput())).toEqual([])

    expectViolation(
      'R08',
      makeInput({ overrides: { '2026-06-02': { 'emp-a': 'F13' } } }),
      {
        dates: ['2026-06-02'],
      },
    )
  })

  it('R08 treats store days as A late coverage and leaves deep-clean staffing to R15', () => {
    expect(
      validateRule(
        'R08',
        makeInput({
          specialDays: [{ date: '2026-06-08', type: '店務' }],
          overrides: {
            '2026-06-08': {
              'sup-late': 'A',
              'emp-b': 'A',
              'emp-c': 'A',
              'emp-d': 'A',
            },
          },
        }),
      ),
    ).toEqual([])

    expect(
      validateRule(
        'R08',
        makeInput({
          specialDays: [{ date: '2026-06-10', type: '大清' }],
          overrides: {
            '2026-06-10': {
              'emp-off': 'F13',
            },
          },
        }),
      ),
    ).toEqual([])
  })

  it('R09 rejects late shift to early shift on the next day, including month start', () => {
    expectViolation(
      'R09',
      makeInput({
        employees: [
          { ...employees[0], prevMonthLastShift: 'F13' },
          ...employees.slice(1),
        ],
      }),
      {
        dates: ['2026-06-01'],
        employeeIds: ['sup-early'],
      },
    )

    expectViolation(
      'R09',
      makeInput({
        overrides: { '2026-06-02': { 'sup-late': 'F05' } },
      }),
      {
        dates: ['2026-06-02'],
        employeeIds: ['sup-late'],
      },
    )
  })

  it('R10 requires holiday staffing and switches late demand to 國A on store holidays', () => {
    expect(
      validateRule(
        'R10',
        makeInput({
          specialDays: [{ date: '2026-06-05', type: '假日' }],
          overrides: holidayOverrides('2026-06-05', '國13'),
        }),
      ),
    ).toEqual([])

    expectViolation(
      'R10',
      makeInput({
        specialDays: [
          { date: '2026-06-05', type: '假日' },
          { date: '2026-06-05', type: '店務' },
        ],
        overrides: holidayOverrides('2026-06-05', '國13'),
      }),
      {
        dates: ['2026-06-05'],
      },
    )
  })

  it('R11 requires store day late shifts to use A or 國A', () => {
    expectViolation(
      'R11',
      makeInput({ specialDays: [{ date: '2026-06-08', type: '店務' }] }),
      {
        dates: ['2026-06-08'],
      },
    )

    expectViolation(
      'R11',
      makeInput({
        specialDays: [
          { date: '2026-06-09', type: '假日' },
          { date: '2026-06-09', type: '店務' },
        ],
        overrides: holidayOverrides('2026-06-09', '國13'),
      }),
      {
        dates: ['2026-06-09'],
      },
    )
  })

  it('R12 requires holiday shifts to carry the 國 prefix except 特 and 公', () => {
    expectViolation(
      'R12',
      makeInput({ specialDays: [{ date: '2026-06-10', type: '假日' }] }),
      {
        dates: ['2026-06-10'],
      },
    )

    expect(
      validateRule(
        'R12',
        makeInput({
          specialDays: [{ date: '2026-06-10', type: '假日' }],
          overrides: {
            '2026-06-10': {
              'sup-early': '國05',
              'sup-late': '國13',
              'vet-early': '國A',
              'emp-a': '國',
              'emp-b': '國',
              'emp-c': '國',
              'emp-d': '特',
              'emp-off': '公',
            },
          },
        }),
      ),
    ).toEqual([])
  })

  it('R13 requires at least one 例 in every natural week segment of the month', () => {
    const [employee] = employees
    const weeklyRei = {
      '2026-06-01': { [employee.id]: '例' },
      '2026-06-08': { [employee.id]: '例' },
      '2026-06-15': { [employee.id]: '例' },
      '2026-06-22': { [employee.id]: '例' },
      '2026-06-29': { [employee.id]: '例' },
    } satisfies ShiftOverrides

    expect(
      validateRule(
        'R13',
        makeInput({ employees: [employee], overrides: weeklyRei }),
      ),
    ).toEqual([])

    expectViolation(
      'R13',
      makeInput({
        employees: [employee],
        overrides: { ...weeklyRei, '2026-06-29': { [employee.id]: 'F05' } },
      }),
      {
        dates: ['2026-06-29', '2026-06-30'],
        employeeIds: [employee.id],
      },
    )
  })

  it('R14 rejects more than five consecutive work shifts', () => {
    const [employee] = employees

    expectViolation('R14', makeInput({ employees: [employee] }), {
      dates: ['2026-06-06'],
      employeeIds: [employee.id],
    })
  })

  it('R15 requires at least eight people working on deep-cleaning days', () => {
    expectViolation(
      'R15',
      makeInput({ specialDays: [{ date: '2026-06-20', type: '大清' }] }),
      {
        dates: ['2026-06-20'],
      },
    )

    expect(
      validateRule(
        'R15',
        makeInput({
          specialDays: [{ date: '2026-06-20', type: '大清' }],
          overrides: { '2026-06-20': { 'emp-off': 'A' } },
        }),
      ),
    ).toEqual([])
  })
})

type ShiftOverrides = Record<DateString, Partial<Record<string, ShiftType>>>

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

function makeInput({
  employees: inputEmployees = employees,
  entries,
  overrides = {},
  specialDays = [],
  constraints = [],
  cycleCarryIn = [],
  prevFourWeekDate = '2026-05-31',
}: {
  employees?: Employee[]
  entries?: RuleValidationInput['entries']
  overrides?: ShiftOverrides
  specialDays?: SpecialDay[]
  constraints?: RuleValidationInput['constraints']
  cycleCarryIn?: RuleValidationInput['cycleCarryIn']
  prevFourWeekDate?: DateString
} = {}): RuleValidationInput {
  return {
    employees: inputEmployees,
    month: '2026-06',
    prevFourWeekDate,
    cycleCarryIn,
    specialDays,
    constraints,
    entries: entries ?? makeEntries(inputEmployees, overrides),
  }
}

function makeEntries(
  inputEmployees: Employee[],
  overrides: ShiftOverrides = {},
): RuleValidationInput['entries'] {
  return datesInJune.flatMap((date) =>
    inputEmployees.map((employee) =>
      makeEntry(
        employee.id,
        date,
        overrides[date]?.[employee.id] ??
          defaultShiftByEmployeeId[employee.id] ??
          'F05',
      ),
    ),
  )
}

function makeEntry(
  employeeId: string,
  date: DateString,
  shift: ShiftType,
): RuleValidationInput['entries'][number] {
  return {
    employeeId,
    date,
    shift,
    isAutoRelaxed: false,
    isManualEdit: false,
  }
}

function expectViolation(
  ruleId: RuleId,
  input: RuleValidationInput,
  expected: {
    dates?: DateString[]
    employeeIds?: string[]
  },
): void {
  expect(validateRule(ruleId, input)).toEqual([
    expect.objectContaining({
      ruleId,
      ...expected,
    }),
  ])
}

function holidayOverrides(
  date: DateString,
  lateShift: '國13' | '國A',
): ShiftOverrides {
  return {
    [date]: {
      'sup-early': '國05',
      'vet-early': '國05',
      'emp-a': '國05',
      'sup-late': lateShift,
      'emp-b': lateShift,
      'emp-c': lateShift,
      'emp-d': lateShift,
      'emp-off': lateShift,
    },
  }
}

const datesInJune = Array.from({ length: 30 }, (_, index) => {
  const day = String(index + 1).padStart(2, '0')

  return `2026-06-${day}` as DateString
})
