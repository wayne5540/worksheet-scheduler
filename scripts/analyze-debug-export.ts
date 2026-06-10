import { readFile } from 'node:fs/promises'

import {
  analyzeDebugExport,
  formatDebugAnalysisReport,
} from '../src/debug/analyzeDebugExport'
import type { StorageDebugExport } from '../src/persistence/persistence'

const debugExportPath = process.argv[2]

if (!debugExportPath) {
  console.error('Usage: npm run debug:analyze -- <debug-export.json>')
  process.exitCode = 1
} else {
  const rawDebugExport = await readFile(debugExportPath, 'utf8')
  const debugExport = JSON.parse(rawDebugExport) as StorageDebugExport

  console.log(formatDebugAnalysisReport(analyzeDebugExport(debugExport)))
}
