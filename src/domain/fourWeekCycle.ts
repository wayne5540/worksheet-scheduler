import type { DateString, MonthString } from './model'

export interface FourWeekCycle {
  nodeDate: DateString
  cycleStartDate: DateString
  cycleEndDate: DateString
  currentMonthStartDate: DateString
  currentMonthEndDate: DateString
  requiresCarryIn: boolean
}

export function calculateFourWeekNodes(
  month: MonthString,
  prevFourWeekDate: DateString,
): DateString[] {
  return buildFourWeekCycles(month, prevFourWeekDate).map(
    (cycle) => cycle.nodeDate,
  )
}

export function buildFourWeekCycles(
  month: MonthString,
  prevFourWeekDate: DateString,
): FourWeekCycle[] {
  const monthStart = parseMonthStart(month)
  const monthEnd = getMonthEnd(monthStart)
  const cycles: FourWeekCycle[] = []

  let cycleStart = addDays(parseDate(prevFourWeekDate), 1)
  let cycleEnd = addDays(cycleStart, 27)

  while (cycleEnd.getTime() <= monthEnd.getTime()) {
    if (cycleEnd.getTime() >= monthStart.getTime()) {
      const currentMonthStart =
        cycleStart.getTime() < monthStart.getTime() ? monthStart : cycleStart

      cycles.push({
        nodeDate: formatDate(cycleEnd),
        cycleStartDate: formatDate(cycleStart),
        cycleEndDate: formatDate(cycleEnd),
        currentMonthStartDate: formatDate(currentMonthStart),
        currentMonthEndDate: formatDate(cycleEnd),
        requiresCarryIn: cycleStart.getTime() < monthStart.getTime(),
      })
    }

    cycleStart = addDays(cycleEnd, 1)
    cycleEnd = addDays(cycleEnd, 28)
  }

  return cycles
}

export function needsCycleCarryIn(
  month: MonthString,
  prevFourWeekDate: DateString,
): boolean {
  return (
    buildFourWeekCycles(month, prevFourWeekDate)[0]?.requiresCarryIn ?? false
  )
}

function parseMonthStart(month: MonthString): Date {
  const [year, monthNumber] = parseYearMonth(month)

  return new Date(Date.UTC(year, monthNumber - 1, 1))
}

function getMonthEnd(monthStart: Date): Date {
  return new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
  )
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

function formatDate(date: Date): DateString {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}` as DateString
}
