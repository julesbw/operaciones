import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isNetworkAvailable: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

vi.mock('../repositories/operationsRepository', () => ({
  operationsRepository: {},
}))

vi.mock('./connectivityService', () => ({
  connectivityService: {
    isNetworkAvailable: mocks.isNetworkAvailable,
  },
}))

import { closingAdjustmentService } from './closingAdjustmentService'

describe('ClosingAdjustmentService lock state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isNetworkAvailable.mockReturnValue(false)
  })

  it('does not infer an export lock while offline', async () => {
    await expect(
      closingAdjustmentService.lockState('closing-id'),
    ).resolves.toBeUndefined()
  })
})
