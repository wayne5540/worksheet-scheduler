import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Employee, MonthlySchedule } from '../domain/model'
import {
  IndexedDbScheduleStore,
  LocalStorageSettingsStore,
  buildStorageDebugExport,
  defaultRuleSettings,
} from './persistence'

describe('persistence adapters', () => {
  let databaseName: string

  beforeEach(() => {
    localStorage.clear()
    databaseName = `work-schedule-test-${crypto.randomUUID()}`
  })

  afterEach(async () => {
    localStorage.clear()
    await deleteDatabase(databaseName)
  })

  it('stores employee settings in localStorage', () => {
    const store = new LocalStorageSettingsStore(localStorage)
    const employees: Employee[] = [
      {
        id: 'emp-1',
        name: '屈澤宇',
        isSupervisor: true,
        isVeteran: true,
        isPT: false,
        isActive: true,
        prevMonthLastShift: '國A',
      },
    ]

    store.saveEmployees(employees)

    expect(store.loadEmployees()).toEqual(employees)

    store.clearEmployees()

    expect(store.loadEmployees()).toEqual([])
  })

  it('stores rule priority and enabled settings in localStorage with PLAN defaults', () => {
    const store = new LocalStorageSettingsStore(localStorage)
    const customSettings = defaultRuleSettings().map((setting) =>
      setting.ruleId === 'R15'
        ? { ...setting, priority: 1, isEnabled: false }
        : setting,
    )

    expect(store.loadRuleSettings()).toEqual(defaultRuleSettings())

    store.saveRuleSettings(customSettings)

    expect(store.loadRuleSettings()).toEqual(customSettings)
  })

  it('stores monthly schedules in IndexedDB by month', async () => {
    const store = new IndexedDbScheduleStore({
      databaseName,
      indexedDB: fakeIndexedDB,
    })
    const schedule = makeSchedule('2026-06')

    await store.saveSchedule(schedule)

    expect(await store.loadSchedule('2026-06')).toEqual(schedule)
    expect(await store.loadSchedule('2026-07')).toBeNull()
  })

  it('lists and deletes monthly schedules in IndexedDB', async () => {
    const store = new IndexedDbScheduleStore({
      databaseName,
      indexedDB: fakeIndexedDB,
    })

    await store.saveSchedule(makeSchedule('2026-07'))
    await store.saveSchedule(makeSchedule('2026-06'))

    expect(await store.listScheduleMonths()).toEqual(['2026-06', '2026-07'])

    await store.deleteSchedule('2026-06')

    expect(await store.loadSchedule('2026-06')).toBeNull()
    expect(await store.listScheduleMonths()).toEqual(['2026-07'])
  })

  it('builds a debug export from localStorage settings and IndexedDB schedules', async () => {
    const settingsStore = new LocalStorageSettingsStore(localStorage)
    const scheduleStore = new IndexedDbScheduleStore({
      databaseName,
      indexedDB: fakeIndexedDB,
    })
    const employees: Employee[] = [
      {
        id: 'emp-1',
        name: '屈澤宇',
        isSupervisor: true,
        isVeteran: true,
        isPT: false,
        isActive: true,
        prevMonthLastShift: '國A',
      },
    ]
    const ruleSettings = defaultRuleSettings().map((setting) =>
      setting.ruleId === 'R15' ? { ...setting, isEnabled: false } : setting,
    )
    const juneSchedule = makeSchedule('2026-06')
    const julySchedule = makeSchedule('2026-07')

    settingsStore.saveEmployees(employees)
    settingsStore.saveRuleSettings(ruleSettings)
    await scheduleStore.saveSchedule(julySchedule)
    await scheduleStore.saveSchedule(juneSchedule)

    await expect(
      buildStorageDebugExport({
        exportedAt: '2026-06-10T00:00:00.000Z',
        scheduleStore,
        settingsStore,
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      exportedAt: '2026-06-10T00:00:00.000Z',
      localStorage: {
        employees,
        ruleSettings,
      },
      indexedDB: {
        scheduleMonths: ['2026-06', '2026-07'],
        monthlySchedules: [juneSchedule, julySchedule],
      },
    })
  })
})

function makeSchedule(month: '2026-06' | '2026-07'): MonthlySchedule {
  return {
    month,
    prevFourWeekDate: month === '2026-06' ? '2026-05-15' : '2026-06-12',
    cycleCarryIn: [{ employeeId: 'emp-1', reiCount: 3, xiuCount: 2 }],
    specialDays: [
      { date: `${month}-12`, type: '四周' },
      { date: `${month}-20`, type: '假日' },
    ],
    constraints: [
      {
        employeeId: 'emp-1',
        month,
        forcedDaysOff: [`${month}-03`],
      },
    ],
    entries: [
      {
        employeeId: 'emp-1',
        date: `${month}-03`,
        shift: '休',
        isAutoRelaxed: false,
        isManualEdit: false,
      },
    ],
    relaxedRules: [
      {
        ruleId: 'R15',
        ruleName: '大清日人力',
        affectedDates: [`${month}-20`],
      },
    ],
  }
}

function deleteDatabase(databaseName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(databaseName)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () =>
      reject(new Error(`Blocked deleting ${databaseName}`))
  })
}
