import { buildFourWeekCycles } from './fourWeekCycle'
import type {
  CycleCarryIn,
  DateString,
  Employee,
  MonthString,
  PersonalConstraint,
  ScheduleEntry,
  ShiftType,
  SpecialDay,
} from './model'

export type RuleId =
  | 'R01'
  | 'R02'
  | 'R03'
  | 'R04'
  | 'R05'
  | 'R06'
  | 'R07'
  | 'R08'
  | 'R09'
  | 'R10'
  | 'R11'
  | 'R12'
  | 'R13'
  | 'R14'
  | 'R15'

export interface RuleValidationInput {
  employees: Employee[]
  month: MonthString
  prevFourWeekDate: DateString
  cycleCarryIn: CycleCarryIn[]
  specialDays: SpecialDay[]
  constraints: PersonalConstraint[]
  entries: ScheduleEntry[]
}

export interface RuleViolation {
  ruleId: RuleId
  ruleName: string
  message: string
  dates: DateString[]
  employeeIds: string[]
}

export interface RuleDefinition {
  id: RuleId
  name: string
  priority: number
  description: string
  validate: (input: RuleValidationInput) => RuleViolation[]
}

interface RuleDraftViolation {
  dates: DateString[]
  employeeIds?: string[]
  message: string
}

const EARLY_SHIFTS = ['F05', '國05'] as const satisfies readonly ShiftType[]
const LATE_SHIFTS = [
  'F13',
  'A',
  '國13',
  '國A',
] as const satisfies readonly ShiftType[]
const REST_SHIFTS = ['休', '例', '國'] as const satisfies readonly ShiftType[]
const HOLIDAY_SHIFTS = [
  '國',
  '國05',
  '國13',
  '國A',
] as const satisfies readonly ShiftType[]
const LOCKED_LEAVE_SHIFTS = ['特', '公'] as const satisfies readonly ShiftType[]
const WORK_SHIFTS = [
  'F05',
  'F13',
  'A',
  '國05',
  '國13',
  '國A',
] as const satisfies readonly ShiftType[]

export const DEFAULT_RULES: RuleDefinition[] = [
  rule('R01', '指定休假', 1, '指定休假日必須排入休假班別。', validateR01),
  rule(
    'R02',
    '四周合規',
    2,
    '每個四週週期內，每位啟用員工至少有四個例假與四個休假。',
    validateR02,
  ),
  rule(
    'R03',
    '主管班別覆蓋',
    3,
    '每天必須有一名主管早班與一名主管晚班。',
    validateR03,
  ),
  rule('R04', '主管不兼任', 4, '主管早班與晚班不得由同一人兼任。', validateR04),
  rule('R05', '主管不同天全休', 5, '同一天不得所有主管都休假。', validateR05),
  rule('R06', '老手早班保障', 6, '每天早班至少需要一名老手。', validateR06),
  rule('R07', '老手不同天全休', 7, '同一天不得所有老手都休假。', validateR07),
  rule(
    'R08',
    '平日人力',
    8,
    '平日每天需恰好三名 F05 與四名 F13；店務日以 A 取代 F13。',
    validateR08,
  ),
  rule(
    'R09',
    '晚班隔天禁排早班',
    9,
    '前一天為晚班者，隔天不得排早班，含月初跨月判斷。',
    validateR09,
  ),
  rule(
    'R10',
    '假日人力',
    10,
    '假日每天需恰好三名國05與五名假日晚班。',
    validateR10,
  ),
  rule(
    'R11',
    '店務日班別轉換',
    11,
    '店務日 F13 需轉為 A；假日店務日國13需轉為國A。',
    validateR11,
  ),
  rule(
    'R12',
    '國定假日「國」分配',
    12,
    '假日班別必須使用國定假日班別，特與公不受此規則約束。',
    validateR12,
  ),
  rule(
    'R13',
    '每週至少一個例假',
    13,
    '每個自然週內，每位啟用員工至少有一個例假。',
    validateR13,
  ),
  rule(
    'R14',
    '不連續排超過五天',
    14,
    '每位員工連續上班天數不可超過五天。',
    validateR14,
  ),
  rule(
    'R15',
    '大清日人力',
    15,
    '大清日至少八人上班，多餘人員優先安排晚班。',
    validateR15,
  ),
]

export function validateRule(
  ruleId: RuleId,
  input: RuleValidationInput,
): RuleViolation[] {
  const definition = DEFAULT_RULES.find((candidate) => candidate.id === ruleId)

  if (!definition) {
    throw new Error(`Unknown rule: ${ruleId}`)
  }

  return definition.validate(input)
}

export function validateRules(
  input: RuleValidationInput,
  rules: RuleDefinition[] = DEFAULT_RULES,
): RuleViolation[] {
  return rules.flatMap((definition) => definition.validate(input))
}

