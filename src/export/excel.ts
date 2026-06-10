import writeExcelFile from 'write-excel-file/browser'
import type { CellObject, Row, SheetData } from 'write-excel-file/browser'

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
  columns: WorkbookColumn[]
  fileName: string
  orientation: 'landscape'
  sheetName: string
  showGridLines: boolean
  rows: SheetData
  stickyColumnsCount: number
  stickyRowsCount: number
}

interface DailyStats {
  f05Count: number
  f13Count: number
  aCount: number
  workCount: number
  demandLabel: string
  isQualified: boolean
}

interface WorkbookColumn {
  width: number
}

type CellValue = boolean | Date | number | string
type CellStyle = Omit<Partial<CellObject>, 'value'>

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
const FIXED_COLUMN_COUNT = 3
const DATE_COLUMN_WIDTH = 5
const STAT_COLUMN_WIDTH = 11
const BASE_CELL_STYLE = {
  align: 'center',
  alignVertical: 'center',
  borderColor: '#b7b7b7',
  borderStyle: 'thin',
  fontFamily: 'Arial',
  fontSize: 10,
  wrap: true,
} satisfies CellStyle
const TITLE_STYLE = {
  align: 'center',
  backgroundColor: '#2f6f62',
  fontSize: 16,
  fontWeight: 'bold',
  height: 26,
  textColor: '#ffffff',
} satisfies CellStyle
const HEADER_STYLE = {
  backgroundColor: '#d9ead3',
  fontWeight: 'bold',
  height: 22,
} satisfies CellStyle
const SPECIAL_DAY_STYLE = {
  backgroundColor: '#fff2cc',
  fontWeight: 'bold',
} satisfies CellStyle
const WEEKDAY_STYLE = {
  backgroundColor: '#eeeeee',
  fontWeight: 'bold',
} satisfies CellStyle
const EMPLOYEE_STYLE = {
  backgroundColor: '#f3f6f4',
  fontWeight: 'bold',
} satisfies CellStyle
const STAT_STYLE = {
  backgroundColor: '#fce5cd',
  fontWeight: 'bold',
} satisfies CellStyle
const SUMMARY_STYLE = {
  backgroundColor: '#e2f0d9',
  fontWeight: 'bold',
} satisfies CellStyle
const MANUAL_EDIT_STYLE = {
  backgroundColor: '#cfe2f3',
} satisfies CellStyle
const AUTO_RELAXED_STYLE = {
  backgroundColor: '#fff2cc',
} satisfies CellStyle
const REST_SHIFT_STYLE = {
  backgroundColor: '#f4cccc',
} satisfies CellStyle
const HOLIDAY_WORK_SHIFT_STYLE = {
  backgroundColor: '#d9ead3',
} satisfies CellStyle
const WORK_SHIFT_STYLE = {
  backgroundColor: '#d9ead3',
} satisfies CellStyle

export function buildScheduleWorkbook(
  schedule: MonthlySchedule,
  employees: Employee[],
): ScheduleWorkbook {
  const dates = datesInMonth(schedule.month)
  const title = formatScheduleTitle(schedule.month)
  const totalColumnCount =
    FIXED_COLUMN_COUNT + dates.length + STAT_COLUMN_LABELS.length
  const rows: SheetData = [
    buildTitleRow(title, totalColumnCount),
    buildSpecialDayRow(schedule, dates),
    buildHeaderRow(dates),
    buildWeekdayRow(dates),
    ...employees.map((employee) => buildEmployeeRow(schedule, employee, dates)),
    ...buildBottomRows(schedule, employees, dates),
  ]

  return {
    columns: buildColumns(dates.length),
    fileName: `${title}.xlsx`,
    orientation: 'landscape',
    sheetName: title,
    showGridLines: false,
    rows,
    stickyColumnsCount: FIXED_COLUMN_COUNT,
    stickyRowsCount: 4,
  }
}

export async function createScheduleWorkbookBlob(
  workbook: ScheduleWorkbook,
): Promise<Blob> {
  return writeExcelFile([
    {
      sheet: workbook.sheetName,
      data: workbook.rows,
      columns: workbook.columns,
      dateFormat: 'yyyy/mm/dd',
      orientation: workbook.orientation,
      showGridLines: workbook.showGridLines,
      stickyColumnsCount: workbook.stickyColumnsCount,
      stickyRowsCount: workbook.stickyRowsCount,
    },
  ]).toBlob()
}

function buildTitleRow(title: string, totalColumnCount: number): Row {
  return [
    styledCell(title, {
      ...TITLE_STYLE,
      columnSpan: totalColumnCount,
    }),
    ...Array.from({ length: totalColumnCount - 1 }, () => null),
  ]
}

function buildSpecialDayRow(
  schedule: MonthlySchedule,
  dates: DateString[],
): Row {
  const specialDayMarkers = buildSpecialDayMarkers(schedule)

  return [
    styledCell('', HEADER_STYLE),
    styledCell('', HEADER_STYLE),
    styledCell('', HEADER_STYLE),
    ...dates.map((date) => {
      const marker = specialDayMarkers.get(date) ?? ''

      return styledCell(marker, marker ? SPECIAL_DAY_STYLE : HEADER_STYLE)
    }),
    ...blankCells(STAT_COLUMN_LABELS.length, HEADER_STYLE),
  ]
}

