import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from './App'

describe('App', () => {
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
    await user.click(screen.getByRole('button', { name: '6/2 假日' }))

    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(
      screen.getByRole('heading', { name: 'Step 3：個人限制輸入' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '主管 6/3 強制休假' }))

    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(
      screen.getByRole('heading', { name: 'Step 4：產生班表' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '產生班表' }))

    expect(
      screen.getByRole('heading', { name: 'Step 5：檢視 / 調整 / 匯出' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('table', { name: '班表檢視' })).toBeInTheDocument()
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
  })
})
