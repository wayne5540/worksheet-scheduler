import { useEffect, useMemo, useRef, useState } from 'react'

import {
  applyPreviousMonthLastShifts,
  calculateCycleCarryInFromSchedule,
  previousMonth,
} from './domain/cycleCarryIn'
import { calculateFourWeekNodes } from './domain/fourWeekCycle'
import {
  SHIFT_TYPES,
  type CycleCarryIn,
  type DateString,
  type Employee,
  type MonthString,
  type MonthlySchedule,
  type PersonalConstraint,
  type ScheduleEntry,
  type SpecialDay,
  type ShiftType,
} from './domain/model'
import {
  DEFAULT_RULES,
  validateRules,
  type RuleDefinition,
  type RuleViolation,
} from './domain/rules'
import {
  buildScheduleWorkbook,
  createScheduleWorkbookBlob,
} from './export/excel'
import {
  defaultRuleSettings,
  IndexedDbScheduleStore,
  LocalStorageSettingsStore,
  type RuleSetting,
} from './persistence/persistence'
import {
  attemptBacktrackingSchedule,
  runRelaxedScheduling,
} from './scheduling/scheduler'
import './styles.css'

const navItems = ['員工管理', '規則設定', '月度排班'] as const
type NavItem = (typeof navItems)[number]

const stepTitles = [
  '月份設定',
  '特別日標記',
  '個人限制輸入',
  '產生班表',
  '檢視 / 調整 / 匯出',
] as const
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const
const GENERATED_MESSAGE = '班表已產生'
const PARTIAL_RELAXED_MESSAGE = '班表已產生，部分規則已放寬'
type LockedLeaveShift = Extract<ShiftType, '特' | '公'>
const LOCKED_LEAVE_OPTIONS: (LockedLeaveShift | '')[] = ['', '特', '公']

const DEFAULT_EMPLOYEES: Employee[] = [
  {
    id: 'emp-supervisor',
    name: '主管',
    isSupervisor: true,
    isVeteran: true,
    isPT: false,
    isActive: true,
    prevMonthLastShift: '國A',
  },
  {
    id: 'emp-veteran',
    name: '老手',
    isSupervisor: false,
    isVeteran: true,
    isPT: false,
    isActive: true,
    prevMonthLastShift: '休',
  },
  {
    id: 'emp-regular',
    name: '一般員工',
    isSupervisor: false,
    isVeteran: false,
    isPT: false,
    isActive: true,
    prevMonthLastShift: 'F13',
  },
  {
    id: 'emp-supervisor-2',
    name: '副主管',
    isSupervisor: true,
    isVeteran: false,
    isPT: false,
    isActive: true,
    prevMonthLastShift: null,
  },
  {
    id: 'emp-supervisor-3',
    name: '資深主管',
    isSupervisor: true,
    isVeteran: true,
    isPT: false,
    isActive: true,
    prevMonthLastShift: null,
  },
  {
    id: 'emp-supervisor-4',
    name: '值班主管',
    isSupervisor: true,
    isVeteran: false,
    isPT: false,
    isActive: true,
    prevMonthLastShift: null,
  },
  {
    id: 'emp-veteran-2',
    name: '老手二',
    isSupervisor: false,
    isVeteran: true,
    isPT: false,
    isActive: true,
    prevMonthLastShift: null,
  },
  {
    id: 'emp-veteran-3',
    name: '老手三',
    isSupervisor: false,
    isVeteran: true,
    isPT: false,
    isActive: true,
    prevMonthLastShift: null,
  },
]

const PREV_MONTH_SHIFT_OPTIONS: (ShiftType | '')[] = ['', ...SHIFT_TYPES]

