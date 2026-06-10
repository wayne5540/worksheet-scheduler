import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import 'fake-indexeddb/auto'
import { afterEach, beforeEach } from 'vitest'

beforeEach(() => {
  const freshIndexedDB = new IDBFactory()

  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: freshIndexedDB,
  })
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: freshIndexedDB,
  })
})

afterEach(() => {
  cleanup()
})
