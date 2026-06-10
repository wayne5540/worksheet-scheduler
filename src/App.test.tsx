import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import type { Employee, MonthlySchedule, ShiftType } from './domain/model'
import { IndexedDbScheduleStore } from './persistence/persistence'

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the monthly scheduling stepper with calculated four-week nodes', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: '門市排班系統' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '月度排班' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByLabelText('月份')).toHaveValue('2026-06')
    expect(screen.getByLabelText('上次四周節點')).toHaveValue('2026-05-15')
    expect(screen.getByText('2026-06-12')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled()
  })

  it('walks through the monthly workflow and generates a review table', async () => {
    const user = userEvent.setup()

    render(<App />)

    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(
      screen.getByRole('heading', { name: 'Step 2：特別日標記' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '2026-06-02 假日' }))

    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(
      screen.getByRole('heading', { name: 'Step 3：個人限制輸入' }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: '主管 2026-06-03 指休' }),
    )

    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(
      screen.getByRole('heading', { name: 'Step 4：產生班表' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '產生班表' }))

    expect(
      await screen.findByText('班表已產生，部分規則已放寬'),
    ).toBeInTheDocument()
    expect(screen.getByText('已放寬規則')).toBeInTheDocument()
    expect(screen.getByText(/R15 大清日人力/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '前往查看班表' }))

    expect(
      screen.getByRole('heading', {
        name: 'Step 5：檢視 / 調整 / 匯出',
      }),
    ).toBeInTheDocument()
    const scheduleTable = screen.getByRole('table', { name: '班表檢視' })

    expect(scheduleTable).toBeInTheDocument()
    expect(
      within(scheduleTable).getByRole('columnheader', { name: '30' }),
    ).toBeInTheDocument()
    expect(
      within(scheduleTable).getByRole('columnheader', { name: '假日' }),
    ).toBeInTheDocument()
    expect(
      within(scheduleTable).getAllByRole('columnheader', { name: '二' }).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('F05 班人數')).toBeInTheDocument()
    expect(screen.getByText('F13 班人數')).toBeInTheDocument()
    expect(screen.getByText('A 班人數')).toBeInTheDocument()
    expect(screen.getByText('上班總人數')).toBeInTheDocument()
    expect(screen.getByText('排班結果')).toBeInTheDocument()
    expect(screen.getByText('需求人力')).toBeInTheDocument()
    expect(screen.getByText('合格（A/B）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '匯出 Excel' })).toBeEnabled()
  })

  it('opens employee and rule management workspaces from the main navigation', async () => {
    const user = userEvent.setup()

    render(<App />)

    await user.click(screen.getByRole('tab', { name: '員工管理' }))

    expect(
      screen.getByRole('heading', { name: '員工管理' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新增員工' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '規則設定' }))

    expect(
      screen.getByRole('heading', { name: '規則設定' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '還原預設順序' }),
    ).toBeInTheDocument()
    expect(screen.getByText('R01')).toBeInTheDocument()
    expect(screen.getByText('指定休假日必須排入休假班別。')).toBeInTheDocument()
  })

  it('persists employee edits in localStorage', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)

    await user.click(screen.getByRole('tab', { name: '員工管理' }))
    await user.click(screen.getByRole('button', { name: '新增員工' }))
    await user.clear(screen.getByLabelText('員工 9 姓名'))
    await user.type(screen.getByLabelText('員工 9 姓名'), '新同事')
    await user.click(screen.getByLabelText('員工 9 主管'))

    expect(
      JSON.parse(localStorage.getItem('work-schedule:employees') ?? '[]'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '新同事',
          isSupervisor: true,
        }),
      ]),
    )

    unmount()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: '員工管理' }))

    expect(screen.getByDisplayValue('新同事')).toBeInTheDocument()
    expect(screen.getByLabelText('員工 9 主管')).toBeChecked()
  })

  it('persists rule enabled settings and restores defaults', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)

    await user.click(screen.getByRole('tab', { name: '規則設定' }))
    await user.click(screen.getByLabelText('R15 啟用'))

    expect(
      JSON.parse(localStorage.getItem('work-schedule:rule-settings') ?? '[]'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'R15', isEnabled: false }),
      ]),
    )

    unmount()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: '規則設定' }))

    expect(screen.getByLabelText('R15 啟用')).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: '還原預設順序' }))

    expect(screen.getByLabelText('R15 啟用')).toBeChecked()
  })

  it('reorders employees and rule priorities', async () => {
    const user = userEvent.setup()

    render(<App />)

    await user.click(screen.getByRole('tab', { name: '員工管理' }))
    await user.click(screen.getByRole('button', { name: '員工 2 上移' }))

    expect(screen.getByLabelText('員工 1 姓名')).toHaveValue('老手')

    await user.click(screen.getByRole('tab', { name: '規則設定' }))
    await user.click(screen.getByRole('button', { name: 'R02 上移' }))

    expect(
      JSON.parse(localStorage.getItem('work-schedule:rule-settings') ?? '[]'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'R02', priority: 1 }),
        expect.objectContaining({ ruleId: 'R01', priority: 2 }),
      ]),
    )
  })

  it('persists generated monthly schedules in IndexedDB and reloads the month', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)

    await generateVisibleSchedule(user)

    expect(screen.getByRole('table', { name: '班表檢視' })).toBeInTheDocument()

    unmount()
    render(<App />)

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Step 5：檢視 / 調整 / 匯出' }),
      ).toBeInTheDocument(),
    )
    expect(screen.getByRole('table', { name: '班表檢視' })).toBeInTheDocument()
  })

  it('edits monthly carry-in, special days, and personal constraints', async () => {
    const user = userEvent.setup()

    render(<App />)

    await user.clear(screen.getByLabelText('主管 上月例假結轉'))
    await user.type(screen.getByLabelText('主管 上月例假結轉'), '2')
    await user.clear(screen.getByLabelText('主管 上月休假結轉'))
    await user.type(screen.getByLabelText('主管 上月休假結轉'), '1')

    expect(screen.getByLabelText('主管 上月例假結轉')).toHaveValue(2)
    expect(screen.getByLabelText('主管 上月休假結轉')).toHaveValue(1)

    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(screen.getByRole('button', { name: '2026-06-10 假日' }))
    await user.click(screen.getByRole('button', { name: '2026-06-10 店務' }))
    await user.click(screen.getByRole('button', { name: '2026-06-10 大清' }))

    expect(
      screen.getByRole('button', { name: '2026-06-10 假日' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', { name: '2026-06-10 店務' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.getByRole('button', { name: '2026-06-10 大清' }),
    ).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(
      screen.getByRole('button', { name: '老手 2026-06-05 指休' }),
    )

    expect(
      screen.getByRole('button', { name: '老手 2026-06-05 指休' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('老手 已設定 1 天')).toBeInTheDocument()
  })

  it('loads Step 1 carry-in from a saved previous-month schedule', async () => {
    const store = new IndexedDbScheduleStore()

    await store.saveSchedule(makePreviousMonthSchedule())

    render(<App />)

    await waitFor(() =>
      expect(screen.getByLabelText('主管 上月例假結轉')).toHaveValue(2),
    )
    expect(screen.getByLabelText('主管 上月休假結轉')).toHaveValue(1)
    expect(screen.getByLabelText('老手 上月例假結轉')).toHaveValue(1)
    expect(screen.getByLabelText('老手 上月休假結轉')).toHaveValue(2)
    expect(screen.getByLabelText('一般員工 上月例假結轉')).toHaveValue(0)
    expect(screen.getByLabelText('一般員工 上月休假結轉')).toHaveValue(0)
  })

  it('loads previous-month last shifts from a saved schedule into employees', async () => {
    const user = userEvent.setup()
    const store = new IndexedDbScheduleStore()

    await store.saveSchedule({
      ...makePreviousMonthSchedule(),
      entries: [
        makeEntry('emp-supervisor', '2026-05-31', 'F13'),
        makeEntry('emp-veteran', '2026-05-31', '國A'),
        makeEntry('emp-regular', '2026-05-31', '例'),
      ],
    })

    render(<App />)
    await user.click(screen.getByRole('tab', { name: '員工管理' }))

    await waitFor(() =>
      expect(screen.getByLabelText('員工 1 前月末班')).toHaveValue('F13'),
    )
    expect(screen.getByLabelText('員工 2 前月末班')).toHaveValue('國A')
    expect(screen.getByLabelText('員工 3 前月末班')).toHaveValue('例')
  })

  it('blocks generation when active employees are below staffing minimums', async () => {
    const user = userEvent.setup()

    saveEmployees([
      makeEmployee('sup-a', { isSupervisor: true, isVeteran: true }),
      makeEmployee('sup-b', { isSupervisor: true }),
      makeEmployee('emp-1'),
      makeEmployee('emp-2'),
      makeEmployee('emp-3'),
      makeEmployee('emp-4'),
    ])

    render(<App />)

    await goToGenerateStep(user)
    await user.click(screen.getByRole('button', { name: '產生班表' }))

    expect(
      screen.getByText('啟用員工數少於每日最低需求（需要至少 7 人）。'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Step 4：產生班表' }),
    ).toBeInTheDocument()
  })

  it('blocks generation when fewer than two active supervisors are available', async () => {
    const user = userEvent.setup()

    saveEmployees([
      makeEmployee('sup-a', { isSupervisor: true, isVeteran: true }),
      makeEmployee('vet-a', { isVeteran: true }),
      makeEmployee('vet-b', { isVeteran: true }),
      makeEmployee('emp-1'),
      makeEmployee('emp-2'),
      makeEmployee('emp-3'),
      makeEmployee('emp-4'),
      makeEmployee('emp-5'),
    ])

    render(<App />)

    await goToGenerateStep(user)
    await user.click(screen.getByRole('button', { name: '產生班表' }))

    expect(
      screen.getByText('主管人數不足，至少需要 2 位啟用主管。'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Step 4：產生班表' }),
    ).toBeInTheDocument()
  })

  it('persists manual schedule cell edits in IndexedDB', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)

    await generateVisibleSchedule(user)
    await user.selectOptions(
      screen.getByLabelText('主管 2026-06-01 班別'),
      '例',
    )

    expect(screen.getByLabelText('主管 2026-06-01 班別')).toHaveValue('例')

    unmount()
    render(<App />)

    await waitFor(() =>
      expect(screen.getByLabelText('主管 2026-06-01 班別')).toBeInTheDocument(),
    )
    expect(screen.getByLabelText('主管 2026-06-01 班別')).toHaveValue('例')
  })

  it('validates manual edits and highlights violating schedule cells', async () => {
    const user = userEvent.setup()

    render(<App />)

    await generateVisibleSchedule(user)
    await user.selectOptions(
      screen.getByLabelText('一般員工 2026-06-01 班別'),
      'F05',
    )
    await user.click(screen.getByRole('button', { name: '驗證' }))

    expect(screen.getByLabelText('一般員工 2026-06-01 班別')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByText('R09 晚班隔天不得排早班')).toBeInTheDocument()
  })

  it('regenerates the current schedule and clears manual edits', async () => {
    const user = userEvent.setup()

    render(<App />)

    await generateVisibleSchedule(user)

    const firstShift = screen.getByLabelText(
      '主管 2026-06-01 班別',
    ) as HTMLSelectElement
    const generatedShift = firstShift.value
    const manualShift = generatedShift === '例' ? '休' : '例'

    await user.selectOptions(
      screen.getByLabelText('主管 2026-06-01 班別'),
      manualShift,
    )

    expect(screen.getByLabelText('主管 2026-06-01 班別')).toHaveValue(
      manualShift,
    )

    await user.click(screen.getByRole('button', { name: '重新產生' }))

    await user.click(
      await screen.findByRole('button', { name: '前往查看班表' }),
    )
    await waitFor(() =>
      expect(screen.getByLabelText('主管 2026-06-01 班別')).toHaveValue(
        generatedShift,
      ),
    )
  })

  it('downloads the generated schedule workbook from the export action', async () => {
    const user = userEvent.setup()
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:workbook')
    const revokeObjectUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)
    const clickAnchor = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    render(<App />)

    await generateVisibleSchedule(user)
    await user.click(screen.getByRole('button', { name: '匯出 Excel' }))

    await waitFor(() => expect(createObjectUrl).toHaveBeenCalled())
    const clickedAnchor = clickAnchor.mock.instances[0] as HTMLAnchorElement

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect(clickAnchor).toHaveBeenCalled()
    expect(clickedAnchor.download).toBe('排班_2026年6月.xlsx')
    expect(clickedAnchor.href).toBe('blob:workbook')
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:workbook')
  })
})

async function generateVisibleSchedule(
  user: ReturnType<typeof userEvent.setup>,
) {
  await goToGenerateStep(user)
  await user.click(screen.getByRole('button', { name: '產生班表' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('heading', {
        name: 'Step 5：檢視 / 調整 / 匯出',
      }) ?? screen.queryByRole('button', { name: '前往查看班表' }),
    ).toBeInTheDocument(),
  )

  const reviewButton = screen.queryByRole('button', { name: '前往查看班表' })

  if (reviewButton) {
    await user.click(reviewButton)
  }

  await screen.findByRole('heading', { name: 'Step 5：檢視 / 調整 / 匯出' })
}

async function goToGenerateStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '下一步' }))
  await user.click(screen.getByRole('button', { name: '下一步' }))
  await user.click(screen.getByRole('button', { name: '下一步' }))
}

