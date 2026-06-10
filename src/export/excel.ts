import writeExcelFile from 'write-excel-file/browser'
import type { SheetData } from 'write-excel-file/browser'

import type {
  DateString,
  Employee,
  MonthString,
  MonthlySchedule,
  ScheduleEntry,
  ShiftType,
} from '../domain/model'

export const STAT_COLUMN_LABELS = [
  '未排天數',
  '實際休假天數',
  '預計休假天數',
  '4周內休假天數',
  '例',
  '休',
  '指',
] as const

export interface ScheduleWorkbook {
  fileName: string
  sheetName: string
  rows: SheetData
}

interface DailyStats {
  f05Count: number
  f13Count: number
  aCount: number
  workCount: number
  demandLabel: string
  isQualified: boolean
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const
const REST_SHIFTS = ['休', '例', '國'] as const satisfies readonly ShiftType[]
const WORK_SHIFTS = [
  'F05',
  'F13',
  'A',
  '國05',
  '國13',
  '國A',
] as const satisfies readonly ShiftType[]

export function buildScheduleWorkbook(
  schedule: MonthlySchedule,
  employees: Employee[],
): ScheduleWorkbook {
  const dates = datesInMonth(schedule.month)
  const title = formatScheduleTitle(schedule.month)
  const specialDayMarkers = buildSpecialDayMarkers(schedule)
  const rows: SheetData = [
    ['', '', '', ...dates.map((date) => specialDayMarkers.get(date) ?? '')],
    [
      '員工姓名',
      '角色',
      '前一個月',
      ...dates.map(parseDate),
      ...STAT_COLUMN_LABELS,
    ],
    [
      '',
      '',
      '',
      ...dates.map((date) => WEEKDAY_LABELS[parseDate(date).getUTCDay()]),
    ],
    ...employees.map((employee) => buildEmployeeRow(schedule, employee, dates)),
    ...buildBottomRows(schedule, employees, dates),
  ]

  return {
    fileName: `${title}.xlsx`,
    sheetName: title,
    rows,
  }
}

export async function createScheduleWorkbookBlob(
  workbook: ScheduleWorkbook,
): Promise<Blob> {
  return writeExcelFile([
    {
      sheet: workbook.sheetName,
      data: workbook.rows,
      dateFormat: 'yyyy/mm/dd',
    },
  ]).toBlob()
}

function buildEmployeeRow(
  schedule: MonthlySchedule,
  employee: Employee,
  dates: DateString[],
): SheetData[number] {
  const shifts = dates.map(
    (date) => getShift(schedule.entries, employee.id, date) ?? '',
  )

  return [
    employee.name,
    roleCode(employee),
    employee.prevMonthLastShift ?? '',
    ...shifts,
    ...buildEmployeeStatCells(schedule, employee, dates),
  ]
}

function buildEmployeeStatCells(
  schedule: MonthlySchedule,
  employee: Employee,
  dates: DateString[],
): number[] {
  const shifts = dates.map((date) =>
    getShift(schedule.entries, employee.id, date),
  )
  const forcedDaysOffCount = schedule.constraints
    .filter((constraint) => constraint.employeeId === employee.id)
    .reduce((total, constraint) => total + constraint.forcedDaysOff.length, 0)
  const carryIn = schedule.cycleCarryIn.find(
    (candidate) => candidate.employeeId === employee.id,
  )
  const reiCount = shifts.filter((shift) => shift === '例').length
  const xiuCount = shifts.filter((shift) => shift === '休').length
  const actualRestCount = shifts.filter(isRestShift).length
  const missingCount = shifts.filter((shift) => shift === undefined).length
  const fourWeekRestCount =
    (carryIn?.reiCount ?? 0) + (carryIn?.xiuCount ?? 0) + reiCount + xiuCount

  return [
    missingCount,
    actualRestCount,
    forcedDaysOffCount,
    fourWeekRestCount,
    reiCount,
    xiuCount,
    forcedDaysOffCount,
  ]
}

function buildBottomRows(
  schedule: MonthlySchedule,
  employees: Employee[],
  dates: DateString[],
): SheetData {
  const dailyStats = dates.map((date) =>
    buildDailyStats(schedule, employees, date),
  )

  return [
    ['F05 班人數', '', '', ...dailyStats.map((stats) => stats.f05Count)],
    ['F13 班人數', '', '', ...dailyStats.map((stats) => stats.f13Count)],
    ['A 班人數', '', '', ...dailyStats.map((stats) => stats.aCount)],
    ['總人數', '', '', ...dailyStats.map((stats) => stats.workCount)],
    [
      '排班結果',
      '',
      '',
      ...dailyStats.map(
        (stats) =>
          `${stats.f05Count}F05 0F01 ${stats.f13Count}F13 ${stats.aCount}A`,
      ),
    ],
    ['上班需要人力', '', '', ...dailyStats.map((stats) => stats.demandLabel)],
    [
      '檢定結果',
      '',
      '',
      ...dailyStats.map((stats) => (stats.isQualified ? 'A' : 'B')),
    ],
  ]
}

function buildDailyStats(
  schedule: MonthlySchedule,
  employees: Employee[],
  date: DateString,
): DailyStats {
  const shifts = employees
    .filter((employee) => employee.isActive && !employee.isPT)
    .map((employee) => getShift(schedule.entries, employee.id, date))
  const f05Count = shifts.filter(
    (shift) => shift === 'F05' || shift === '國05',
  ).length
  const f13Count = shifts.filter(
    (shift) => shift === 'F13' || shift === '國13',
  ).length
  const aCount = shifts.filter(
    (shift) => shift === 'A' || shift === '國A',
  ).length
  const workCount = shifts.filter(isWorkShift).length
  const isHoliday = hasSpecialDay(schedule, date, '假日')
  const isStoreDay = hasSpecialDay(schedule, date, '店務')
  const requiredEarlyCount = 3
  const requiredLateCount = isHoliday ? 5 : 4
  const demandLabel = isHoliday
    ? `3國05 5${isStoreDay ? '國A' : '國13'}`
    : '3F05 4F13'
  const actualLateCount = isStoreDay ? aCount : f13Count

  return {
    f05Count,
    f13Count,
    aCount,
    workCount,
    demandLabel,
    isQualified:
      f05Count === requiredEarlyCount && actualLateCount === requiredLateCount,
  }
}

function buildSpecialDayMarkers(
  schedule: MonthlySchedule,
): Map<DateString, string> {
  const markers = new Map<DateString, string[]>()

  for (const specialDay of schedule.specialDays) {
    const existing = markers.get(specialDay.date) ?? []

    markers.set(specialDay.date, [...existing, specialDay.type])
  }

  return new Map(
    [...markers.entries()].map(([date, values]) => [date, values.join(' / ')]),
  )
}

function roleCode(employee: Employee): string {
  if (employee.isSupervisor) {
    return 'G'
  }

  if (employee.isVeteran) {
    return 'J'
  }

  return 'ⅹ'
}

function getShift(
  entries: ScheduleEntry[],
  employeeId: string,
  date: DateString,
): ShiftType | undefined {
  return entries.find(
    (entry) => entry.employeeId === employeeId && entry.date === date,
  )?.shift
}

function hasSpecialDay(
  schedule: MonthlySchedule,
  date: DateString,
  type: MonthlySchedule['specialDays'][number]['type'],
): boolean {
  return schedule.specialDays.some(
    (specialDay) => specialDay.date === date && specialDay.type === type,
  )
}

function isRestShift(shift: ShiftType | undefined): boolean {
  return (
    shift !== undefined &&
    REST_SHIFTS.includes(shift as (typeof REST_SHIFTS)[number])
  )
}

function isWorkShift(shift: ShiftType | undefined): boolean {
  return (
    shift !== undefined &&
    WORK_SHIFTS.includes(shift as (typeof WORK_SHIFTS)[number])
  )
}

function formatScheduleTitle(month: MonthString): string {
  const [year, monthNumber] = month.split('-').map(Number)

  return `排班_${year}年${monthNumber}月`
}

function datesInMonth(month: MonthString): DateString[] {
  const [year, monthNumber] = month.split('-').map(Number)
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()

  return Array.from({ length: dayCount }, (_, index) => {
    const day = String(index + 1).padStart(2, '0')

    return `${month}-${day}` as DateString
  })
}

function parseDate(date: DateString): Date {
  const [year, month, day] = date.split('-').map(Number)

  return new Date(Date.UTC(year, month - 1, day))
}
