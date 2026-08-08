import type {
  AttendanceStatus,
  Bills,
  EntityStatus,
  PaymentMethod,
  StoreStatus,
} from '../domain/models'

type TableDefinition<Row, Insert, Update> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export type ProfileRow = {
  id: string
  full_name: string
  role: 'admin' | 'cashier'
  store_id: string | null
  created_at: string
  updated_at: string
}

export type StoreRow = {
  id: string
  name: string
  status: StoreStatus
  created_at: string
  updated_at: string
}

export type CollaboratorRow = {
  id: string
  name: string
  store_id: string
  rest_day: number
  status: EntityStatus
  created_at: string
  updated_at: string
}

export type CollaboratorCompensationRow = {
  collaborator_id: string
  weekly_pay: number
  effective_from: string
  updated_at: string
  updated_by: string
}

export type AttendanceRow = {
  id: string
  collaborator_id: string
  store_id: string
  attendance_date: string
  status: AttendanceStatus
  recorded_by: string
  created_at: string
  updated_at: string
  version: number
}

export type ExpenseRow = {
  id: string
  store_id: string
  business_date: string
  amount: number
  concept: string
  payment_method: PaymentMethod
  notes: string | null
  weekly_payment_id: string | null
  created_by: string
  created_at: string
  updated_at: string
  version: number
}

export type CashClosingRow = {
  id: string
  store_id: string
  business_date: string
  gross_sales: number
  expense_total: number
  other_movements: number
  opening_balance: number
  counted_cash: number
  expected_cash: number
  difference: number
  bills: Bills
  notes: string | null
  status: 'closed' | 'reopened'
  closed_at: string
  closed_by: string
  created_at: string
  updated_at: string
}

export type Database = {
  public: {
    Tables: {
      profiles: TableDefinition<ProfileRow, never, never>
      stores: TableDefinition<
        StoreRow,
        Pick<StoreRow, 'id' | 'name'> & Partial<Pick<StoreRow, 'status'>>,
        Partial<Pick<StoreRow, 'name' | 'status'>>
      >
      collaborators: TableDefinition<
        CollaboratorRow,
        Pick<CollaboratorRow, 'id' | 'name' | 'store_id' | 'rest_day'> &
          Partial<Pick<CollaboratorRow, 'status'>>,
        Partial<Pick<CollaboratorRow, 'name' | 'store_id' | 'rest_day' | 'status'>>
      >
      collaborator_compensation: TableDefinition<
        CollaboratorCompensationRow,
        never,
        never
      >
      attendance_records: TableDefinition<
        AttendanceRow,
        Pick<
          AttendanceRow,
          | 'id'
          | 'collaborator_id'
          | 'store_id'
          | 'attendance_date'
          | 'status'
          | 'recorded_by'
          | 'created_at'
          | 'updated_at'
          | 'version'
        >,
        Partial<Pick<AttendanceRow, 'status' | 'recorded_by' | 'updated_at'>>
      >
      expenses: TableDefinition<
        ExpenseRow,
        Pick<
          ExpenseRow,
          | 'id'
          | 'store_id'
          | 'business_date'
          | 'amount'
          | 'concept'
          | 'payment_method'
          | 'created_by'
          | 'created_at'
          | 'updated_at'
          | 'version'
        > &
          Partial<Pick<ExpenseRow, 'notes' | 'weekly_payment_id'>>,
        Partial<
          Pick<
            ExpenseRow,
            'amount' | 'concept' | 'payment_method' | 'notes' | 'updated_at'
          >
        >
      >
      cash_closings: TableDefinition<
        CashClosingRow,
        Pick<
          CashClosingRow,
          | 'id'
          | 'store_id'
          | 'business_date'
          | 'gross_sales'
          | 'expense_total'
          | 'other_movements'
          | 'opening_balance'
          | 'counted_cash'
          | 'expected_cash'
          | 'difference'
          | 'bills'
          | 'closed_at'
          | 'closed_by'
        > &
          Partial<Pick<CashClosingRow, 'notes' | 'status'>>,
        Partial<
          Pick<
            CashClosingRow,
            | 'gross_sales'
            | 'expense_total'
            | 'other_movements'
            | 'opening_balance'
            | 'counted_cash'
            | 'expected_cash'
            | 'difference'
            | 'bills'
            | 'notes'
            | 'status'
            | 'closed_at'
            | 'closed_by'
          >
        >
      >
    }
    Views: Record<string, never>
    Functions: {
      sync_expense: {
        Args: {
          p_id: string
          p_base_version: number
          p_store_id: string
          p_business_date: string
          p_amount: number
          p_concept: string
          p_payment_method: PaymentMethod
          p_notes: string | null
          p_created_at: string
          p_updated_at: string
          p_created_by: string
        }
        Returns: ExpenseRow
      }
      sync_attendance: {
        Args: {
          p_id: string
          p_base_version: number
          p_collaborator_id: string
          p_store_id: string
          p_attendance_date: string
          p_status: AttendanceStatus
          p_created_at: string
          p_updated_at: string
          p_recorded_by: string
        }
        Returns: AttendanceRow
      }
      create_collaborator: {
        Args: {
          p_id: string
          p_name: string
          p_store_id: string
          p_rest_day: number
          p_weekly_pay: number
        }
        Returns: CollaboratorRow
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