function saveEmployees(employees: Employee[]) {
  localStorage.setItem('work-schedule:employees', JSON.stringify(employees))
}

function makeEmployee(
  id: string,
  overrides: Partial<Omit<Employee, 'id' | 'name'>> = {},
): Employee {
  return {
    id,
    name: id,
    isSupervisor: false,
    isVeteran: false,
    isPT: false,
    isActive: true,
    prevMonthLastShift: null,
    ...overrides,
  }
}

function makePreviousMonthSchedule(): MonthlySchedule {
  return {
    month: '2026-05',
    prevFourWeekDate: '2026-04-17',
    cycleCarryIn: [],
    specialDays: [],
    constraints: [],
    entries: [
      makeEntry('emp-supervisor', '2026-05-16', '例'),
      makeEntry('emp-supervisor', '2026-05-20', '例'),
      makeEntry('emp-supervisor', '2026-05-21', '休'),
      makeEntry('emp-veteran', '2026-05-18', '例'),
      makeEntry('emp-veteran', '2026-05-19', '休'),
      makeEntry('emp-veteran', '2026-05-31', '休'),
      makeEntry('emp-regular', '2026-05-16', 'F05'),
    ],
    relaxedRules: [],
  }
}

function makeEntry(
  employeeId: string,
  date: MonthlySchedule['entries'][number]['date'],
  shift: ShiftType,
): MonthlySchedule['entries'][number] {
  return {
    employeeId,
    date,
    shift,
    isAutoRelaxed: false,
    isManualEdit: false,
  }
}
