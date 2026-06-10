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

  if (usesConstructiveStaffing(input)) {
    return attemptConstructiveStaffingSchedule(input)
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

interface StaffingRequirement {
  earlyCount: number
  earlyShift: ShiftType
  lateCount: number
  lateShift: ShiftType
  restShift: ShiftType
}

function attemptConstructiveStaffingSchedule(
  input: AttemptScheduleInput,
): AttemptScheduleResult {
  const dates = datesInMonth(input.month)
  const employees = schedulableEmployees(input)
  const prefilledByKey = new Map(
    input.prefilledEntries.map((entry) => [
      entryKey(entry.employeeId, entry.date),
      entry,
    ]),
  )
  const plannedRestByKey = buildPlannedRestEntries(
    input,
    dates,
    employees,
    prefilledByKey,
  )
  const entries: ScheduleEntry[] = []
  const workCounts = new Map(employees.map((employee) => [employee.id, 0]))
  const earlyCounts = new Map(employees.map((employee) => [employee.id, 0]))
  const lateCounts = new Map(employees.map((employee) => [employee.id, 0]))
  const consecutiveWorkDays = new Map(
    employees.map((employee) => [employee.id, 0]),
  )

  for (const date of dates) {
    const requirement = staffingRequirement(input, date)
    const dayEntries = buildConstructiveDayEntries({
      date,
      employees,
      input,
      prefilledByKey,
      plannedRestByKey,
      previousEntries: entries,
      requirement,
      workCounts,
      earlyCounts,
      lateCounts,
      consecutiveWorkDays,
    })

    if (!dayEntries) {
      return {
        success: false,
        conflictDates: [date],
        reason: '無法產生符合目前規則的班表',
      }
    }

    entries.push(...dayEntries)
    updateWorkCounters({
      date,
      dayEntries,
      employees,
      workCounts,
      earlyCounts,
      lateCounts,
      consecutiveWorkDays,
    })
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

  if (violations.length > 0) {
    return {
      success: false,
      conflictDates: violations.flatMap((violation) => violation.dates),
      reason: '無法產生符合目前規則的班表',
    }
  }

  return {
    success: true,
    entries,
  }
}

function buildConstructiveDayEntries({
  date,
  employees,
  input,
  prefilledByKey,
  plannedRestByKey,
  previousEntries,
  requirement,
  workCounts,
  earlyCounts,
  lateCounts,
  consecutiveWorkDays,
}: {
  date: DateString
  employees: Employee[]
  input: AttemptScheduleInput
  prefilledByKey: Map<string, ScheduleEntry>
  plannedRestByKey: Map<string, ShiftType>
  previousEntries: ScheduleEntry[]
  requirement: StaffingRequirement
  workCounts: Map<string, number>
  earlyCounts: Map<string, number>
  lateCounts: Map<string, number>
  consecutiveWorkDays: Map<string, number>
}): ScheduleEntry[] | null {
  const offIds = new Set<string>()
  const dayEntries = new Map<string, ScheduleEntry>()
  const workSlotCount = requirement.earlyCount + requirement.lateCount
  const offSlotCount = employees.length - workSlotCount

  if (offSlotCount < 0) {
    return null
  }

  for (const employee of employees) {
    const prefilledEntry = prefilledByKey.get(entryKey(employee.id, date))

    if (prefilledEntry) {
      dayEntries.set(employee.id, prefilledEntry)

      if (!isWorkShift(prefilledEntry.shift)) {
        offIds.add(employee.id)
      }
    }
  }

  for (const employee of employees) {
    const key = entryKey(employee.id, date)
    const plannedShift = plannedRestByKey.get(key)

    if (plannedShift && !dayEntries.has(employee.id)) {
      offIds.add(employee.id)
      dayEntries.set(
        employee.id,
        makeGeneratedEntry(employee.id, date, plannedShift),
      )
    }
  }

  if (offIds.size > offSlotCount) {
    return null
  }

  for (const employee of employees
    .filter((candidate) => !offIds.has(candidate.id))
    .sort((left, right) => {
      const consecutiveDelta =
        (consecutiveWorkDays.get(right.id) ?? 0) -
        (consecutiveWorkDays.get(left.id) ?? 0)

      if (consecutiveDelta !== 0) {
        return consecutiveDelta
      }

      const workDelta =
        (workCounts.get(right.id) ?? 0) - (workCounts.get(left.id) ?? 0)

      return workDelta !== 0 ? workDelta : left.id.localeCompare(right.id)
    })) {
    if (offIds.size >= offSlotCount) {
      break
    }

    if (
      dayEntries.has(employee.id) &&
      isWorkShift(dayEntries.get(employee.id)?.shift)
    ) {
      continue
    }

    const nextOffIds = new Set(offIds)

    nextOffIds.add(employee.id)

    if (
      !preservesCoverage({
        date,
        employees,
        input,
        offIds: nextOffIds,
        previousEntries,
        requirement,
      })
    ) {
      continue
    }

    offIds.add(employee.id)
    dayEntries.set(
      employee.id,
      makeGeneratedEntry(employee.id, date, requirement.restShift),
    )
  }

  if (offIds.size !== offSlotCount) {
    return null
  }

  for (const employee of employees) {
    if (offIds.has(employee.id) && !dayEntries.has(employee.id)) {
      dayEntries.set(
        employee.id,
        makeGeneratedEntry(employee.id, date, requirement.restShift),
      )
    }
  }

  const workEntries = assignWorkShifts({
    date,
    dayEntries,
    employees: employees.filter((employee) => !offIds.has(employee.id)),
    input,
    previousEntries,
    requirement,
    earlyCounts,
    lateCounts,
  })

  return workEntries ? [...dayEntries.values()] : null
}

function assignWorkShifts({
  date,
  dayEntries,
  employees,
  input,
  previousEntries,
  requirement,
  earlyCounts,
  lateCounts,
}: {
  date: DateString
  dayEntries: Map<string, ScheduleEntry>
  employees: Employee[]
  input: AttemptScheduleInput
  previousEntries: ScheduleEntry[]
  requirement: StaffingRequirement
  earlyCounts: Map<string, number>
  lateCounts: Map<string, number>
}): ScheduleEntry[] | null {
  const earlyIds = new Set(
    employees
      .filter((employee) => isEarlyShift(dayEntries.get(employee.id)?.shift))
      .map((employee) => employee.id),
  )
  const lateIds = new Set(
    employees
      .filter((employee) => isLateShift(dayEntries.get(employee.id)?.shift))
      .map((employee) => employee.id),
  )

  if (
    earlyIds.size > requirement.earlyCount ||
    lateIds.size > requirement.lateCount ||
    earlyIds.size + lateIds.size >
      employees.filter((employee) => dayEntries.has(employee.id)).length
  ) {
    return null
  }

  const assignEarly = (employee: Employee) => {
    earlyIds.add(employee.id)
    dayEntries.set(
      employee.id,
      makeGeneratedEntry(employee.id, date, requirement.earlyShift),
    )
  }
  const assignLate = (employee: Employee) => {
    lateIds.add(employee.id)
    dayEntries.set(
      employee.id,
      makeGeneratedEntry(employee.id, date, requirement.lateShift),
    )
  }
  const canAssignEarly = (employee: Employee) =>
    !earlyIds.has(employee.id) &&
    !lateIds.has(employee.id) &&
    !isLateShift(previousShiftFor(input, previousEntries, employee, date))
  const canAssignLate = (employee: Employee) =>
    !earlyIds.has(employee.id) && !lateIds.has(employee.id)

  if (
    hasActiveRule(input, 'R03') &&
    !employees.some(
      (employee) => employee.isSupervisor && earlyIds.has(employee.id),
    )
  ) {
    const supervisor = bestCandidate(
      employees.filter(
        (employee) => employee.isSupervisor && canAssignEarly(employee),
      ),
      earlyCounts,
    )

    if (!supervisor) {
      return null
    }

    assignEarly(supervisor)
  }

  if (
    hasActiveRule(input, 'R06') &&
    !employees.some(
      (employee) => employee.isVeteran && earlyIds.has(employee.id),
    )
  ) {
    const veteran = bestCandidate(
      employees.filter(
        (employee) => employee.isVeteran && canAssignEarly(employee),
      ),
      earlyCounts,
    )

    if (!veteran) {
      return null
    }

    assignEarly(veteran)
  }

  while (earlyIds.size < requirement.earlyCount) {
    const employee = bestCandidate(
      employees.filter(canAssignEarly),
      earlyCounts,
    )

    if (!employee) {
      return null
    }

    assignEarly(employee)
  }

  if (
    hasActiveRule(input, 'R03') &&
    !employees.some(
      (employee) => employee.isSupervisor && lateIds.has(employee.id),
    )
  ) {
    const supervisor = bestCandidate(
      employees.filter(
        (employee) => employee.isSupervisor && canAssignLate(employee),
      ),
      lateCounts,
    )

    if (!supervisor) {
      return null
    }

    assignLate(supervisor)
  }

  while (lateIds.size < requirement.lateCount) {
    const employee = bestCandidate(employees.filter(canAssignLate), lateCounts)

    if (!employee) {
      return null
    }

    assignLate(employee)
  }

  const entries: ScheduleEntry[] = []

  for (const employee of employees) {
    const entry = dayEntries.get(employee.id)

    if (!entry) {
      return null
    }

    entries.push(entry)
  }

  return entries
}

function buildPlannedRestEntries(
  input: AttemptScheduleInput,
  dates: DateString[],
  employees: Employee[],
  prefilledByKey: Map<string, ScheduleEntry>,
): Map<string, ShiftType> {
  const plannedRestByKey = new Map<string, ShiftType>()

  for (const weekDates of naturalWeekSegments(dates)) {
    const restEligibleDates = weekDates.filter(
      (date) => !hasSpecialDay(input, date, '假日'),
    )

    if (restEligibleDates.length === 0) {
      continue
    }

    for (const [index, employee] of employees.entries()) {
      if (hasActiveRule(input, 'R13')) {
        setPlannedRest(
          plannedRestByKey,
          prefilledByKey,
          employee.id,
          restEligibleDates[index % restEligibleDates.length],
          '例',
        )
      }

      if (hasActiveRule(input, 'R02') && restEligibleDates.length >= 6) {
        setPlannedRest(
          plannedRestByKey,
          prefilledByKey,
          employee.id,
          restEligibleDates[(index + 3) % restEligibleDates.length],
          '休',
        )
      }
    }
  }

  return plannedRestByKey
}

function setPlannedRest(
  plannedRestByKey: Map<string, ShiftType>,
  prefilledByKey: Map<string, ScheduleEntry>,
  employeeId: string,
  date: DateString,
  shift: ShiftType,
) {
  const key = entryKey(employeeId, date)

  if (!prefilledByKey.has(key) && !plannedRestByKey.has(key)) {
    plannedRestByKey.set(key, shift)
  }
}

function staffingRequirement(
  input: AttemptScheduleInput,
  date: DateString,
): StaffingRequirement {
  const isHoliday = hasSpecialDay(input, date, '假日')
  const isStoreDay = hasSpecialDay(input, date, '店務')
  const isDeepCleanDay = hasSpecialDay(input, date, '大清')

  if (isHoliday) {
    return {
      earlyCount: 3,
      earlyShift: '國05',
      lateCount: 5,
      lateShift: isStoreDay ? '國A' : '國13',
      restShift: '國',
    }
  }

  return {
    earlyCount: 3,
    earlyShift: 'F05',
    lateCount: isDeepCleanDay ? 5 : 4,
    lateShift: isStoreDay ? 'A' : 'F13',
    restShift: '休',
  }
}

function preservesCoverage({
  date,
  employees,
  input,
  offIds,
  previousEntries,
  requirement,
}: {
  date: DateString
  employees: Employee[]
  input: AttemptScheduleInput
  offIds: Set<string>
  previousEntries: ScheduleEntry[]
  requirement: StaffingRequirement
}): boolean {
  const workingEmployees = employees.filter(
    (employee) => !offIds.has(employee.id),
  )
  const earlyEligibleEmployees = workingEmployees.filter(
    (employee) =>
      !isLateShift(previousShiftFor(input, previousEntries, employee, date)),
  )

  if (earlyEligibleEmployees.length < requirement.earlyCount) {
    return false
  }

  if (
    hasActiveRule(input, 'R03') &&
    workingEmployees.filter((employee) => employee.isSupervisor).length < 2
  ) {
    return false
  }

  if (
    hasActiveRule(input, 'R03') &&
    !earlyEligibleEmployees.some((employee) => employee.isSupervisor)
  ) {
    return false
  }

  if (
    hasActiveRule(input, 'R06') &&
    !earlyEligibleEmployees.some((employee) => employee.isVeteran)
  ) {
    return false
  }

  return true
}

function updateWorkCounters({
  date,
  dayEntries,
  employees,
  workCounts,
  earlyCounts,
  lateCounts,
  consecutiveWorkDays,
}: {
  date: DateString
  dayEntries: ScheduleEntry[]
  employees: Employee[]
  workCounts: Map<string, number>
  earlyCounts: Map<string, number>
  lateCounts: Map<string, number>
  consecutiveWorkDays: Map<string, number>
}) {
  for (const employee of employees) {
    const shift = dayEntries.find(
      (entry) => entry.employeeId === employee.id && entry.date === date,
    )?.shift

    if (isWorkShift(shift)) {
      workCounts.set(employee.id, (workCounts.get(employee.id) ?? 0) + 1)
      consecutiveWorkDays.set(
        employee.id,
        (consecutiveWorkDays.get(employee.id) ?? 0) + 1,
      )
    } else {
      consecutiveWorkDays.set(employee.id, 0)
    }

    if (isEarlyShift(shift)) {
      earlyCounts.set(employee.id, (earlyCounts.get(employee.id) ?? 0) + 1)
    }

    if (isLateShift(shift)) {
      lateCounts.set(employee.id, (lateCounts.get(employee.id) ?? 0) + 1)
    }
  }
}

function bestCandidate(
  candidates: Employee[],
  assignmentCounts: Map<string, number>,
): Employee | undefined {
  return [...candidates].sort((left, right) => {
    const assignmentDelta =
      (assignmentCounts.get(left.id) ?? 0) -
      (assignmentCounts.get(right.id) ?? 0)

    return assignmentDelta !== 0
      ? assignmentDelta
      : left.id.localeCompare(right.id)
  })[0]
}

function makeGeneratedEntry(
  employeeId: string,
  date: DateString,
  shift: ShiftType,
): ScheduleEntry {
  return {
    employeeId,
    date,
    shift,
    isAutoRelaxed: false,
    isManualEdit: false,
  }
}

function schedulableEmployees(input: AttemptScheduleInput): Employee[] {
  return input.employees.filter(
    (employee) => employee.isActive && !employee.isPT,
  )
}

function usesConstructiveStaffing(input: AttemptScheduleInput): boolean {
  return input.activeRules.some((rule) =>
    [
      'R02',
      'R03',
      'R04',
      'R05',
      'R06',
      'R07',
      'R08',
      'R10',
      'R11',
      'R12',
      'R13',
      'R14',
      'R15',
    ].includes(rule.id),
  )
}

function naturalWeekSegments(dates: DateString[]): DateString[][] {
  const segments: DateString[][] = []
  let currentSegment: DateString[] = []

  for (const date of dates) {
    currentSegment.push(date)

    if (dayOfWeek(date) === 0) {
      segments.push(currentSegment)
      currentSegment = []
    }
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment)
  }

  return segments
}

function dayOfWeek(date: DateString): number {
  const [year, month, day] = date.split('-').map(Number)

  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function isWorkShift(shift: ShiftType | null | undefined): boolean {
  return (
    shift === 'F05' ||
    shift === 'F13' ||
    shift === 'A' ||
    shift === '國05' ||
    shift === '國13' ||
    shift === '國A'
  )
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
