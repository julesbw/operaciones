import type { Collaborator, Store, UserProfile } from '../domain/models'

const DEMO_CREATED_AT = '2026-08-01T12:00:00.000Z'

export const DEMO_STORES: Store[] = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Tienda Centro',
    status: 'active',
    createdAt: DEMO_CREATED_AT,
    updatedAt: DEMO_CREATED_AT,
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    name: 'Tienda Norte',
    status: 'active',
    createdAt: DEMO_CREATED_AT,
    updatedAt: DEMO_CREATED_AT,
  },
]

export const DEMO_COLLABORATORS: Collaborator[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Ana López',
    storeId: DEMO_STORES[0]!.id,
    restDay: 2,
    status: 'active',
    weeklyPay: 2_000,
    createdAt: DEMO_CREATED_AT,
    updatedAt: DEMO_CREATED_AT,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    name: 'Carlos Pérez',
    storeId: DEMO_STORES[0]!.id,
    restDay: 1,
    status: 'active',
    weeklyPay: 1_800,
    createdAt: DEMO_CREATED_AT,
    updatedAt: DEMO_CREATED_AT,
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    name: 'Juan García',
    storeId: DEMO_STORES[0]!.id,
    restDay: 0,
    status: 'active',
    weeklyPay: 1_800,
    createdAt: DEMO_CREATED_AT,
    updatedAt: DEMO_CREATED_AT,
  },
  {
    id: '20000000-0000-4000-8000-000000000004',
    name: 'María Torres',
    storeId: DEMO_STORES[0]!.id,
    restDay: 3,
    status: 'active',
    weeklyPay: 2_200,
    createdAt: DEMO_CREATED_AT,
    updatedAt: DEMO_CREATED_AT,
  },
  {
    id: '20000000-0000-4000-8000-000000000005',
    name: 'Sofía Ramírez',
    storeId: DEMO_STORES[1]!.id,
    restDay: 4,
    status: 'active',
    weeklyPay: 1_900,
    createdAt: DEMO_CREATED_AT,
    updatedAt: DEMO_CREATED_AT,
  },
]

export const DEMO_CASHIER: UserProfile = {
  id: '30000000-0000-4000-8000-000000000001',
  fullName: 'Laura Hernández',
  role: 'cashier',
  storeId: DEMO_STORES[0]!.id,
  storeName: DEMO_STORES[0]!.name,
  demo: true,
}

export const DEMO_ADMIN: UserProfile = {
  id: '30000000-0000-4000-8000-000000000002',
  fullName: 'Julio Briones',
  role: 'admin',
  demo: true,
}
