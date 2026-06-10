import { describe, expect, it } from 'vitest'

import {
  buildFourWeekCycles,
  calculateFourWeekNodes,
  needsCycleCarryIn,
} from './fourWeekCycle'

describe('four-week cycle calculations', () => {
  it('marks every 28-day node that falls inside the selected month', () => {
    expect(calculateFourWeekNodes('2026-06', '2026-05-04')).toEqual([
      '2026-06-01',
      '2026-06-29',
    ])
  })

  it('omits candidate nodes outside the selected month', () => {
    expect(calculateFourWeekNodes('2026-06', '2026-05-15')).toEqual([
      '2026-06-12',
    ])
  })

  it('describes the current-month audit span and carry-in requirement', () => {
    expect(buildFourWeekCycles('2026-06', '2026-05-15')).toEqual([
      {
        nodeDate: '2026-06-12',
        cycleStartDate: '2026-05-16',
        cycleEndDate: '2026-06-12',
        currentMonthStartDate: '2026-06-01',
        currentMonthEndDate: '2026-06-12',
        requiresCarryIn: true,
      },
    ])
  })

  it('does not require carry-in when the first cycle starts on the first day of the month', () => {
    expect(buildFourWeekCycles('2026-06', '2026-05-31')).toEqual([
      {
        nodeDate: '2026-06-28',
        cycleStartDate: '2026-06-01',
        cycleEndDate: '2026-06-28',
        currentMonthStartDate: '2026-06-01',
        currentMonthEndDate: '2026-06-28',
        requiresCarryIn: false,
      },
    ])
    expect(needsCycleCarryIn('2026-06', '2026-05-31')).toBe(false)
  })

  it('resets carry-in after the first node when two nodes fall in one month', () => {
    expect(buildFourWeekCycles('2026-06', '2026-05-04')).toEqual([
      {
        nodeDate: '2026-06-01',
        cycleStartDate: '2026-05-05',
        cycleEndDate: '2026-06-01',
        currentMonthStartDate: '2026-06-01',
        currentMonthEndDate: '2026-06-01',
        requiresCarryIn: true,
      },
      {
        nodeDate: '2026-06-29',
        cycleStartDate: '2026-06-02',
        cycleEndDate: '2026-06-29',
        currentMonthStartDate: '2026-06-02',
        currentMonthEndDate: '2026-06-29',
        requiresCarryIn: false,
      },
    ])
    expect(needsCycleCarryIn('2026-06', '2026-05-04')).toBe(true)
  })
})
