import { useEffect, useMemo, useState } from 'react'

import { calculateFourWeekNodes } from './domain/fourWeekCycle'
import type {
  DateString,
  Employee,
  MonthString,
  MonthlySchedule,
  PersonalConstraint,
  SpecialDay,
  ShiftType,
} from './domain/model'
import { DEFAULT_RULES } from './domain/rules'
import {
  buildScheduleWorkbook,
  createScheduleWorkbookBlob,
} from './export/excel'
import {
  defaultRuleSettings,
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
]

const PREV_MONTH_SHIFT_OPTIONS: (ShiftType | '')[] = [
  '',
  'F05',
  'F13',
  'A',
  '休',
  '例',
  '國',
]

function App() {
  const settingsStore = useMemo(
    () => new LocalStorageSettingsStore(window.localStorage),
    [],
  )
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
  const [manualSpecialDays, setManualSpecialDays] = useState<SpecialDay[]>([])
  const [constraints, setConstraints] = useState<PersonalConstraint[]>([])
  const [schedule, setSchedule] = useState<MonthlySchedule | null>(null)
  const [generationMessage, setGenerationMessage] = useState<string | null>(
    null,
  )

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

  useEffect(() => {
    settingsStore.saveEmployees(employees)
  }, [employees, settingsStore])

  useEffect(() => {
    settingsStore.saveRuleSettings(ruleSettings)
  }, [ruleSettings, settingsStore])

  function generateSchedule() {
    const result = runRelaxedScheduling(
      {
        employees,
        month,
        prevFourWeekDate,
        cycleCarryIn: employees.map((employee) => ({
          employeeId: employee.id,
          reiCount: 0,
          xiuCount: 0,
        })),
        specialDays,
        constraints,
        lockedEntries: [],
        rules: activeRules.filter((rule) => ['R01', 'R09'].includes(rule.id)),
      },
      attemptBacktrackingSchedule,
    )

    if (result.success) {
      setSchedule(result.schedule)
      setGenerationMessage(
        result.schedule.relaxedRules.length === 0
          ? '班表已產生'
          : '班表已產生，部分規則已放寬',
      )
      setCurrentStep(5)
      return
    }

    setGenerationMessage(result.reason)
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
          constraints={constraints}
          currentStep={currentStep}
          employees={employees}
          fourWeekNodes={fourWeekNodes}
          generationMessage={generationMessage}
          manualSpecialDays={manualSpecialDays}
          month={month}
          onGenerate={generateSchedule}
          onMonthChange={setMonth}
          onPrevFourWeekDateChange={setPrevFourWeekDate}
          onSetConstraints={setConstraints}
          onSetCurrentStep={setCurrentStep}
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
  onUpdateEmployee,
}: {
  employees: Employee[]
  onAddEmployee: () => void
  onDeleteEmployee: (employeeId: string) => void
  onUpdateEmployee: (employeeId: string, patch: Partial<Employee>) => void
}) {
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
  onRestoreDefaults,
  onUpdateRuleSetting,
  ruleSettings,
}: {
  onRestoreDefaults: () => void
  onUpdateRuleSetting: (
    ruleId: RuleSetting['ruleId'],
    patch: Partial<RuleSetting>,
  ) => void
  ruleSettings: RuleSetting[]
}) {
  const settingsByRuleId = new Map(
    ruleSettings.map((setting) => [setting.ruleId, setting]),
  )
  const rules = DEFAULT_RULES.map((rule) => ({
    ...rule,
    priority: settingsByRuleId.get(rule.id)?.priority ?? rule.priority,
    isEnabled: settingsByRuleId.get(rule.id)?.isEnabled ?? true,
  })).sort((left, right) => left.priority - right.priority)

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
              <th scope="col">啟用</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td>{rule.priority}</td>
                <th scope="row">{rule.id}</th>
                <td>{rule.name}</td>
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
  constraints: PersonalConstraint[]
  currentStep: number
  employees: Employee[]
  fourWeekNodes: DateString[]
  generationMessage: string | null
  manualSpecialDays: SpecialDay[]
  month: MonthString
  onGenerate: () => void
  onMonthChange: (month: MonthString) => void
  onPrevFourWeekDateChange: (date: DateString) => void
  onSetConstraints: (constraints: PersonalConstraint[]) => void
  onSetCurrentStep: (step: number) => void
  onSetManualSpecialDays: (specialDays: SpecialDay[]) => void
  prevFourWeekDate: DateString
  schedule: MonthlySchedule | null
  specialDays: SpecialDay[]
}

