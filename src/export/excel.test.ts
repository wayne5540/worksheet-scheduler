import { describe, expect, it } from 'vitest'

import type { Employee, MonthlySchedule } from '../domain/model'
import {
  buildScheduleWorkbook,
  createScheduleWorkbookBlob,
  STAT_COLUMN_LABELS,
} from './excel'

const employees: Employee[] = [
  {
    id: 'sup-1',
    name: '主管老手',
    isSupervisor: true,
    isVeteran: true,
    isPT: false,
    isActive: true,
    prevMonthLastShift: '國A',
  },
  {
    id: 'vet-1',
    name: '老手',
    isSupervisor: false,
    isVeteran: true,
    isPT: false,
    isActive: true,
    prevMonthLastShift: '休',
  },
  {
    id: 'emp-1',
    name: '一般員工',
    isSupervisor: false,
    isVeteran: false,
    isPT: false,
    isActive: true,
    prevMonthLastShift: 'F13',
  },
]

describe('Excel export', () => {
  it('builds the PLAN.md worksheet name, file name, and header rows', () => {
    const workbook = buildScheduleWorkbook(makeSchedule(), employees)

    expect(workbook.sheetName).toBe('排班_2026年6月')
    expect(workbook.fileName).toBe('排班_2026年6月.xlsx')
    expect(workbook.rows[0].slice(0, 6)).toEqual([
      '',
      '',
      '',
      '四周',
      '假日 / 店務',
      '',
    ])
    expect(workbook.rows[1].slice(0, 6)).toEqual([
      '員工姓名',
      '角色',
      '前一個月',
      new Date(Date.UTC(2026, 5, 1)),
      new Date(Date.UTC(2026, 5, 2)),
      new Date(Date.UTC(2026, 5, 3)),
    ])
    expect(workbook.rows[2].slice(0, 6)).toEqual(['', '', '', '一', '二', '三'])
    expect(workbook.rows[1].slice(33)).toEqual(STAT_COLUMN_LABELS)
  })

  it('exports employee rows with role codes, previous month shift, daily shifts, and summary counts', () => {
    const workbook = buildScheduleWorkbook(makeSchedule(), employees)

    expect(workbook.rows[3].slice(0, 7)).toEqual([
      '主管老手',
      'G',
      '國A',
      'F05',
      '國05',
      '例',
      '',
    ])
    expect(workbook.rows[4].slice(0, 7)).toEqual([
      '老手',
      'J',
      '休',
      'F13',
      '國A',
      '休',
      '',
    ])
    expect(workbook.rows[5].slice(0, 7)).toEqual([
      '一般員工',
      'ⅹ',
      'F13',
      'A',
      '國',
      '休',
      '',
    ])
    expect(workbook.rows[3].slice(33)).toEqual([27, 1, 1, 4, 1, 0, 1])
  })

  it('adds bottom daily statistics rows', () => {
    const workbook = buildScheduleWorkbook(makeSchedule(), employees)
    const bottomRows = workbook.rows.slice(6)

    expect(bottomRows.map((row) => row[0])).toEqual([
      'F05 班人數',
      'F13 班人數',
      'A 班人數',
      '總人數',
      '排班結果',
      '上班需要人力',
      '檢定結果',
    ])
    expect(bottomRows.map((row) => row[3])).toEqual([
      1,
      1,
      1,
      3,
      '1F05 0F01 1F13 1A',
      '3F05 4F13',
      'B',
    ])
    expect(bottomRows.map((row) => row[4])).toEqual([
      1,
      0,
      1,
      2,
      '1F05 0F01 0F13 1A',
      '3國05 5國A',
      'B',
    ])
  })

  it('creates an xlsx Blob from workbook rows', async () => {
    const workbook = buildScheduleWorkbook(makeSchedule(), employees)

    await expect(createScheduleWorkbookBlob(workbook)).resolves.toBeInstanceOf(
      Blob,
    )
  })
})

function makeSchedule(): MonthlySchedule {
  return {
    month: '2026-06',
    prevFourWeekDate: '2026-05-15',
    cycleCarryIn: [{ employeeId: 'sup-1', reiCount: 2, xiuCount: 1 }],
    specialDays: [
      { date: '2026-06-01', type: '四周' },
      { date: '2026-06-02', type: '假日' },
      { date: '2026-06-02', type: '店務' },
    ],
    constraints: [
      {
        employeeId: 'sup-1',
        month: '2026-06',
        forcedDaysOff: ['2026-06-03'],
      },
    ],
    entries: [
      makeEntry('sup-1', '2026-06-01', 'F05'),
      makeEntry('sup-1', '2026-06-02', '國05'),
      makeEntry('sup-1', '2026-06-03', '例'),
      makeEntry('vet-1', '2026-06-01', 'F13'),
      makeEntry('vet-1', '2026-06-02', '國A'),
      makeEntry('vet-1', '2026-06-03', '休'),
      makeEntry('emp-1', '2026-06-01', 'A'),
      makeEntry('emp-1', '2026-06-02', '國'),
      makeEntry('emp-1', '2026-06-03', '休'),
    ],
    relaxedRules: [],
  }
}

function makeEntry(
  employeeId: string,
  date: MonthlySchedule['entries'][number]['date'],
  shift: MonthlySchedule['entries'][number]['shift'],
): MonthlySchedule['entries'][number] {
  return {
    employeeId,
    date,
    shift,
    isAutoRelaxed: false,
    isManualEdit: false,
  }
}
