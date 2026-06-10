export type DateString = `${number}-${number}-${number}`
export type MonthString = `${number}-${number}`

export const SHIFT_TYPES = [
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
] as const

export type ShiftType = (typeof SHIFT_TYPES)[number]

export const WORK_SHIFT_TYPES = [
  'F05',
  'F13',
  'A',
  '國05',
  '國13',
  '國A',
] as const satisfies readonly ShiftType[]

export type WorkShiftType = (typeof WORK_SHIFT_TYPES)[number]

export const HOLIDAY_WORK_SHIFT_TYPES = [
  '國05',
  '國13',
  '國A',
] as const satisfies readonly WorkShiftType[]

export type HolidayWorkShiftType = (typeof HOLIDAY_WORK_SHIFT_TYPES)[number]

export const SPECIAL_DAY_TYPES = ['假日', '店務', '大清', '四周'] as const

export type SpecialDayType = (typeof SPECIAL_DAY_TYPES)[number]

export const MANUAL_SPECIAL_DAY_TYPES = [
  '假日',
  '店務',
  '大清',
] as const satisfies readonly SpecialDayType[]

export type ManualSpecialDayType = (typeof MANUAL_SPECIAL_DAY_TYPES)[number]

export interface Employee {
  id: string
  name: string
  isSupervisor: boolean
  isVeteran: boolean
  isPT: boolean
  isActive: boolean
  prevMonthLastShift: ShiftType | null
}

export interface SpecialDay {
  date: DateString
  type: SpecialDayType
}

export interface PersonalConstraint {
  employeeId: string
  month: MonthString
  forcedDaysOff: DateString[]
}

export interface ScheduleEntry {
  employeeId: string
  date: DateString
  shift: ShiftType
  isAutoRelaxed: boolean
  isManualEdit: boolean
}

export interface CycleCarryIn {
  employeeId: string
  reiCount: number
  xiuCount: number
}

export interface RelaxedRule {
  ruleId: string
  ruleName: string
  affectedDates: DateString[]
}

export interface MonthlySchedule {
  month: MonthString
  prevFourWeekDate: DateString
  cycleCarryIn: CycleCarryIn[]
  specialDays: SpecialDay[]
  constraints: PersonalConstraint[]
  entries: ScheduleEntry[]
  relaxedRules: RelaxedRule[]
}

export function isShiftType(value: string): value is ShiftType {
  return includesString(SHIFT_TYPES, value)
}

export function isManualSpecialDayType(
  value: string,
): value is ManualSpecialDayType {
  return includesString(MANUAL_SPECIAL_DAY_TYPES, value)
}

function includesString<const T extends string>(
  values: readonly T[],
  value: string,
): value is T {
  return values.includes(value as T)
}