function rule(
  id: RuleId,
  name: string,
  priority: number,
  description: string,
  validate: RuleDefinition['validate'],
): RuleDefinition {
  return { id, name, priority, description, validate }
}

function validateR01(input: RuleValidationInput): RuleViolation[] {
  const dates: DateString[] = []
  const employeeIds: string[] = []

  for (const constraint of input.constraints) {
    for (const date of constraint.forcedDaysOff) {
      if (getShift(input, date, constraint.employeeId) !== '休') {
        dates.push(date)
        employeeIds.push(constraint.employeeId)
      }
    }
  }

  return violation('R01', {
    dates,
    employeeIds,
    message: '指定休假日必須排入休',
  })
}

function validateR02(input: RuleValidationInput): RuleViolation[] {
  const dates: DateString[] = []
  const employeeIds: string[] = []
  const carryInByEmployeeId = new Map(
    input.cycleCarryIn.map((carryIn) => [carryIn.employeeId, carryIn]),
  )

  for (const cycle of buildFourWeekCycles(
    input.month,
    input.prevFourWeekDate,
  )) {
    for (const employee of schedulableEmployees(input)) {
      const carryIn = cycle.requiresCarryIn
        ? carryInByEmployeeId.get(employee.id)
        : undefined
      let reiCount = carryIn?.reiCount ?? 0
      let xiuCount = carryIn?.xiuCount ?? 0

      for (const date of datesBetween(
        cycle.currentMonthStartDate,
        cycle.currentMonthEndDate,
      )) {
        const shift = getShift(input, date, employee.id)

        if (shift === '例') {
          reiCount += 1
        }

        if (shift === '休') {
          xiuCount += 1
        }
      }

      if (reiCount < 4 || xiuCount < 4) {
        dates.push(cycle.nodeDate)
        employeeIds.push(employee.id)
      }
    }
  }

  return violation('R02', {
    dates,
    employeeIds,
    message: '四週週期內例假與休假皆需至少四天',
  })
}

function validateR03(input: RuleValidationInput): RuleViolation[] {
  const dates = datesInMonth(input.month).filter((date) => {
    const supervisorIds = schedulableEmployees(input)
      .filter((employee) => employee.isSupervisor)
      .map((employee) => employee.id)
    const hasEarlySupervisor = supervisorIds.some((employeeId) =>
      isEarlyShift(getShift(input, date, employeeId)),
    )
    const hasLateSupervisor = supervisorIds.some((employeeId) =>
      isLateShift(getShift(input, date, employeeId)),
    )

    return !hasEarlySupervisor || !hasLateSupervisor
  })

  return violation('R03', {
    dates,
    message: '每天需有主管早班與主管晚班',
  })
}

function validateR04(input: RuleValidationInput): RuleViolation[] {
  const dates: DateString[] = []
  const employeeIds: string[] = []

  for (const date of datesInMonth(input.month)) {
    for (const employee of schedulableEmployees(input).filter(
      (candidate) => candidate.isSupervisor,
    )) {
      const shifts = getShifts(input, date, employee.id)

      if (shifts.some(isEarlyShift) && shifts.some(isLateShift)) {
        dates.push(date)
        employeeIds.push(employee.id)
      }
    }
  }

  return violation('R04', {
    dates,
    employeeIds,
    message: '主管早晚班不得由同一人兼任',
  })
}

function validateR05(input: RuleValidationInput): RuleViolation[] {
  const supervisors = schedulableEmployees(input).filter(
    (employee) => employee.isSupervisor,
  )
  const dates = datesInMonth(input.month).filter(
    (date) =>
      supervisors.length > 0 &&
      supervisors.every((employee) =>
        isRestShift(getShift(input, date, employee.id)),
      ),
  )

  return violation('R05', {
    dates,
    employeeIds:
      dates.length > 0 ? supervisors.map((employee) => employee.id) : [],
    message: '主管不得同一天全休',
  })
}

function validateR06(input: RuleValidationInput): RuleViolation[] {
  const veterans = schedulableEmployees(input).filter(
    (employee) => employee.isVeteran,
  )
  const dates = datesInMonth(input.month).filter(
    (date) =>
      !veterans.some((employee) =>
        isEarlyShift(getShift(input, date, employee.id)),
      ),
  )

  return violation('R06', {
    dates,
    message: '每天早班至少需要一名老手',
  })
}

