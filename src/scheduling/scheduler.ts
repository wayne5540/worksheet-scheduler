import type {
  CycleCarryIn,
  DateString,
  Employee,
  MonthString,
  MonthlySchedule,
  PersonalConstraint,
  ScheduleEntry,
  SpecialDay,
  ShiftType,
} from '../domain/model'
import {
  DEFAULT_RULES,
  validateRules,
  type RuleDefinition,
} from '../domain/rules'

export interface ScheduleRequest {
  employees: Employee[]
  month: MonthString
  prevFourWeekDate: DateString
  cycleCarryIn: CycleCarryIn[]
  specialDays: SpecialDay[]
  constraints: PersonalConstraint[]
  lockedEntries: ScheduleEntry[]
  rules?: RuleDefinition[]
}

export interface AttemptScheduleInput extends ScheduleRequest {
  activeRules: RuleDefinition[]
  prefilledEntries: ScheduleEntry[]
}

export type AttemptScheduleResult =
  | {
      success: true
      entries: ScheduleEntry[]
    }
  | {
      success: false
      conflictDates: DateString[]
      reason: string
    }

export type AttemptSchedule = (
  input: AttemptScheduleInput,
) => AttemptScheduleResult

export type RelaxedSchedulingResult =
  | {
      success: true
      schedule: MonthlySchedule
    }
  | {
      success: false
      reason: string
      conflictDates: DateString[]
      relaxedRules: MonthlySchedule['relaxedRules']
    }

export function runRelaxedScheduling(
  request: ScheduleRequest,
  attemptSchedule: AttemptSchedule,
): RelaxedSchedulingResult {
  let activeRules = [...(request.rules ?? DEFAULT_RULES)].sort(
    (left, right) => left.priority - right.priority,
  )
  const relaxedRules: MonthlySchedule['relaxedRules'] = []
  const prefilledEntries = prefillLockedEntries(request)

  while (true) {
    const result = attemptSchedule({
      ...request,
      activeRules,
      prefilledEntries,
    })

    if (result.success) {
      return {
        success: true,
        schedule: {
          month: request.month,
          prevFourWeekDate: request.prevFourWeekDate,
          cycleCarryIn: request.cycleCarryIn,
          specialDays: request.specialDays,
          constraints: request.constraints,
          entries: result.entries,
          relaxedRules,
        },
      }
    }

    if (activeRules.length === 0) {
      return {
        success: false,
        reason: result.reason,
        conflictDates: result.conflictDates,
        relaxedRules,
      }
    }

    const droppedRule = activeRules[activeRules.length - 1]

    relaxedRules.push({
      ruleId: droppedRule.id,
      ruleName: droppedRule.name,
      affectedDates: result.conflictDates,
    })
    activeRules = activeRules.slice(0, -1)
  }
}

export function prefillLockedEntries({
  lockedEntries,
  constraints,
}: Pick<ScheduleRequest, 'lockedEntries' | 'constraints'>): ScheduleEntry[] {
  const entries = [...lockedEntries]
  const lockedEntryKeys = new Set(
    lockedEntries.map((entry) => entryKey(entry.employeeId, entry.date)),
  )

  for (const constraint of constraints) {
    for (const date of constraint.forcedDaysOff) {
      const key = entryKey(constraint.employeeId, date)

      if (!lockedEntryKeys.has(key)) {
        entries.push({
          employeeId: constraint.employeeId,
          date,
          shift: '休',
          isAutoRelaxed: false,
          isManualEdit: false,
        })
      }
    }
  }

  return entries
}

export function attemptBacktrackingSchedule(
  input: AttemptScheduleInput,
): AttemptScheduleResult {
  const lockedConflict = findLockedForcedLeaveConflict(input)

  if (lockedConflict.length > 0) {
    return {
      success: false,
      conflictDates: lockedConflict,
      reason: '無法產生符合目前規則的班表',
    }
  }

  const dates = datesInMonth(input.month)
  const schedulableEmployees = input.employees.filter(
    (employee) => employee.isActive && !employee.isPT,
  )
  const entries = [...input.prefilledEntries]
  const cells = schedulableEmployees.flatMap((employee) =>
    dates
      .filter((date) => !hasEntry(entries, employee.id, date))
      .map((date) => ({ employee, date })),
  )
  const solvedEntries = fillCells(input, entries, cells, 0)

  if (solvedEntries) {
    return {
      success: true,
      entries: solvedEntries,
    }
  }

  const violations = validateRules(
    {
      employees: input.employees,
      month: input.month,
      prevFourWeekDate: input.prevFourWeekDate,
      cycleCarryIn: input.cycleCarryIn,
      specialDays: input.specialDays,
      constraints: input.constraints,
      entries,
    },
    input.activeRules,
  )

  return {
    success: false,
    conflictDates: violations.flatMap((violation) => violation.dates),
    reason: '無法產生符合目前規則的班表',
  }
}

