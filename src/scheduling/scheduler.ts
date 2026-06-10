import type {
  CycleCarryIn,
  DateString,
  Employee,
  MonthString,
  MonthlySchedule,
  PersonalConstraint,
  ScheduleEntry,
  SpecialDay,
} from '../domain/model'
import { DEFAULT_RULES, type RuleDefinition } from '../domain/rules'

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

function entryKey(employeeId: string, date: DateString): string {
  return `${employeeId}:${date}`
}