function validateR07(input: RuleValidationInput): RuleViolation[] {
  const veterans = schedulableEmployees(input).filter(
    (employee) => employee.isVeteran,
  )
  const dates = datesInMonth(input.month).filter(
    (date) =>
      veterans.length > 0 &&
      veterans.every((employee) =>
        isRestShift(getShift(input, date, employee.id)),
      ),
  )

  return violation('R07', {
    dates,
    employeeIds:
      dates.length > 0 ? veterans.map((employee) => employee.id) : [],
    message: '老手不得同一天全休',
  })
}

function validateR08(input: RuleValidationInput): RuleViolation[] {
  const holidayDates = specialDayDateSet(input, '假日')
  const storeDates = specialDayDateSet(input, '店務')
  const deepCleanDates = specialDayDateSet(input, '大清')
  const dates = datesInMonth(input.month).filter((date) => {
    if (holidayDates.has(date) || deepCleanDates.has(date)) {
      return false
    }

    const requiredLateShift: ShiftType = storeDates.has(date) ? 'A' : 'F13'

    return (
      countShifts(input, date, (shift) => shift === 'F05') !== 3 ||
      countShifts(input, date, (shift) => shift === requiredLateShift) !== 4
    )
  })

  return violation('R08', {
    dates,
    message: '平日需恰好三名 F05 與四名 F13',
  })
}

function validateR09(input: RuleValidationInput): RuleViolation[] {
  const dates = datesInMonth(input.month)
  const violationDates: DateString[] = []
  const employeeIds: string[] = []

  for (const employee of schedulableEmployees(input)) {
    for (const [index, date] of dates.entries()) {
      const previousShift =
        index === 0
          ? employee.prevMonthLastShift
          : getShift(input, dates[index - 1], employee.id)
      const currentShift = getShift(input, date, employee.id)

      if (isLateShift(previousShift) && isEarlyShift(currentShift)) {
        violationDates.push(date)
        employeeIds.push(employee.id)
      }
    }
  }

  return violation('R09', {
    dates: violationDates,
    employeeIds,
    message: '晚班隔天不得排早班',
  })
}

function validateR10(input: RuleValidationInput): RuleViolation[] {
  const storeDates = specialDayDateSet(input, '店務')
  const dates = [...specialDayDateSet(input, '假日')].filter((date) => {
    const requiredLateShift = storeDates.has(date) ? '國A' : '國13'

    return (
      countShifts(input, date, (shift) => shift === '國05') !== 3 ||
      countShifts(input, date, (shift) => shift === requiredLateShift) !== 5
    )
  })

  return violation('R10', {
    dates,
    message: '假日需恰好三名國05與五名假日晚班',
  })
}

function validateR11(input: RuleValidationInput): RuleViolation[] {
  const holidayDates = specialDayDateSet(input, '假日')
  const dates = [...specialDayDateSet(input, '店務')].filter((date) => {
    const forbiddenShift: ShiftType = holidayDates.has(date) ? '國13' : 'F13'

    return countShifts(input, date, (shift) => shift === forbiddenShift) > 0
  })

  return violation('R11', {
    dates,
    message: '店務日晚班需轉為 A 或 國A',
  })
}

function validateR12(input: RuleValidationInput): RuleViolation[] {
  const dates: DateString[] = []
  const employeeIds: string[] = []

  for (const date of specialDayDateSet(input, '假日')) {
    for (const employee of schedulableEmployees(input)) {
      const shift = getShift(input, date, employee.id)

      if (isLockedLeaveShift(shift)) {
        continue
      }

      if (!isHolidayShift(shift)) {
        dates.push(date)
        employeeIds.push(employee.id)
      }
    }
  }

  return violation('R12', {
    dates,
    employeeIds,
    message: '假日班別需使用國定假日班別',
  })
}

function validateR13(input: RuleValidationInput): RuleViolation[] {
  const dates: DateString[] = []
  const employeeIds: string[] = []

  for (const employee of schedulableEmployees(input)) {
    for (const weekDates of naturalWeekSegments(input.month)) {
      const hasRei = weekDates.some(
        (date) => getShift(input, date, employee.id) === '例',
      )

      if (!hasRei) {
        dates.push(...weekDates)
        employeeIds.push(employee.id)
      }
    }
  }

  return violation('R13', {
    dates,
    employeeIds,
    message: '每個自然週至少需有一個例假',
  })
}

function validateR14(input: RuleValidationInput): RuleViolation[] {
  const dates: DateString[] = []
  const employeeIds: string[] = []

  for (const employee of schedulableEmployees(input)) {
    let consecutiveWorkDays = 0

    for (const date of datesInMonth(input.month)) {
      if (isWorkShift(getShift(input, date, employee.id))) {
        consecutiveWorkDays += 1

        if (consecutiveWorkDays === 6) {
          dates.push(date)
          employeeIds.push(employee.id)
        }
      } else {
        consecutiveWorkDays = 0
      }
    }
  }

  return violation('R14', {
    dates,
    employeeIds,
    message: '不可連續上班超過五天',
  })
}

