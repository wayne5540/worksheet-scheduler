import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App'

describe('App', () => {
  it('renders the default monthly scheduling workspace', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: '門市排班系統' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '月度排班' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByLabelText('月份')).toHaveValue('2026-06')
    expect(
      screen.getByRole('button', { name: '產生班表' }),
    ).toBeDisabled()
  })
})