function MonthlyWorkspace({
  constraints,
  currentStep,
  employees,
  fourWeekNodes,
  generationMessage,
  manualSpecialDays,
  month,
  onGenerate,
  onMonthChange,
  onPrevFourWeekDateChange,
  onSetConstraints,
  onSetCurrentStep,
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
            fourWeekNodes={fourWeekNodes}
            month={month}
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
            onSetConstraints={onSetConstraints}
          />
        )}
        {currentStep === 4 && (
          <StepFour
            generationMessage={generationMessage}
            onGenerate={onGenerate}
          />
        )}
        {currentStep === 5 && schedule && (
          <StepFive employees={employees} schedule={schedule} />
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
  fourWeekNodes,
  month,
  onMonthChange,
  onPrevFourWeekDateChange,
  prevFourWeekDate,
}: {
  fourWeekNodes: DateString[]
  month: MonthString
  onMonthChange: (month: MonthString) => void
  onPrevFourWeekDateChange: (date: DateString) => void
  prevFourWeekDate: DateString
}) {
  return (
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
  const holidayDate = `${month}-02` as DateString
  const isHoliday = manualSpecialDays.some(
    (day) => day.date === holidayDate && day.type === '假日',
  )

  return (
    <div className="dayGrid">
      <button
        className={isHoliday ? 'dayButton selected' : 'dayButton'}
        onClick={() =>
          onSetManualSpecialDays(
            isHoliday
              ? manualSpecialDays.filter(
                  (day) => !(day.date === holidayDate && day.type === '假日'),
                )
              : [...manualSpecialDays, { date: holidayDate, type: '假日' }],
          )
        }
        type="button"
      >
        6/2 假日
      </button>
      {specialDays.map((day) => (
        <span className="marker" key={`${day.date}-${day.type}`}>
          {day.date} {day.type}
        </span>
      ))}
    </div>
  )
}

function StepThree({
  constraints,
  employees,
  onSetConstraints,
}: {
  constraints: PersonalConstraint[]
  employees: Employee[]
  onSetConstraints: (constraints: PersonalConstraint[]) => void
}) {
  const date = '2026-06-03' as DateString
  const employee = employees[0] ?? DEFAULT_EMPLOYEES[0]
  const isForced = constraints.some(
    (constraint) =>
      constraint.employeeId === employee.id &&
      constraint.forcedDaysOff.includes(date),
  )

  return (
    <div className="dayGrid">
      <button
        className={isForced ? 'dayButton selected' : 'dayButton'}
        onClick={() =>
          onSetConstraints(
            isForced
              ? []
              : [
                  {
                    employeeId: employee.id,
                    month: '2026-06',
                    forcedDaysOff: [date],
                  },
                ],
          )
        }
        type="button"
      >
        主管 6/3 強制休假
      </button>
      <span className="marker">已設定 {isForced ? 1 : 0} 天</span>
    </div>
  )
}

function StepFour({
  generationMessage,
  onGenerate,
}: {
  generationMessage: string | null
  onGenerate: () => void
}) {
  return (
    <div className="generatePanel">
      <button onClick={onGenerate} type="button">
        產生班表
      </button>
      {generationMessage && <p>{generationMessage}</p>}
    </div>
  )
}

function StepFive({
  employees,
  schedule,
}: {
  employees: Employee[]
  schedule: MonthlySchedule
}) {
  const visibleDates = datesInMonth(schedule.month).slice(0, 5)

  async function exportExcel() {
    const workbook = buildScheduleWorkbook(schedule, employees)

    await createScheduleWorkbookBlob(workbook)
  }

  return (
    <>
      <div className="toolbar">
        <button type="button">驗證</button>
        <button type="button">重新產生</button>
        <button onClick={() => void exportExcel()} type="button">
          匯出 Excel
        </button>
      </div>
      <div className="scheduleFrame">
        <table aria-label="班表檢視">
          <caption>班表檢視</caption>
          <thead>
            <tr>
              <th scope="col">員工</th>
              <th scope="col">前一個月</th>
              {visibleDates.map((date) => (
                <th key={date} scope="col">
                  {Number(date.slice(-2))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id}>
                <th scope="row">{employee.name}</th>
                <td>{employee.prevMonthLastShift ?? '-'}</td>
                {visibleDates.map((date) => (
                  <td key={date}>
                    {shiftFor(schedule, employee.id, date) ?? '-'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
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

function shiftFor(
  schedule: MonthlySchedule,
  employeeId: string,
  date: DateString,
) {
  return schedule.entries.find(
    (entry) => entry.employeeId === employeeId && entry.date === date,
  )?.shift
}

function datesInMonth(month: MonthString): DateString[] {
  const [year, monthNumber] = month.split('-').map(Number)
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()

  return Array.from({ length: dayCount }, (_, index) => {
    const day = String(index + 1).padStart(2, '0')

    return `${month}-${day}` as DateString
  })
}

export default App
