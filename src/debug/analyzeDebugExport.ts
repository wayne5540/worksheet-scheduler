import type { DateString, MonthlySchedule } from '../domain/model'
import {
  DEFAULT_RULES,
  validateRules,
  type RuleDefinition,
  type RuleId,
} from '../domain/rules'
import type { StorageDebugExport } from '../persistence/persistence'

export interface DebugExportAnalysis {
  schemaVersion: StorageDebugExport['schemaVersion']
  exportedAt: string
  employeeSummary: EmployeeSummary
  activeRuleIds: RuleId[]
  schedules: ScheduleAnalysis[]
}

export interface EmployeeSummary {
  total: number
  schedulable: number
  pt: number
  supervisors: number
  veterans: number
}

export interface ScheduleAnalysis {
  month: MonthlySchedule['month']
  entryCount: number
  specialDays: MonthlySchedule['specialDays']
  relaxedRules: MonthlySchedule['relaxedRules']
  violations: RuleViolationSummary[]
}

export interface RuleViolationSummary {
  ruleId: RuleId
  ruleName: string
  dates: DateString[]
  employeeIds: string[]
  employeeNames: string[]
  message: string
}

export function analyzeDebugExport(
  debugExport: StorageDebugExport,
): DebugExportAnalysis {
  const employees = debugExport.localStorage.employees
  const activeRules = activeRulesFromSettings(debugExport)
  const employeeNameById = new Map(
    employees.map((employee) => [employee.id, employee.name]),
  )

  return {
    schemaVersion: debugExport.schemaVersion,
    exportedAt: debugExport.exportedAt,
    employeeSummary: summarizeEmployees(debugExport),
    activeRuleIds: activeRules.map((rule) => rule.id),
    schedules: debugExport.indexedDB.monthlySchedules.map((schedule) => {
      const violations = validateRules(
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
      )

      return {
        month: schedule.month,
        entryCount: schedule.entries.length,
        specialDays: schedule.specialDays,
        relaxedRules: schedule.relaxedRules,
        violations: violations.map((violation) => ({
          ruleId: violation.ruleId,
          ruleName: violation.ruleName,
          dates: violation.dates,
          employeeIds: violation.employeeIds,
          employeeNames: violation.employeeIds.map(
            (employeeId) => employeeNameById.get(employeeId) ?? employeeId,
          ),
          message: violation.message,
        })),
      }
    }),
  }
}

export function formatDebugAnalysisReport(
  analysis: DebugExportAnalysis,
): string {
  const lines = [
    `Debug export: ${analysis.exportedAt}`,
    `Employees: ${analysis.employeeSummary.schedulable} schedulable / ${analysis.employeeSummary.total} total (${analysis.employeeSummary.supervisors} supervisors, ${analysis.employeeSummary.veterans} veterans, ${analysis.employeeSummary.pt} PT)`,
    `Active rules: ${analysis.activeRuleIds.join(', ') || 'none'}`,
  ]

  for (const schedule of analysis.schedules) {
    lines.push('')
    lines.push(
      `${schedule.month}: entries ${schedule.entryCount}, relaxed ${schedule.relaxedRules.length}, violations ${schedule.violations.length}`,
    )

    if (schedule.relaxedRules.length > 0) {
      lines.push('Relaxed rules:')

      for (const relaxedRule of schedule.relaxedRules) {
        lines.push(
          `- ${relaxedRule.ruleId} ${relaxedRule.ruleName}: ${formatDates(relaxedRule.affectedDates)}`,
        )
      }
    }

    if (schedule.violations.length > 0) {
      lines.push('Violations:')

      for (const violation of schedule.violations) {
        const employeeText =
          violation.employeeNames.length > 0
            ? `; employees ${violation.employeeNames.join(', ')}`
            : ''

        lines.push(
          `- ${violation.ruleId} ${violation.ruleName}: ${formatDates(violation.dates)}${employeeText}`,
        )
      }
    }
  }

  return lines.join('\n')
}

function summarizeEmployees({
  localStorage,
}: StorageDebugExport): EmployeeSummary {
  const activeEmployees = localStorage.employees.filter(
    (employee) => employee.isActive,
  )
  const schedulableEmployees = activeEmployees.filter(
    (employee) => !employee.isPT,
  )

  return {
    total: localStorage.employees.length,
    schedulable: schedulableEmployees.length,
    pt: activeEmployees.filter((employee) => employee.isPT).length,
    supervisors: schedulableEmployees.filter(
      (employee) => employee.isSupervisor,
    ).length,
    veterans: schedulableEmployees.filter((employee) => employee.isVeteran)
      .length,
  }
}

function activeRulesFromSettings(
  debugExport: StorageDebugExport,
): RuleDefinition[] {
  return debugExport.localStorage.ruleSettings
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
    .sort((left, right) => left.priority - right.priority)
}

function formatDates(dates: DateString[]): string {
  return dates.length > 0 ? dates.join(', ') : 'none'
}