function buildHeaderRow(dates: DateString[]): Row {
  return [
    styledCell('員工姓名', HEADER_STYLE),
    styledCell('角色', HEADER_STYLE),
    styledCell('前一個月', HEADER_STYLE),
    ...dates.map((date) => styledCell(parseDate(date), HEADER_STYLE)),
    ...STAT_COLUMN_LABELS.map((label) => styledCell(label, STAT_STYLE)),
  ]
}

function buildWeekdayRow(dates: DateString[]): Row {
  return [
    styledCell('', WEEKDAY_STYLE),
    styledCell('', WEEKDAY_STYLE),
    styledCell('', WEEKDAY_STYLE),
    ...dates.map((date) =>
      styledCell(WEEKDAY_LABELS[parseDate(date).getUTCDay()], WEEKDAY_STYLE),
    ),
    ...blankCells(STAT_COLUMN_LABELS.length, WEEKDAY_STYLE),
  ]
}

function buildEmployeeRow(
  schedule: MonthlySchedule,
  employee: Employee,
  dates: DateString[],
): SheetData[number] {
  return [
    styledCell(employee.name, EMPLOYEE_STYLE),
    styledCell(roleCode(employee), roleStyle(employee)),
    styledCell(
      employee.prevMonthLastShift ?? '',
      shiftStyle(employee.prevMonthLastShift),
    ),
    ...dates.map((date) =>
      shiftCell(getEntry(schedule.entries, employee.id, date)),
    ),
    ...buildEmployeeStatCells(schedule, employee, dates).map((value) =>
      styledCell(value, STAT_STYLE),
    ),
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
    buildBottomRow(
      'F05 班人數',
      dailyStats.map((stats) => stats.f05Count),
    ),
    buildBottomRow(
      'F13 班人數',
      dailyStats.map((stats) => stats.f13Count),
    ),
    buildBottomRow(
      'A 班人數',
      dailyStats.map((stats) => stats.aCount),
    ),
    buildBottomRow(
      '總人數',
      dailyStats.map((stats) => stats.workCount),
    ),
    buildBottomRow(
      '排班結果',
      dailyStats.map(
        (stats) =>
          `${stats.f05Count}F05 0F01 ${stats.f13Count}F13 ${stats.aCount}A`,
      ),
    ),
    buildBottomRow(
      '上班需要人力',
      dailyStats.map((stats) => stats.demandLabel),
    ),
    buildBottomRow(
      '檢定結果',
      dailyStats.map((stats) => (stats.isQualified ? 'A' : 'B')),
    ),
  ]
}

function buildBottomRow(label: string, values: CellValue[]): Row {
  return [
    styledCell(label, SUMMARY_STYLE),
    styledCell('', SUMMARY_STYLE),
    styledCell('', SUMMARY_STYLE),
    ...values.map((value) => styledCell(value, SUMMARY_STYLE)),
    ...blankCells(STAT_COLUMN_LABELS.length, SUMMARY_STYLE),
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
  return getEntry(entries, employeeId, date)?.shift
}

function getEntry(
  entries: ScheduleEntry[],
  employeeId: string,
  date: DateString,
): ScheduleEntry | undefined {
  return entries.find(
    (entry) => entry.employeeId === employeeId && entry.date === date,
  )
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

function buildColumns(dateCount: number): WorkbookColumn[] {
  return [
    { width: 14 },
    { width: 8 },
    { width: 10 },
    ...Array.from({ length: dateCount }, () => ({ width: DATE_COLUMN_WIDTH })),
    ...STAT_COLUMN_LABELS.map(() => ({ width: STAT_COLUMN_WIDTH })),
  ]
}

function blankCells(count: number, style: CellStyle): CellObject[] {
  return Array.from({ length: count }, () => styledCell('', style))
}

function styledCell(value: CellValue, style: CellStyle = {}): CellObject {
  return {
    value,
    ...BASE_CELL_STYLE,
    ...style,
  }
}

function shiftCell(entry: ScheduleEntry | undefined): CellObject {
  const value = entry?.shift ?? ''

  if (entry?.isManualEdit) {
    return styledCell(value, MANUAL_EDIT_STYLE)
  }

  if (entry?.isAutoRelaxed) {
    return styledCell(value, AUTO_RELAXED_STYLE)
  }

  return styledCell(value, shiftStyle(value))
}

function shiftStyle(shift: ShiftType | '' | null): CellStyle {
  if (shift === '休' || shift === '例' || shift === '國') {
    return REST_SHIFT_STYLE
  }

  if (shift === '國05' || shift === '國13' || shift === '國A') {
    return HOLIDAY_WORK_SHIFT_STYLE
  }

  if (shift === 'F05' || shift === 'F13' || shift === 'A') {
    return WORK_SHIFT_STYLE
  }

  return {}
}

function roleStyle(employee: Employee): CellStyle {
  if (employee.isSupervisor) {
    return {
      ...EMPLOYEE_STYLE,
      backgroundColor: '#cfe2f3',
    }
  }

  if (employee.isVeteran) {
    return {
      ...EMPLOYEE_STYLE,
      backgroundColor: '#eadcf8',
    }
  }

  return EMPLOYEE_STYLE
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