function App() {
  const settingsStore = useMemo(
    () => new LocalStorageSettingsStore(window.localStorage),
    [],
  )
  const scheduleStore = useMemo(() => new IndexedDbScheduleStore(), [])
  const [activeTab, setActiveTab] = useState<NavItem>('月度排班')
  const [currentStep, setCurrentStep] = useState(1)
  const [employees, setEmployees] = useState<Employee[]>(() => {
    const storedEmployees = settingsStore.loadEmployees()

    return storedEmployees.length > 0 ? storedEmployees : DEFAULT_EMPLOYEES
  })
  const [ruleSettings, setRuleSettings] = useState<RuleSetting[]>(() =>
    settingsStore.loadRuleSettings(),
  )
  const [month, setMonth] = useState<MonthString>('2026-06')
  const [prevFourWeekDate, setPrevFourWeekDate] =
    useState<DateString>('2026-05-15')
  const [cycleCarryIn, setCycleCarryIn] = useState<CycleCarryIn[]>([])
  const [manualSpecialDays, setManualSpecialDays] = useState<SpecialDay[]>([])
  const [constraints, setConstraints] = useState<PersonalConstraint[]>([])
  const [lockedEntries, setLockedEntries] = useState<ScheduleEntry[]>([])
  const [schedule, setSchedule] = useState<MonthlySchedule | null>(null)
  const [generationMessage, setGenerationMessage] = useState<string | null>(
    null,
  )
  const [isGenerating, setIsGenerating] = useState(false)
  const carryInSourceKey = useRef<string | null>(null)

  const fourWeekNodes = useMemo(
    () => calculateFourWeekNodes(month, prevFourWeekDate),
    [month, prevFourWeekDate],
  )
  const specialDays = useMemo(
    () => [
      ...manualSpecialDays,
      ...fourWeekNodes.map(
        (date): SpecialDay => ({
          date,
          type: '四周',
        }),
      ),
    ],
    [fourWeekNodes, manualSpecialDays],
  )
  const activeRules = useMemo(
    () =>
      ruleSettings
        .filter((setting) => setting.isEnabled)
        .map((setting) => {
          const definition = DEFAULT_RULES.find(
            (rule) => rule.id === setting.ruleId,
          )

          if (!definition) {
            throw new Error(`Unknown rule setting: ${setting.ruleId}`)
          }

          return {
            ...definition,
            priority: setting.priority,
          }
        })
        .sort((left, right) => left.priority - right.priority),
    [ruleSettings],
  )
  const normalizedCycleCarryIn = useMemo(
    () => normalizeCycleCarryIn(cycleCarryIn, employees),
    [cycleCarryIn, employees],
  )
  const monthConstraints = useMemo(
    () => constraints.filter((constraint) => constraint.month === month),
    [constraints, month],
  )

  useEffect(() => {
    settingsStore.saveEmployees(employees)
  }, [employees, settingsStore])

  useEffect(() => {
    settingsStore.saveRuleSettings(ruleSettings)
  }, [ruleSettings, settingsStore])

  useEffect(() => {
    let isCurrent = true

    scheduleStore.loadSchedule(month).then((storedSchedule) => {
      if (!isCurrent) {
        return
      }

      setSchedule(storedSchedule)
      if (storedSchedule) {
        setCurrentStep(5)
        setGenerationMessage('已載入已儲存班表')
      }
    })

    return () => {
      isCurrent = false
    }
  }, [month, scheduleStore])

  useEffect(() => {
    let isCurrent = true

    scheduleStore
      .loadSchedule(previousMonth(month))
      .then((previousSchedule) => {
        if (!isCurrent || !previousSchedule) {
          return
        }

        setEmployees((currentEmployees) =>
          applyPreviousMonthLastShifts(currentEmployees, previousSchedule),
        )
      })

    return () => {
      isCurrent = false
    }
  }, [month, scheduleStore])

  useEffect(() => {
    let isCurrent = true
    const sourceKey = `${month}:${prevFourWeekDate}`

    if (!requiresCarryIn(month, prevFourWeekDate)) {
      queueMicrotask(() => {
        if (!isCurrent) {
          return
        }

        carryInSourceKey.current = sourceKey
        setCycleCarryIn([])
      })

      return () => {
        isCurrent = false
      }
    }

    scheduleStore
      .loadSchedule(previousMonth(month))
      .then((previousSchedule) => {
        if (!isCurrent) {
          return
        }

        if (previousSchedule) {
          setCycleCarryIn(
            calculateCycleCarryInFromSchedule({
              employees,
              month,
              prevFourWeekDate,
              previousSchedule,
            }),
          )
          carryInSourceKey.current = sourceKey
          return
        }

        setCycleCarryIn((currentCarryIn) =>
          normalizeCycleCarryIn(
            carryInSourceKey.current === sourceKey ? currentCarryIn : [],
            employees,
          ),
        )
        carryInSourceKey.current = sourceKey
      })

    return () => {
      isCurrent = false
    }
  }, [employees, month, prevFourWeekDate, scheduleStore])

  function updateSchedule(nextSchedule: MonthlySchedule) {
    setSchedule(nextSchedule)
    void scheduleStore.saveSchedule(nextSchedule)
  }

  function updateMonthConstraints(nextConstraints: PersonalConstraint[]) {
    setConstraints((currentConstraints) => [
      ...currentConstraints.filter((constraint) => constraint.month !== month),
      ...nextConstraints,
    ])
  }

  function moveEmployee(employeeId: string, direction: -1 | 1) {
    setEmployees((currentEmployees) =>
      moveEmployeeById(currentEmployees, employeeId, direction),
    )
  }

  function reorderEmployee(employeeId: string, targetEmployeeId: string) {
    setEmployees((currentEmployees) =>
      moveItemBefore(
        currentEmployees,
        employeeId,
        targetEmployeeId,
        (employee) => employee.id,
      ),
    )
  }

  function moveRuleSetting(ruleId: RuleSetting['ruleId'], direction: -1 | 1) {
    setRuleSettings((currentSettings) =>
      moveRuleSettingById(currentSettings, ruleId, direction),
    )
  }

  function reorderRuleSetting(
    ruleId: RuleSetting['ruleId'],
    targetRuleId: RuleSetting['ruleId'],
  ) {
    setRuleSettings((currentSettings) =>
      moveItemBefore(
        [...currentSettings].sort((left, right) => left.priority - right.priority),
        ruleId,
        targetRuleId,
        (setting) => setting.ruleId,
      ).map((setting, index) => ({
        ...setting,
        priority: index + 1,
      })),
    )
  }

  async function generateSchedule() {
    const preflightError = generationPreflightError({
      activeRules,
      employees,
      month,
      specialDays,
    })

    if (preflightError) {
      setIsGenerating(false)
      setGenerationMessage(preflightError)
      setCurrentStep(4)
      return
    }

    setIsGenerating(true)
    setGenerationMessage('產生中')
    await yieldToRender()

    try {
      const result = runRelaxedScheduling(
        {
          employees,
          month,
          prevFourWeekDate,
          cycleCarryIn: normalizedCycleCarryIn,
          specialDays,
          constraints: monthConstraints,
          lockedEntries: entriesForMonth(lockedEntries, month),
          rules: activeRules,
        },
        attemptBacktrackingSchedule,
      )

      if (result.success) {
        await scheduleStore.saveSchedule(result.schedule)
        setSchedule(result.schedule)
        setGenerationMessage(
          result.schedule.relaxedRules.length === 0
            ? GENERATED_MESSAGE
            : PARTIAL_RELAXED_MESSAGE,
        )
        setCurrentStep(result.schedule.relaxedRules.length === 0 ? 5 : 4)
        return
      }

      setGenerationMessage(result.reason)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <main className="appShell">
      <header className="topBar">
        <div>
          <p className="eyebrow">Work Schedule</p>
          <h1>門市排班系統</h1>
        </div>

        <nav aria-label="主要頁面" className="tabs" role="tablist">
          {navItems.map((item) => (
            <button
              aria-selected={item === activeTab}
              className="tab"
              key={item}
              onClick={() => setActiveTab(item)}
              role="tab"
              type="button"
            >
              {item}
            </button>
          ))}
        </nav>
      </header>

      {activeTab === '員工管理' && (
        <EmployeeWorkspace
          employees={employees}
          onAddEmployee={() =>
            setEmployees((currentEmployees) => [
              ...currentEmployees,
              {
                id: `emp-${crypto.randomUUID()}`,
                name: '新員工',
                isSupervisor: false,
                isVeteran: false,
                isPT: false,
                isActive: true,
                prevMonthLastShift: null,
              },
            ])
          }
          onDeleteEmployee={(employeeId) =>
            setEmployees((currentEmployees) =>
              currentEmployees.filter((employee) => employee.id !== employeeId),
            )
          }
          onMoveEmployee={moveEmployee}
          onReorderEmployee={reorderEmployee}
          onUpdateEmployee={(employeeId, patch) =>
            setEmployees((currentEmployees) =>
              currentEmployees.map((employee) =>
                employee.id === employeeId
                  ? { ...employee, ...patch }
                  : employee,
              ),
            )
          }
        />
      )}
      {activeTab === '規則設定' && (
        <RuleWorkspace
          onRestoreDefaults={() => setRuleSettings(defaultRuleSettings())}
          onMoveRuleSetting={moveRuleSetting}
          onReorderRuleSetting={reorderRuleSetting}
          onUpdateRuleSetting={(ruleId, patch) =>
            setRuleSettings((currentSettings) =>
              currentSettings.map((setting) =>
                setting.ruleId === ruleId ? { ...setting, ...patch } : setting,
              ),
            )
          }
          ruleSettings={ruleSettings}
        />
      )}
      {activeTab === '月度排班' && (
        <MonthlyWorkspace
          activeRules={activeRules}
          constraints={monthConstraints}
          cycleCarryIn={normalizedCycleCarryIn}
          currentStep={currentStep}
          employees={employees}
          fourWeekNodes={fourWeekNodes}
          generationMessage={generationMessage}
          isGenerating={isGenerating}
          lockedEntries={entriesForMonth(lockedEntries, month)}
          manualSpecialDays={manualSpecialDays}
          month={month}
          onGenerate={generateSchedule}
          onMonthChange={setMonth}
          onPrevFourWeekDateChange={setPrevFourWeekDate}
          onRegenerate={generateSchedule}
          onScheduleChange={updateSchedule}
          onSetConstraints={updateMonthConstraints}
          onSetCycleCarryIn={setCycleCarryIn}
          onSetCurrentStep={setCurrentStep}
          onSetLockedEntries={setLockedEntries}
          onSetManualSpecialDays={setManualSpecialDays}
          prevFourWeekDate={prevFourWeekDate}
          schedule={schedule}
          specialDays={specialDays}
        />
      )}
    </main>
  )
}

function EmployeeWorkspace({
  employees,
  onAddEmployee,
  onDeleteEmployee,
  onMoveEmployee,
  onReorderEmployee,
  onUpdateEmployee,
}: {
  employees: Employee[]
  onAddEmployee: () => void
  onDeleteEmployee: (employeeId: string) => void
  onMoveEmployee: (employeeId: string, direction: -1 | 1) => void
  onReorderEmployee: (employeeId: string, targetEmployeeId: string) => void
  onUpdateEmployee: (employeeId: string, patch: Partial<Employee>) => void
}) {
  const [draggedEmployeeId, setDraggedEmployeeId] = useState<string | null>(
    null,
  )

  function dropEmployee(targetEmployeeId: string) {
    if (draggedEmployeeId && draggedEmployeeId !== targetEmployeeId) {
      onReorderEmployee(draggedEmployeeId, targetEmployeeId)
    }

    setDraggedEmployeeId(null)
  }

  return (
    <section aria-labelledby="employee-title" className="workspace">
      <WorkspaceTitle
        eyebrow="Employees"
        title="員工管理"
        titleId="employee-title"
      />
      <div className="toolbar">
        <button onClick={onAddEmployee} type="button">
          新增員工
        </button>
      </div>
      <div className="scheduleFrame">
        <table>
          <caption>員工清單</caption>
          <thead>
            <tr>
              <th scope="col">姓名</th>
              <th scope="col">主管</th>
              <th scope="col">老手</th>
              <th scope="col">PT</th>
              <th scope="col">啟用</th>
              <th scope="col">前月末班</th>
              <th scope="col">順序</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee, index) => (
              <tr key={employee.id}>
                <th scope="row">
                  <input
                    aria-label={`員工 ${index + 1} 姓名`}
                    onChange={(event) =>
                      onUpdateEmployee(employee.id, {
                        name: event.currentTarget.value,
                      })
                    }
                    value={employee.name}
                  />
                </th>
                <td>
                  <input
                    aria-label={`員工 ${index + 1} 主管`}
                    checked={employee.isSupervisor}
                    onChange={(event) =>
                      onUpdateEmployee(employee.id, {
                        isSupervisor: event.currentTarget.checked,
                      })
                    }
                    type="checkbox"
                  />
                </td>
                <td>
                  <input
                    aria-label={`員工 ${index + 1} 老手`}
                    checked={employee.isVeteran}
                    onChange={(event) =>
                      onUpdateEmployee(employee.id, {
                        isVeteran: event.currentTarget.checked,
                      })
                    }
                    type="checkbox"
                  />
                </td>
                <td>
                  <input
                    aria-label={`員工 ${index + 1} PT`}
                    checked={employee.isPT}
                    onChange={(event) =>
                      onUpdateEmployee(employee.id, {
                        isPT: event.currentTarget.checked,
                      })
                    }
                    type="checkbox"
                  />
                </td>
                <td>
                  <input
                    aria-label={`員工 ${index + 1} 啟用`}
                    checked={employee.isActive}
                    onChange={(event) =>
                      onUpdateEmployee(employee.id, {
                        isActive: event.currentTarget.checked,
                      })
                    }
                    type="checkbox"
                  />
                </td>
                <td>
                  <select
                    aria-label={`員工 ${index + 1} 前月末班`}
                    onChange={(event) =>
                      onUpdateEmployee(employee.id, {
                        prevMonthLastShift:
                          event.currentTarget.value === ''
                            ? null
                            : (event.currentTarget.value as ShiftType),
                      })
                    }
                    value={employee.prevMonthLastShift ?? ''}
                  >
                    {PREV_MONTH_SHIFT_OPTIONS.map((shift) => (
                      <option key={shift || 'none'} value={shift}>
                        {shift || '-'}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <div className="inlineActions">
                    <button
                      aria-label={`員工 ${index + 1} 拖拉排序`}
                      className="dragHandle"
                      draggable
                      onDragEnd={() => setDraggedEmployeeId(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDragStart={() => setDraggedEmployeeId(employee.id)}
                      onDrop={(event) => {
                        event.preventDefault()
                        dropEmployee(employee.id)
                      }}
                      type="button"
                    >
                      ≡
                    </button>
                    <button
                      aria-label={`員工 ${index + 1} 上移`}
                      className="textButton"
                      disabled={index === 0}
                      onClick={() => onMoveEmployee(employee.id, -1)}
                      type="button"
                    >
                      上移
                    </button>
                    <button
                      aria-label={`員工 ${index + 1} 下移`}
                      className="textButton"
                      disabled={index === employees.length - 1}
                      onClick={() => onMoveEmployee(employee.id, 1)}
                      type="button"
                    >
                      下移
                    </button>
                  </div>
                </td>
                <td>
                  <button
                    className="textButton"
                    onClick={() => {
                      if (window.confirm(`確定刪除 ${employee.name}？`)) {
                        onDeleteEmployee(employee.id)
                      }
                    }}
                    type="button"
                  >
                    刪除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RuleWorkspace({
  onMoveRuleSetting,
  onReorderRuleSetting,
  onRestoreDefaults,
  onUpdateRuleSetting,
  ruleSettings,
}: {
  onMoveRuleSetting: (ruleId: RuleSetting['ruleId'], direction: -1 | 1) => void
  onReorderRuleSetting: (
    ruleId: RuleSetting['ruleId'],
    targetRuleId: RuleSetting['ruleId'],
  ) => void
  onRestoreDefaults: () => void
  onUpdateRuleSetting: (
    ruleId: RuleSetting['ruleId'],
    patch: Partial<RuleSetting>,
  ) => void
  ruleSettings: RuleSetting[]
}) {
  const [draggedRuleId, setDraggedRuleId] =
    useState<RuleSetting['ruleId'] | null>(null)
  const settingsByRuleId = new Map(
    ruleSettings.map((setting) => [setting.ruleId, setting]),
  )
  const rules = DEFAULT_RULES.map((rule) => ({
    ...rule,
    priority: settingsByRuleId.get(rule.id)?.priority ?? rule.priority,
    isEnabled: settingsByRuleId.get(rule.id)?.isEnabled ?? true,
  })).sort((left, right) => left.priority - right.priority)

  function dropRule(targetRuleId: RuleSetting['ruleId']) {
    if (draggedRuleId && draggedRuleId !== targetRuleId) {
      onReorderRuleSetting(draggedRuleId, targetRuleId)
    }

    setDraggedRuleId(null)
  }

  return (
    <section aria-labelledby="rule-title" className="workspace">
      <WorkspaceTitle eyebrow="Rules" title="規則設定" titleId="rule-title" />
      <div className="toolbar">
        <button onClick={onRestoreDefaults} type="button">
          還原預設順序
        </button>
      </div>
      <div className="scheduleFrame">
        <table>
          <caption>規則清單</caption>
          <thead>
            <tr>
              <th scope="col">Priority</th>
              <th scope="col">規則 ID</th>
              <th scope="col">規則名稱</th>
              <th scope="col">說明</th>
              <th scope="col">順序</th>
              <th scope="col">啟用</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, index) => (
              <tr key={rule.id}>
                <td>{rule.priority}</td>
                <th scope="row">{rule.id}</th>
                <td>{rule.name}</td>
                <td>
                  <details>
                    <summary>{rule.id} 說明</summary>
                    <p>{rule.description}</p>
                  </details>
                </td>
                <td>
                  <div className="inlineActions">
                    <button
                      aria-label={`${rule.id} 拖拉排序`}
                      className="dragHandle"
                      draggable
                      onDragEnd={() => setDraggedRuleId(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDragStart={() => setDraggedRuleId(rule.id)}
                      onDrop={(event) => {
                        event.preventDefault()
                        dropRule(rule.id)
                      }}
                      type="button"
                    >
                      ≡
                    </button>
                    <button
                      aria-label={`${rule.id} 上移`}
                      className="textButton"
                      disabled={index === 0}
                      onClick={() => onMoveRuleSetting(rule.id, -1)}
                      type="button"
                    >
                      上移
                    </button>
                    <button
                      aria-label={`${rule.id} 下移`}
                      className="textButton"
                      disabled={index === rules.length - 1}
                      onClick={() => onMoveRuleSetting(rule.id, 1)}
                      type="button"
                    >
                      下移
                    </button>
                  </div>
                </td>
                <td>
                  <input
                    aria-label={`${rule.id} 啟用`}
                    checked={rule.isEnabled}
                    onChange={(event) =>
                      onUpdateRuleSetting(rule.id, {
                        isEnabled: event.currentTarget.checked,
                      })
                    }
                    type="checkbox"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

interface MonthlyWorkspaceProps {
  activeRules: RuleDefinition[]
  constraints: PersonalConstraint[]
  cycleCarryIn: CycleCarryIn[]
  currentStep: number
  employees: Employee[]
  fourWeekNodes: DateString[]
  generationMessage: string | null
  isGenerating: boolean
  lockedEntries: ScheduleEntry[]
  manualSpecialDays: SpecialDay[]
  month: MonthString
  onGenerate: () => void | Promise<void>
  onMonthChange: (month: MonthString) => void
  onPrevFourWeekDateChange: (date: DateString) => void
  onRegenerate: () => void | Promise<void>
  onScheduleChange: (schedule: MonthlySchedule) => void
  onSetConstraints: (constraints: PersonalConstraint[]) => void
  onSetCycleCarryIn: (cycleCarryIn: CycleCarryIn[]) => void
  onSetCurrentStep: (step: number) => void
  onSetLockedEntries: (entries: ScheduleEntry[]) => void
  onSetManualSpecialDays: (specialDays: SpecialDay[]) => void
  prevFourWeekDate: DateString
  schedule: MonthlySchedule | null
  specialDays: SpecialDay[]
}

function MonthlyWorkspace({
  activeRules,
  constraints,
  cycleCarryIn,
  currentStep,
  employees,
  fourWeekNodes,
  generationMessage,
  isGenerating,
  lockedEntries,
  manualSpecialDays,
  month,
  onGenerate,
  onMonthChange,
  onPrevFourWeekDateChange,
  onRegenerate,
  onScheduleChange,
  onSetConstraints,
  onSetCycleCarryIn,
  onSetCurrentStep,
  onSetLockedEntries,
  onSetManualSpecialDays,
  prevFourWeekDate,
  schedule,
  specialDays,
}: MonthlyWorkspaceProps) {
  return (
    <section aria-labelledby="monthly-schedule-title" className="workspace">
      <WorkspaceTitle
        eyebrow="Monthly Schedule"
        title="月度排班"
        titleId="monthly-schedule-title"
      />

      <ol className="stepper" aria-label="排班步驟">
        {stepTitles.map((title, index) => (
          <li
            aria-current={currentStep === index + 1 ? 'step' : undefined}
            key={title}
          >
            {index + 1}. {title}
          </li>
        ))}
      </ol>

      <div className="workflowPanel">
        <h2>{`Step ${currentStep}：${stepTitles[currentStep - 1]}`}</h2>
        {currentStep === 1 && (
          <StepOne
            cycleCarryIn={cycleCarryIn}
            employees={employees}
            fourWeekNodes={fourWeekNodes}
            month={month}
            onSetCycleCarryIn={onSetCycleCarryIn}
            onMonthChange={onMonthChange}
            onPrevFourWeekDateChange={onPrevFourWeekDateChange}
            prevFourWeekDate={prevFourWeekDate}
          />
        )}
        {currentStep === 2 && (
          <StepTwo
            manualSpecialDays={manualSpecialDays}
            month={month}
            onSetManualSpecialDays={onSetManualSpecialDays}
            specialDays={specialDays}
          />
        )}
        {currentStep === 3 && (
          <StepThree
            constraints={constraints}
            employees={employees}
            lockedEntries={lockedEntries}
            month={month}
            onSetConstraints={onSetConstraints}
            onSetLockedEntries={onSetLockedEntries}
          />
        )}
        {currentStep === 4 && (
          <StepFour
            generationMessage={generationMessage}
            isGenerating={isGenerating}
            onGenerate={onGenerate}
            onViewSchedule={() => onSetCurrentStep(5)}
            relaxedRules={
              generationMessage === PARTIAL_RELAXED_MESSAGE
                ? (schedule?.relaxedRules ?? [])
                : []
            }
          />
        )}
        {currentStep === 5 && schedule && (
          <StepFive
            activeRules={activeRules}
            employees={employees}
            onRegenerate={onRegenerate}
            onScheduleChange={onScheduleChange}
            schedule={schedule}
          />
        )}
      </div>

      <div className="stepActions">
        <button
          disabled={currentStep === 1}
          onClick={() => onSetCurrentStep(Math.max(1, currentStep - 1))}
          type="button"
        >
          上一步
        </button>
        {currentStep < 4 && (
          <button
            onClick={() => onSetCurrentStep(currentStep + 1)}
            type="button"
          >
            下一步
          </button>
        )}
      </div>
    </section>
  )
}

function StepOne({
  cycleCarryIn,
  employees,
  fourWeekNodes,
  month,
  onSetCycleCarryIn,
  onMonthChange,
  onPrevFourWeekDateChange,
  prevFourWeekDate,
}: {
  cycleCarryIn: CycleCarryIn[]
  employees: Employee[]
  fourWeekNodes: DateString[]
  month: MonthString
  onSetCycleCarryIn: (cycleCarryIn: CycleCarryIn[]) => void
  onMonthChange: (month: MonthString) => void
  onPrevFourWeekDateChange: (date: DateString) => void
  prevFourWeekDate: DateString
}) {
  function updateCarryIn(
    employeeId: string,
    field: keyof Pick<CycleCarryIn, 'reiCount' | 'xiuCount'>,
    value: number,
  ) {
    onSetCycleCarryIn(
      cycleCarryIn.map((carryIn) =>
        carryIn.employeeId === employeeId
          ? { ...carryIn, [field]: Math.max(0, value) }
          : carryIn,
      ),
    )
  }

  return (
    <>
      <div className="formGrid">
        <label>
          月份
          <input
            onChange={(event) =>
              onMonthChange(event.currentTarget.value as MonthString)
            }
            type="month"
            value={month}
          />
        </label>
        <label>
          上次四周節點
          <input
            onChange={(event) =>
              onPrevFourWeekDateChange(event.currentTarget.value as DateString)
            }
            type="date"
            value={prevFourWeekDate}
          />
        </label>
        <div className="summaryStrip">
          {fourWeekNodes.map((date) => (
            <span key={date}>{date}</span>
          ))}
        </div>
      </div>
      {requiresCarryIn(month, prevFourWeekDate) && (
        <div className="scheduleFrame setupTable">
          <table>
            <caption>四周結轉</caption>
            <thead>
              <tr>
                <th scope="col">員工</th>
                <th scope="col">上月例假結轉</th>
                <th scope="col">上月休假結轉</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => {
                const carryIn = cycleCarryIn.find(
                  (candidate) => candidate.employeeId === employee.id,
                ) ?? {
                  employeeId: employee.id,
                  reiCount: 0,
                  xiuCount: 0,
                }

                return (
                  <tr key={employee.id}>
                    <th scope="row">{employee.name}</th>
                    <td>
                      <input
                        aria-label={`${employee.name} 上月例假結轉`}
                        min={0}
                        onChange={(event) =>
                          updateCarryIn(
                            employee.id,
                            'reiCount',
                            event.currentTarget.valueAsNumber || 0,
                          )
                        }
                        type="number"
                        value={carryIn.reiCount}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`${employee.name} 上月休假結轉`}
                        min={0}
                        onChange={(event) =>
                          updateCarryIn(
                            employee.id,
                            'xiuCount',
                            event.currentTarget.valueAsNumber || 0,
                          )
                        }
                        type="number"
                        value={carryIn.xiuCount}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function StepTwo({
  manualSpecialDays,
  month,
  onSetManualSpecialDays,
  specialDays,
}: {
  manualSpecialDays: SpecialDay[]
  month: MonthString
  onSetManualSpecialDays: (specialDays: SpecialDay[]) => void
  specialDays: SpecialDay[]
}) {
  return (
    <div className="dayGrid">
      {datesInMonth(month).map((date) => {
        const selectedTypes = manualSpecialDays
          .filter((day) => day.date === date)
          .map((day) => day.type)

        return (
          <div className="daySetup" key={date}>
            <span>{Number(date.slice(-2))}</span>
            {(['假日', '店務', '大清'] as const).map((type) => {
              const isSelected = selectedTypes.includes(type)

              return (
                <button
                  key={type}
                  aria-label={`${date} ${type}`}
                  aria-pressed={isSelected}
                  className={specialDayButtonClassName(type, isSelected)}
                  onClick={() =>
                    onSetManualSpecialDays(
                      toggleSpecialDay(manualSpecialDays, date, type),
                    )
                  }
                  type="button"
                >
                  {type}
                </button>
              )
            })}
          </div>
        )
      })}
      {specialDays.map((day) => (
        <span
          className={`marker ${specialDayTypeClassName(day.type)}`}
          key={`${day.date}-${day.type}`}
        >
          {day.date} {day.type}
        </span>
      ))}
    </div>
  )
}

function StepThree({
  constraints,
  employees,
  lockedEntries,
  month,
  onSetConstraints,
  onSetLockedEntries,
}: {
  constraints: PersonalConstraint[]
  employees: Employee[]
  lockedEntries: ScheduleEntry[]
  month: MonthString
  onSetConstraints: (constraints: PersonalConstraint[]) => void
  onSetLockedEntries: (entries: ScheduleEntry[]) => void
}) {
  function updateForcedDayOff(employeeId: string, date: DateString) {
    onSetLockedEntries(setLockedLeaveEntry(lockedEntries, employeeId, date, ''))
    onSetConstraints(toggleForcedDayOff(constraints, employeeId, month, date))
  }

  function updateLockedLeave(
    employeeId: string,
    date: DateString,
    shift: LockedLeaveShift | '',
  ) {
    onSetLockedEntries(setLockedLeaveEntry(lockedEntries, employeeId, date, shift))

    if (shift !== '') {
      onSetConstraints(removeForcedDayOff(constraints, employeeId, month, date))
    }
  }

  return (
    <div className="scheduleFrame">
      <table>
        <caption>個人限制</caption>
        <thead>
          <tr>
            <th scope="col">員工</th>
            {datesInMonth(month).map((date) => (
              <th key={date} scope="col">
                {Number(date.slice(-2))}
              </th>
            ))}
            <th scope="col">統計</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((employee) => {
            const forcedDaysOff =
              constraints.find(
                (constraint) => constraint.employeeId === employee.id,
                )?.forcedDaysOff ?? []

            return (
              <tr key={employee.id}>
                <th scope="row">{employee.name}</th>
                {datesInMonth(month).map((date) => {
                  const isForced = forcedDaysOff.includes(date)
                  const lockedLeave = lockedLeaveFor(
                    lockedEntries,
                    employee.id,
                    date,
                  )

                  return (
                    <td key={date}>
                      <div className="constraintCell">
                        <button
                          aria-label={`${employee.name} ${date} 指休`}
                          aria-pressed={isForced}
                          className={
                            isForced ? 'dayButton selected' : 'dayButton'
                          }
                          disabled={lockedLeave !== ''}
                          onClick={() => updateForcedDayOff(employee.id, date)}
                          type="button"
                        >
                          指
                        </button>
                        <select
                          aria-label={`${employee.name} ${date} 特公假`}
                          className="compactSelect"
                          onChange={(event) =>
                            updateLockedLeave(
                              employee.id,
                              date,
                              event.currentTarget.value as
                                | LockedLeaveShift
                                | '',
                            )
                          }
                          value={lockedLeave}
                        >
                          {LOCKED_LEAVE_OPTIONS.map((shift) => (
                            <option key={shift || 'none'} value={shift}>
                              {shift || '-'}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                  )
                })}
                <td>
                  {employee.name} 已設定 {forcedDaysOff.length} 天
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function StepFour({
  generationMessage,
  isGenerating,
  onGenerate,
  onViewSchedule,
  relaxedRules,
}: {
  generationMessage: string | null
  isGenerating: boolean
  onGenerate: () => void | Promise<void>
  onViewSchedule: () => void
  relaxedRules: MonthlySchedule['relaxedRules']
}) {
  return (
    <div aria-busy={isGenerating} className="generatePanel">
      <button
        disabled={isGenerating}
        onClick={() => void onGenerate()}
        type="button"
      >
        產生班表
      </button>
      {isGenerating && (
        <div className="loadingIndicator" role="status">
          <span aria-hidden="true" className="spinner" />
          產生中
        </div>
      )}
      {!isGenerating && generationMessage && <p>{generationMessage}</p>}
      {relaxedRules.length > 0 && (
        <>
          <RelaxedRulesSummary relaxedRules={relaxedRules} />
          <button onClick={onViewSchedule} type="button">
            前往查看班表
          </button>
        </>
      )}
    </div>
  )
}

function StepFive({
  activeRules,
  employees,
  onRegenerate,
  onScheduleChange,
  schedule,
}: {
  activeRules: RuleDefinition[]
  employees: Employee[]
  onRegenerate: () => void | Promise<void>
  onScheduleChange: (schedule: MonthlySchedule) => void
  schedule: MonthlySchedule
}) {
  const [violations, setViolations] = useState<RuleViolation[]>([])
  const visibleDates = datesInMonth(schedule.month)
  const invalidCellKeys = buildInvalidCellKeys(violations, employees)
  const dailyStats = visibleDates.map((date) =>
    buildScheduleDailyStats(schedule, employees, date),
  )

  async function exportExcel() {
    const workbook = buildScheduleWorkbook(schedule, employees)
    const blob = await createScheduleWorkbookBlob(workbook)

    downloadBlob(blob, workbook.fileName)
  }

  function validateSchedule() {
    setViolations(
      validateRules(
        {
          employees,
          month: schedule.month,
          prevFourWeekDate: schedule.prevFourWeekDate,
          cycleCarryIn: schedule.cycleCarryIn,
          specialDays: schedule.specialDays,
          constraints: schedule.constraints,
          entries: schedule.entries,
        },
        activeRules,
      ),
    )
  }

  function updateShift(employeeId: string, date: DateString, shift: ShiftType) {
    const updatedEntry = {
      employeeId,
      date,
      shift,
      isAutoRelaxed: false,
      isManualEdit: true,
    } satisfies ScheduleEntry
    const hasExistingEntry = schedule.entries.some(
      (entry) => entry.employeeId === employeeId && entry.date === date,
    )
    const entries = hasExistingEntry
      ? schedule.entries.map((entry) =>
          entry.employeeId === employeeId && entry.date === date
            ? {
                ...entry,
                shift,
                isAutoRelaxed: false,
                isManualEdit: true,
              }
            : entry,
        )
      : [...schedule.entries, updatedEntry]

    setViolations([])
    onScheduleChange({
      ...schedule,
      entries,
    })
  }

  return (
    <>
      <div className="toolbar">
        <button onClick={validateSchedule} type="button">
          驗證
        </button>
        <button onClick={() => void onRegenerate()} type="button">
          重新產生
        </button>
        <button onClick={() => void exportExcel()} type="button">
          匯出 Excel
        </button>
      </div>
      {schedule.relaxedRules.length > 0 && (
        <RelaxedRulesSummary relaxedRules={schedule.relaxedRules} />
      )}
      {violations.length > 0 && (
        <div aria-label="違規清單" className="validationSummary" role="status">
          <ul>
            {violations.map((violation) => (
              <li key={`${violation.ruleId}-${violation.dates.join('-')}`}>
                {violation.ruleId} {violation.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="scheduleFrame">
        <table aria-label="班表檢視">
          <caption>班表檢視</caption>
          <thead>
            <tr>
              <th rowSpan={3} scope="col">
                員工
              </th>
              <th rowSpan={3} scope="col">
                前一個月
              </th>
              {visibleDates.map((date) => (
                <th className="scheduleMarkerHeader" key={date} scope="col">
                  {scheduleSpecialDayLabel(schedule, date)}
                </th>
              ))}
            </tr>
            <tr>
              {visibleDates.map((date) => (
                <th key={date} scope="col">
                  {Number(date.slice(-2))}
                </th>
              ))}
            </tr>
            <tr>
              {visibleDates.map((date) => (
                <th key={date} scope="col">
                  {weekdayLabel(date)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id}>
                <th scope="row">{employee.name}</th>
                <td>{employee.prevMonthLastShift ?? '-'}</td>
                {visibleDates.map((date) => {
                  const entry = entryFor(schedule, employee.id, date)
                  const isInvalid = invalidCellKeys.has(
                    cellKey(employee.id, date),
                  )

                  return (
                    <td className={cellClassName(entry, isInvalid)} key={date}>
                      <select
                        aria-invalid={isInvalid ? 'true' : undefined}
                        aria-label={`${employee.name} ${date} 班別`}
                        onChange={(event) =>
                          updateShift(
                            employee.id,
                            date,
                            event.currentTarget.value as ShiftType,
                          )
                        }
                        value={entry?.shift ?? ''}
                      >
                        {SHIFT_TYPES.map((shift) => (
                          <option key={shift} value={shift}>
                            {shift}
                          </option>
                        ))}
                      </select>
                    </td>
                  )
                })}
              </tr>
            ))}
            {[
              {
                label: 'F05 班人數',
                values: dailyStats.map((stats) => String(stats.f05Count)),
              },
              {
                label: 'F13 班人數',
                values: dailyStats.map((stats) => String(stats.f13Count)),
              },
              {
                label: 'A 班人數',
                values: dailyStats.map((stats) => String(stats.aCount)),
              },
              {
                label: '上班總人數',
                values: dailyStats.map((stats) => String(stats.workCount)),
              },
              {
                label: '排班結果',
                values: dailyStats.map(
                  (stats) =>
                    `${stats.f05Count}F05 0F01 ${stats.f13Count}F13 ${stats.aCount}A`,
                ),
              },
              {
                label: '需求人力',
                values: dailyStats.map((stats) => stats.demandLabel),
              },
              {
                label: '合格（A/B）',
                values: dailyStats.map((stats) =>
                  stats.isQualified ? 'A' : 'B',
                ),
              },
            ].map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td />
                {row.values.map((value, index) => (
                  <td key={`${row.label}-${visibleDates[index]}`}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function RelaxedRulesSummary({
  relaxedRules,
}: {
  relaxedRules: MonthlySchedule['relaxedRules']
}) {
  return (
    <div aria-label="已放寬規則" className="validationSummary" role="status">
      <h3>已放寬規則</h3>
      <ul>
        {relaxedRules.map((relaxedRule, index) => (
          <li key={`${relaxedRule.ruleId}-${index}`}>
            {relaxedRule.ruleId} {relaxedRule.ruleName}：
            {relaxedRule.affectedDates.length > 0
              ? relaxedRule.affectedDates.join('、')
              : '未提供日期'}
          </li>
        ))}
      </ul>
    </div>
  )
}

function WorkspaceTitle({
  eyebrow,
  title,
  titleId,
}: {
  eyebrow: string
  title: string
  titleId: string
}) {
  return (
    <div className="workspaceHeader">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
      </div>
    </div>
  )
}

function buildInvalidCellKeys(
  violations: RuleViolation[],
  employees: Employee[],
): Set<string> {
  const keys = new Set<string>()
  const visibleEmployeeIds = employees.map((employee) => employee.id)

  for (const violation of violations) {
    const affectedEmployeeIds =
      violation.employeeIds.length > 0
        ? violation.employeeIds
        : visibleEmployeeIds

    for (const employeeId of affectedEmployeeIds) {
      for (const date of violation.dates) {
        keys.add(cellKey(employeeId, date))
      }
    }
  }

  return keys
}

function cellKey(employeeId: string, date: DateString): string {
  return `${employeeId}:${date}`
}

function cellClassName(
  entry: ScheduleEntry | undefined,
  isInvalid: boolean,
): string | undefined {
  const classNames: string[] = []

  if (entry?.isAutoRelaxed) {
    classNames.push('autoRelaxedCell')
  }

  if (entry?.isManualEdit) {
    classNames.push('manualEditCell')
  }

  if (isInvalid) {
    classNames.push('violationCell')
  }

  return classNames.length > 0 ? classNames.join(' ') : undefined
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function yieldToRender(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0)
  })
}

function entryFor(
  schedule: MonthlySchedule,
  employeeId: string,
  date: DateString,
) {
  return schedule.entries.find(
    (entry) => entry.employeeId === employeeId && entry.date === date,
  )
}

interface ScheduleDailyStats {
  aCount: number
  demandLabel: string
  f05Count: number
  f13Count: number
  isQualified: boolean
  workCount: number
}

function buildScheduleDailyStats(
  schedule: MonthlySchedule,
  employees: Employee[],
  date: DateString,
): ScheduleDailyStats {
  const shifts = employees
    .filter((employee) => employee.isActive && !employee.isPT)
    .map((employee) => entryFor(schedule, employee.id, date)?.shift)
  const f05Count = shifts.filter(
    (shift) => shift === 'F05' || shift === '國05',
  ).length
  const f13Count = shifts.filter(
    (shift) => shift === 'F13' || shift === '國13',
  ).length
  const aCount = shifts.filter(
    (shift) => shift === 'A' || shift === '國A',
  ).length
  const workCount = shifts.filter(isScheduleWorkShift).length
  const isHoliday = hasScheduleSpecialDay(schedule, date, '假日')
  const isStoreDay = hasScheduleSpecialDay(schedule, date, '店務')
  const isDeepCleanDay = hasScheduleSpecialDay(schedule, date, '大清')
  const requiredLateCount = isHoliday || isDeepCleanDay ? 5 : 4
  const actualLateCount = isStoreDay ? aCount : f13Count
  const demandLabel = isHoliday
    ? `3國05 5${isStoreDay ? '國A' : '國13'}`
    : isDeepCleanDay
      ? `至少8人`
      : `3F05 4${isStoreDay ? 'A' : 'F13'}`

  return {
    aCount,
    demandLabel,
    f05Count,
    f13Count,
    isQualified: isDeepCleanDay
      ? workCount >= 8
      : f05Count === 3 && actualLateCount === requiredLateCount,
    workCount,
  }
}

function hasScheduleSpecialDay(
  schedule: MonthlySchedule,
  date: DateString,
  type: SpecialDay['type'],
): boolean {
  return schedule.specialDays.some(
    (specialDay) => specialDay.date === date && specialDay.type === type,
  )
}

function scheduleSpecialDayLabel(
  schedule: MonthlySchedule,
  date: DateString,
): string {
  return schedule.specialDays
    .filter((specialDay) => specialDay.date === date)
    .map((specialDay) => specialDay.type)
    .join(' / ')
}

function weekdayLabel(date: DateString): (typeof WEEKDAY_LABELS)[number] {
  return WEEKDAY_LABELS[parseDate(date).getUTCDay()]
}

function isScheduleWorkShift(shift: ShiftType | undefined): boolean {
  return (
    shift === 'F05' ||
    shift === 'F13' ||
    shift === 'A' ||
    shift === '國05' ||
    shift === '國13' ||
    shift === '國A'
  )
}

function generationPreflightError({
  activeRules,
  employees,
  month,
  specialDays,
}: {
  activeRules: RuleDefinition[]
  employees: Employee[]
  month: MonthString
  specialDays: SpecialDay[]
}): string | null {
  const schedulableEmployees = employees.filter(
    (employee) => employee.isActive && !employee.isPT,
  )
  const activeRuleIds = new Set(activeRules.map((rule) => rule.id))

  if (
    (activeRuleIds.has('R03') || activeRuleIds.has('R04')) &&
    schedulableEmployees.filter((employee) => employee.isSupervisor).length < 2
  ) {
    return '主管人數不足，至少需要 2 位啟用主管。'
  }

  const staffingMinimum = requiredStaffingMinimum(
    month,
    specialDays,
    activeRuleIds,
  )

  if (schedulableEmployees.length < staffingMinimum) {
    return `啟用員工數少於每日最低需求（需要至少 ${staffingMinimum} 人）。`
  }

  return null
}

function requiredStaffingMinimum(
  month: MonthString,
  specialDays: SpecialDay[],
  activeRuleIds: Set<RuleDefinition['id']>,
): number {
  const dates = datesInMonth(month)
  const holidayDates = specialDaySet(specialDays, '假日')
  const deepCleanDates = specialDaySet(specialDays, '大清')
  let minimum = 0

  if (
    activeRuleIds.has('R08') &&
    dates.some((date) => !holidayDates.has(date) && !deepCleanDates.has(date))
  ) {
    minimum = Math.max(minimum, 7)
  }

  if (activeRuleIds.has('R10') && dates.some((date) => holidayDates.has(date))) {
    minimum = Math.max(minimum, 8)
  }

  if (
    activeRuleIds.has('R15') &&
    dates.some((date) => deepCleanDates.has(date))
  ) {
    minimum = Math.max(minimum, 8)
  }

  return minimum
}

function specialDaySet(
  specialDays: SpecialDay[],
  type: SpecialDay['type'],
): Set<DateString> {
  return new Set(
    specialDays
      .filter((specialDay) => specialDay.type === type)
      .map((specialDay) => specialDay.date),
  )
}

function normalizeCycleCarryIn(
  cycleCarryIn: CycleCarryIn[],
  employees: Employee[],
): CycleCarryIn[] {
  return employees.map((employee) => {
    const existingCarryIn = cycleCarryIn.find(
      (candidate) => candidate.employeeId === employee.id,
    )

    return (
      existingCarryIn ?? {
        employeeId: employee.id,
        reiCount: 0,
        xiuCount: 0,
      }
    )
  })
}

function moveEmployeeById(
  employees: Employee[],
  employeeId: string,
  direction: -1 | 1,
): Employee[] {
  const currentIndex = employees.findIndex(
    (employee) => employee.id === employeeId,
  )
  const targetIndex = currentIndex + direction

  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= employees.length) {
    return employees
  }

  const nextEmployees = [...employees]
  const [movedEmployee] = nextEmployees.splice(currentIndex, 1)
  nextEmployees.splice(targetIndex, 0, movedEmployee)

  return nextEmployees
}

function moveRuleSettingById(
  ruleSettings: RuleSetting[],
  ruleId: RuleSetting['ruleId'],
  direction: -1 | 1,
): RuleSetting[] {
  const orderedSettings = [...ruleSettings].sort(
    (left, right) => left.priority - right.priority,
  )
  const currentIndex = orderedSettings.findIndex(
    (setting) => setting.ruleId === ruleId,
  )
  const targetIndex = currentIndex + direction

  if (
    currentIndex < 0 ||
    targetIndex < 0 ||
    targetIndex >= orderedSettings.length
  ) {
    return ruleSettings
  }

  const [movedSetting] = orderedSettings.splice(currentIndex, 1)
  orderedSettings.splice(targetIndex, 0, movedSetting)

  return orderedSettings.map((setting, index) => ({
    ...setting,
    priority: index + 1,
  }))
}

function moveItemBefore<T, K>(
  items: T[],
  itemKey: K,
  targetKey: K,
  keyFor: (item: T) => K,
): T[] {
  if (itemKey === targetKey) {
    return items
  }

  const currentIndex = items.findIndex((item) => keyFor(item) === itemKey)
  const targetIndex = items.findIndex((item) => keyFor(item) === targetKey)

  if (currentIndex < 0 || targetIndex < 0) {
    return items
  }

  const reorderedItems = [...items]
  const [movedItem] = reorderedItems.splice(currentIndex, 1)
  const insertionIndex = reorderedItems.findIndex(
    (item) => keyFor(item) === targetKey,
  )

  reorderedItems.splice(insertionIndex, 0, movedItem)

  return reorderedItems
}

function requiresCarryIn(
  month: MonthString,
  prevFourWeekDate: DateString,
): boolean {
  return addDays(parseDate(prevFourWeekDate), 1).getTime() < monthStart(month)
}

function toggleSpecialDay(
  specialDays: SpecialDay[],
  date: DateString,
  type: Exclude<SpecialDay['type'], '四周'>,
): SpecialDay[] {
  const isSelected = specialDays.some(
    (day) => day.date === date && day.type === type,
  )

  if (isSelected) {
    return specialDays.filter(
      (day) => !(day.date === date && day.type === type),
    )
  }

  return [
    ...specialDays.filter(
      (day) =>
        day.date !== date ||
        type === '假日' ||
        (day.type !== '店務' && day.type !== '大清'),
    ),
    { date, type },
  ]
}

function toggleForcedDayOff(
  constraints: PersonalConstraint[],
  employeeId: string,
  month: MonthString,
  date: DateString,
): PersonalConstraint[] {
  const existingConstraint = constraints.find(
    (constraint) => constraint.employeeId === employeeId,
  )
  const existingForcedDays = existingConstraint?.forcedDaysOff ?? []
  const forcedDaysOff = existingForcedDays.includes(date)
    ? existingForcedDays.filter((forcedDate) => forcedDate !== date)
    : [...existingForcedDays, date].sort((left, right) =>
        left.localeCompare(right),
      )
  const remainingConstraints = constraints.filter(
    (constraint) => constraint.employeeId !== employeeId,
  )

  if (forcedDaysOff.length === 0) {
    return remainingConstraints
  }

  return [
    ...remainingConstraints,
    {
      employeeId,
      month,
      forcedDaysOff,
    },
  ]
}

function specialDayButtonClassName(
  type: Exclude<SpecialDay['type'], '四周'>,
  isSelected: boolean,
): string {
  return [
    'dayButton',
    specialDayTypeClassName(type),
    isSelected ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function specialDayTypeClassName(type: SpecialDay['type']): string {
  switch (type) {
    case '假日':
      return 'holidayButton'
    case '店務':
      return 'storeButton'
    case '大清':
      return 'deepCleanButton'
    case '四周':
      return 'fourWeekMarker'
  }
}

function removeForcedDayOff(
  constraints: PersonalConstraint[],
  employeeId: string,
  month: MonthString,
  date: DateString,
): PersonalConstraint[] {
  const existingConstraint = constraints.find(
    (constraint) => constraint.employeeId === employeeId,
  )

  if (!existingConstraint) {
    return constraints
  }

  const forcedDaysOff = existingConstraint.forcedDaysOff.filter(
    (forcedDate) => forcedDate !== date,
  )
  const remainingConstraints = constraints.filter(
    (constraint) => constraint.employeeId !== employeeId,
  )

  if (forcedDaysOff.length === 0) {
    return remainingConstraints
  }

  return [
    ...remainingConstraints,
    {
      employeeId,
      month,
      forcedDaysOff,
    },
  ]
}

function lockedLeaveFor(
  entries: ScheduleEntry[],
  employeeId: string,
  date: DateString,
): LockedLeaveShift | '' {
  const shift = entries.find(
    (entry) => entry.employeeId === employeeId && entry.date === date,
  )?.shift

  return shift === '特' || shift === '公' ? shift : ''
}

function setLockedLeaveEntry(
  entries: ScheduleEntry[],
  employeeId: string,
  date: DateString,
  shift: LockedLeaveShift | '',
): ScheduleEntry[] {
  const remainingEntries = entries.filter(
    (entry) => !(entry.employeeId === employeeId && entry.date === date),
  )

  if (shift === '') {
    return remainingEntries
  }

  return [
    ...remainingEntries,
    {
      employeeId,
      date,
      shift,
      isAutoRelaxed: false,
      isManualEdit: false,
    },
  ]
}

function entriesForMonth(
  entries: ScheduleEntry[],
  month: MonthString,
): ScheduleEntry[] {
  return entries.filter((entry) => entry.date.startsWith(`${month}-`))
}

function datesInMonth(month: MonthString): DateString[] {
  const [year, monthNumber] = month.split('-').map(Number)
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()

  return Array.from({ length: dayCount }, (_, index) => {
    const day = String(index + 1).padStart(2, '0')

    return `${month}-${day}` as DateString
  })
}

function monthStart(month: MonthString): number {
  const [year, monthNumber] = month.split('-').map(Number)

  return Date.UTC(year, monthNumber - 1, 1)
}

function parseDate(date: DateString): Date {
  const [year, month, day] = date.split('-').map(Number)

  return new Date(Date.UTC(year, month - 1, day))
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

export default App