function entryKey(employeeId: string, date: DateString): string {
  return `${employeeId}:${date}`
}

function fillCells(
  input: AttemptScheduleInput,
  entries: ScheduleEntry[],
  cells: { employee: Employee; date: DateString }[],
  cellIndex: number,
): ScheduleEntry[] | null {
  if (cellIndex >= cells.length) {
    const violations = validateRules(
      {
        employees: input.employees,
        month: input.month,
        prevFourWeekDate: input.prevFourWeekDate,
        cycleCarryIn: input.cycleCarryIn,
        specialDays: input.specialDays,
        constraints: input.constraints,
        entries,
      },
      input.activeRules,
    )

    return violations.length === 0 ? entries : null
  }

  const cell = cells[cellIndex]

  for (const shift of candidateShifts(
    input,
    entries,
    cell.employee,
    cell.date,
  )) {
    const nextEntries = [
      ...entries,
      {
        employeeId: cell.employee.id,
        date: cell.date,
        shift,
        isAutoRelaxed: false,
        isManualEdit: false,
      },
    ]
    const result = fillCells(input, nextEntries, cells, cellIndex + 1)

    if (result) {
      return result
    }
  }

  return null
}

function candidateShifts(
  input: AttemptScheduleInput,
  entries: ScheduleEntry[],
  employee: Employee,
  date: DateString,
): ShiftType[] {
  const candidates = baseCandidateShifts(input, date)

  if (!hasActiveRule(input, 'R09')) {
    return candidates
  }

  const previousShift = previousShiftFor(input, entries, employee, date)

  if (!isLateShift(previousShift)) {
    return candidates
  }

  return candidates.filter((shift) => !isEarlyShift(shift))
}

function baseCandidateShifts(
  input: AttemptScheduleInput,
  date: DateString,
): ShiftType[] {
  const isHoliday = hasSpecialDay(input, date, '假日')
  const isStoreDay = hasSpecialDay(input, date, '店務')

  if (isHoliday && isStoreDay) {
    return ['國05', '國A', '國', '例', '休']
  }

  if (isHoliday) {
    return ['國05', '國13', '國', '例', '休']
  }

  if (isStoreDay) {
    return ['F05', 'A', '例', '休', 'F13']
  }

  return ['F05', 'F13', 'A', '例', '休']
}

function previousShiftFor(
  input: AttemptScheduleInput,
  entries: ScheduleEntry[],
  employee: Employee,
  date: DateString,
): ShiftType | null | undefined {
  const dates = datesInMonth(input.month)
  const dateIndex = dates.indexOf(date)

  if (dateIndex <= 0) {
    return employee.prevMonthLastShift
  }

  return entries.find(
    (entry) =>
      entry.employeeId === employee.id && entry.date === dates[dateIndex - 1],
  )?.shift
}

function findLockedForcedLeaveConflict(
  input: AttemptScheduleInput,
): DateString[] {
  if (!hasActiveRule(input, 'R01')) {
    return []
  }

  const conflicts: DateString[] = []

  for (const constraint of input.constraints) {
    for (const date of constraint.forcedDaysOff) {
      const lockedEntry = input.lockedEntries.find(
        (entry) =>
          entry.employeeId === constraint.employeeId && entry.date === date,
      )

      if (lockedEntry && lockedEntry.shift !== '休') {
        conflicts.push(date)
      }
    }
  }

  return [...new Set(conflicts)]
}

function hasEntry(
  entries: ScheduleEntry[],
  employeeId: string,
  date: DateString,
): boolean {
  return entries.some(
    (entry) => entry.employeeId === employeeId && entry.date === date,
  )
}

function hasActiveRule(input: AttemptScheduleInput, ruleId: string): boolean {
  return input.activeRules.some((rule) => rule.id === ruleId)
}

function hasSpecialDay(
  input: AttemptScheduleInput,
  date: DateString,
  type: SpecialDay['type'],
): boolean {
  return input.specialDays.some(
    (specialDay) => specialDay.date === date && specialDay.type === type,
  )
}

function isEarlyShift(shift: ShiftType | null | undefined): boolean {
  return shift === 'F05' || shift === '國05'
}

function isLateShift(shift: ShiftType | null | undefined): boolean {
  return shift === 'F13' || shift === 'A' || shift === '國13' || shift === '國A'
}

function datesInMonth(month: MonthString): DateString[] {
  const [year, monthNumber] = month.split('-').map(Number)
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()

  return Array.from({ length: dayCount }, (_, index) => {
    const day = String(index + 1).padStart(2, '0')

    return `${month}-${day}` as DateString
  })
}
