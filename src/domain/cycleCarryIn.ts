import type {
  CycleCarryIn,
  DateString,
  Employee,
  MonthString,
  MonthlySchedule,
} from './model'

export interface CycleCarryInCalculationInput {
  employees: Employee[]
  month: MonthString
  prevFourWeekDate: DateString
  previousSchedule: MonthlySchedule
}

export function calculateCycleCarryInFromSchedule({
  employees,
  month,
  prevFourWeekDate,
  previousSchedule,
}: CycleCarryInCalculationInput): CycleCarryIn[] {
  const cycleStart = addDays(parseDate(prevFourWeekDate), 1)
  const currentMonthStart = parseMonthStart(month)

  if (cycleStart.getTime() >= currentMonthStart.getTime()) {
    return zeroCarryIn(employees)
  }

  const previousMonthEnd = addDays(currentMonthStart, -1)

  return employees.map((employee) => {
    const entries = previousSchedule.entries.filter((entry) => {
      const entryDate = parseDate(entry.date)

      return (
        entry.employeeId === employee.id &&
        entryDate.getTime() >= cycleStart.getTime() &&
        entryDate.getTime() <= previousMonthEnd.getTime()
      )
    })

    return {
      employeeId: employee.id,
      reiCount: entries.filter((entry) => entry.shift === '例').length,
      xiuCount: entries.filter((entry) => entry.shift === '休').length,
    }
  })
}

export function applyPreviousMonthLastShifts(
  employees: Employee[],
  previousSchedule: MonthlySchedule,
): Employee[] {
  const lastDate = lastDateOfMonth(previousSchedule.month)
  const lastShiftByEmployeeId = new Map(
    previousSchedule.entries
      .filter((entry) => entry.date === lastDate)
      .map((entry) => [entry.employeeId, entry.shift]),
  )

  return employees.map((employee) => {
    const lastShift = lastShiftByEmployeeId.get(employee.id)

    return lastShift === undefined
      ? employee
      : { ...employee, prevMonthLastShift: lastShift }
  })
}

export function previousMonth(month: MonthString): MonthString {
  const [year, monthNumber] = parseYearMonth(month)
  const date = new Date(Date.UTC(year, monthNumber - 2, 1))

  return formatMonth(date)
}

function lastDateOfMonth(month: MonthString): DateString {
  const monthStart = parseMonthStart(month)
  const monthEnd = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
  )

  return formatDate(monthEnd)
}

function zeroCarryIn(employees: Employee[]): CycleCarryIn[] {
  return employees.map((employee) => ({
    employeeId: employee.id,
    reiCount: 0,
    xiuCount: 0,
  }))
}

function parseMonthStart(month: MonthString): Date {
  const [year, monthNumber] = parseYearMonth(month)

  return new Date(Date.UTC(year, monthNumber - 1, 1))
}

function parseDate(dateString: DateString): Date {
  const [year, monthNumber, day] = parseYearMonthDay(dateString)

  return new Date(Date.UTC(year, monthNumber - 1, day))
}

function parseYearMonth(month: MonthString): [number, number] {
  const match = /^(\d{4})-(\d{2})$/.exec(month)

  if (!match) {
    throw new Error(`Invalid month: ${month}`)
  }

  return [Number(match[1]), Number(match[2])]
}

function parseYearMonthDay(dateString: DateString): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString)

  if (!match) {
    throw new Error(`Invalid date: ${dateString}`)
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])]
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

function formatMonth(date: Date): MonthString {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')

  return `${year}-${month}` as MonthString
}

function formatDate(date: Date): DateString {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}` as DateString
}
