import type { Employee, MonthString, MonthlySchedule } from '../domain/model'
import { DEFAULT_RULES, type RuleId } from '../domain/rules'

export interface RuleSetting {
  ruleId: RuleId
  priority: number
  isEnabled: boolean
}

interface LocalStorageKeys {
  employees: string
  ruleSettings: string
}

interface IndexedDbScheduleStoreOptions {
  databaseName?: string
  indexedDB?: IDBFactory
}

export interface StorageDebugExport {
  schemaVersion: 1
  exportedAt: string
  localStorage: {
    employees: Employee[]
    ruleSettings: RuleSetting[]
  }
  indexedDB: {
    scheduleMonths: MonthString[]
    monthlySchedules: MonthlySchedule[]
  }
}

interface StorageDebugExportOptions {
  exportedAt?: string
  scheduleStore: IndexedDbScheduleStore
  settingsStore: LocalStorageSettingsStore
}

const DEFAULT_LOCAL_STORAGE_KEYS: LocalStorageKeys = {
  employees: 'work-schedule:employees',
  ruleSettings: 'work-schedule:rule-settings',
}

const DEFAULT_DATABASE_NAME = 'work-schedule'
const MONTHLY_SCHEDULES_STORE = 'monthlySchedules'

export function defaultRuleSettings(): RuleSetting[] {
  return DEFAULT_RULES.map(({ id, priority }) => ({
    ruleId: id,
    priority,
    isEnabled: true,
  }))
}

export class LocalStorageSettingsStore {
  constructor(
    private readonly storage: Storage,
    private readonly keys: LocalStorageKeys = DEFAULT_LOCAL_STORAGE_KEYS,
  ) {}

  loadEmployees(): Employee[] {
    return readJson(this.storage, this.keys.employees, [])
  }

  saveEmployees(employees: Employee[]): void {
    this.storage.setItem(this.keys.employees, JSON.stringify(employees))
  }

  clearEmployees(): void {
    this.storage.removeItem(this.keys.employees)
  }

  loadRuleSettings(): RuleSetting[] {
    return readJson(this.storage, this.keys.ruleSettings, defaultRuleSettings())
  }

  saveRuleSettings(settings: RuleSetting[]): void {
    this.storage.setItem(this.keys.ruleSettings, JSON.stringify(settings))
  }

  clearRuleSettings(): void {
    this.storage.removeItem(this.keys.ruleSettings)
  }
}

export class IndexedDbScheduleStore {
  private readonly databaseName: string
  private readonly indexedDB: IDBFactory

  constructor(options: IndexedDbScheduleStoreOptions = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME
    this.indexedDB = options.indexedDB ?? window.indexedDB
  }

  async saveSchedule(schedule: MonthlySchedule): Promise<void> {
    await this.runRequest('readwrite', (store) => store.put(schedule))
  }

  loadSchedule(month: MonthString): Promise<MonthlySchedule | null> {
    return this.runRequest(
      'readonly',
      (store) => store.get(month),
      (result) => (result === undefined ? null : (result as MonthlySchedule)),
    )
  }

  async deleteSchedule(month: MonthString): Promise<void> {
    await this.runRequest('readwrite', (store) => store.delete(month))
  }

  listScheduleMonths(): Promise<MonthString[]> {
    return this.runRequest(
      'readonly',
      (store) => store.getAllKeys(),
      (result) =>
        (result as IDBValidKey[])
          .map((key) => String(key) as MonthString)
          .sort((left, right) => left.localeCompare(right)),
    )
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.databaseName, 1)

      request.onupgradeneeded = () => {
        const database = request.result

        if (!database.objectStoreNames.contains(MONTHLY_SCHEDULES_STORE)) {
          database.createObjectStore(MONTHLY_SCHEDULES_STORE, {
            keyPath: 'month',
          })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () =>
        reject(new Error(`Blocked opening ${this.databaseName}`))
    })
  }

  private async runRequest<T = void>(
    mode: IDBTransactionMode,
    createRequest: (store: IDBObjectStore) => IDBRequest,
    mapResult: (result: unknown) => T = () => undefined as T,
  ): Promise<T> {
    const database = await this.openDatabase()

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(MONTHLY_SCHEDULES_STORE, mode)
      const store = transaction.objectStore(MONTHLY_SCHEDULES_STORE)
      let mappedResult: T

      const closeAndReject = (error: unknown) => {
        database.close()
        reject(error)
      }

      transaction.oncomplete = () => {
        database.close()
        resolve(mappedResult)
      }
      transaction.onerror = () => closeAndReject(transaction.error)
      transaction.onabort = () => closeAndReject(transaction.error)

      try {
        const request = createRequest(store)

        request.onsuccess = () => {
          mappedResult = mapResult(request.result)
        }
        request.onerror = () => closeAndReject(request.error)
      } catch (error) {
        closeAndReject(error)
      }
    })
  }
}

export async function buildStorageDebugExport({
  exportedAt = new Date().toISOString(),
  scheduleStore,
  settingsStore,
}: StorageDebugExportOptions): Promise<StorageDebugExport> {
  const scheduleMonths = await scheduleStore.listScheduleMonths()
  const loadedSchedules = await Promise.all(
    scheduleMonths.map((month) => scheduleStore.loadSchedule(month)),
  )
  const monthlySchedules = loadedSchedules.filter(
    (schedule): schedule is MonthlySchedule => schedule !== null,
  )

  return {
    schemaVersion: 1,
    exportedAt,
    localStorage: {
      employees: settingsStore.loadEmployees(),
      ruleSettings: settingsStore.loadRuleSettings(),
    },
    indexedDB: {
      scheduleMonths,
      monthlySchedules,
    },
  }
}

function readJson<T>(storage: Storage, key: string, fallback: T): T {
  const rawValue = storage.getItem(key)

  if (rawValue === null) {
    return fallback
  }

  return JSON.parse(rawValue) as T
}