function validateR15(input: RuleValidationInput): RuleViolation[] {
  const dates = [...specialDayDateSet(input, '大清')].filter(
    (date) => countShifts(input, date, isWorkShift) < 8,
  )

  return violation('R15', {
    dates,
    message: '大清日至少需要八人上班',
  })
}

function violation(ruleId: RuleId, draft: RuleDraftViolation): RuleViolation[] {
  const dates = unique(draft.dates)

  if (dates.length === 0) {
    return []
  }

  return [
    {
      ruleId,
      ruleName: ruleName(ruleId),
      message: draft.message,
      dates,
      employeeIds: unique(draft.employeeIds ?? []),
    },
  ]
}

function ruleName(ruleId: RuleId): string {
  return (
    DEFAULT_RULES.find((definition) => definition.id === ruleId)?.name ?? ruleId
  )
}

function schedulableEmployees(input: RuleValidationInput): Employee[] {
  return input.employees.filter(
    (employee) => employee.isActive && !employee.isPT,
  )
}

function getShift(
  input: RuleValidationInput,
  date: DateString,
  employeeId: string,
): ShiftType | undefined {
  return getShifts(input, date, employeeId)[0]
}

function getShifts(
  input: RuleValidationInput,
  date: DateString,
  employeeId: string,
): ShiftType[] {
  return input.entries
    .filter((entry) => entry.date === date && entry.employeeId === employeeId)
    .map((entry) => entry.shift)
}

function countShifts(
  input: RuleValidationInput,
  date: DateString,
  predicate: (shift: ShiftType | undefined) => boolean,
): number {
  return schedulableEmployees(input).filter((employee) =>
    predicate(getShift(input, date, employee.id)),
  ).length
}

function specialDayDateSet(
  input: RuleValidationInput,
  type: SpecialDay['type'],
): Set<DateString> {
  return new Set(
    input.specialDays
      .filter((specialDay) => specialDay.type === type)
      .map((specialDay) => specialDay.date),
  )
}

function isEarlyShift(shift: ShiftType | null | undefined): boolean {
  return includesShift(EARLY_SHIFTS, shift)
}

function isLateShift(shift: ShiftType | null | undefined): boolean {
  return includesShift(LATE_SHIFTS, shift)
}

function isRestShift(shift: ShiftType | null | undefined): boolean {
  return includesShift(REST_SHIFTS, shift)
}

function isHolidayShift(shift: ShiftType | null | undefined): boolean {
  return includesShift(HOLIDAY_SHIFTS, shift)
}

function isLockedLeaveShift(shift: ShiftType | null | undefined): boolean {
  return includesShift(LOCKED_LEAVE_SHIFTS, shift)
}

function isWorkShift(shift: ShiftType | null | undefined): boolean {
  return includesShift(WORK_SHIFTS, shift)
}

function includesShift<const T extends ShiftType>(
  shifts: readonly T[],
  shift: ShiftType | null | undefined,
): shift is T {
  return shift !== null && shift !== undefined && shifts.includes(shift as T)
}

function datesInMonth(month: MonthString): DateString[] {
  const [year, monthNumber] = parseYearMonth(month)
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()

  return Array.from({ length: dayCount }, (_, index) =>
    formatDate(new Date(Date.UTC(year, monthNumber - 1, index + 1))),
  )
}

function datesBetween(
  startDate: DateString,
  endDate: DateString,
): DateString[] {
  const dates: DateString[] = []
  let cursor = parseDate(startDate)
  const end = parseDate(endDate)

  while (cursor.getTime() <= end.getTime()) {
    dates.push(formatDate(cursor))
    cursor = addDays(cursor, 1)
  }

  return dates
}

function naturalWeekSegments(month: MonthString): DateString[][] {
  const dates = datesInMonth(month)
  const segments: DateString[][] = []
  let currentSegment: DateString[] = []

  for (const date of dates) {
    currentSegment.push(date)

    if (parseDate(date).getUTCDay() === 0) {
      segments.push(currentSegment)
      currentSegment = []
    }
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment)
  }

  return segments
}

function parseYearMonth(month: MonthString): [number, number] {
  const match = /^(\d{4})-(\d{2})$/.exec(month)

  if (!match) {
    throw new Error(`Invalid month: ${month}`)
  }

  return [Number(match[1]), Number(match[2])]
}

function parseDate(dateString: DateString): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString)

  if (!match) {
    throw new Error(`Invalid date: ${dateString}`)
  }

  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  )
}

function addDays(date: Date, days: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + days,
    ),
  )
}

function formatDate(date: Date): DateString {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}` as DateString
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
