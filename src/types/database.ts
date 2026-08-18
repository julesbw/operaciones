import type {
  AttendanceStatus,
  Bills,
  CentralCashBills,
  CentralCashMovementType,
  CentralCashSourceType,
  EntityStatus,
  PaymentMethod,
  PaymentFundingSource,
  StoreStatus,
} from '../domain/models'
import type {
  ExportBatchStatus,
  OperationsExportFile,
} from '../domain/exportContract'

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

export type SupplierRow = {
  id: string
  name: string
  is_active: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export type CollaboratorRow = {
  id: string
  name: string
  store_id: string
  rest_day: number
  pay_cycle_end_weekday: number | null
  status: EntityStatus
  created_at: string
  updated_at: string
}

export type CollaboratorCompensationHistoryRow = {
  id: string
  collaborator_id: string
  weekly_pay: number
  effective_from: string
  recorded_at: string
  recorded_by: string
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

export type PaymentRow = {
  id: string
  collaborator_id: string
  collaborator_name_snapshot: string
  collaborator_store_id_snapshot: string
  pay_cycle_end_weekday_snapshot: number
  business_date: string
  paid_at: string
  paid_by: string
  suggested_amount: number
  paid_amount: number
  funding_source: PaymentFundingSource
  source_store_id: string | null
  notes: string | null
  created_at: string
}

export type PaymentAttendanceItemRow = {
  payment_id: string
  attendance_id: string
  work_date_snapshot: string
  period_start: string
  period_end: string
  weekly_pay_snapshot: number
  daily_pay_snapshot: number
  suggested_allocation: number
  created_at: string
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

export type MerchandiseTransferRow = {
  id: string
  origin_store_id: string
  destination_store_id: string
  ticket_number: string
  amount: number
  business_date: string
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
  version: number
}

export type CashClosingRow = {
  id: string
  store_id: string
  business_date: string
  closing_number: number
  store_name_snapshot: string
  gross_sales: number
  expense_total: number
  cash_expense_total: number
  expenses_total_snapshot: number
  cash_expenses_total_snapshot: number
  outgoing_transfers_total_snapshot: number
  store_cash_payments_total_snapshot: number
  purchases_total_snapshot: number
  cash_purchases_total_snapshot: number
  operational_outflows_total_snapshot: number
  cash_outflows_total_snapshot: number
  other_movements: number
  opening_balance: number
  counted_cash: number
  cash_balance: number
  cash_to_withdraw: number
  expected_cash: number
  difference: number
  bills: Bills
  balance_bills: Bills
  withdraw_bills: Bills
  notes: string | null
  status: 'closed' | 'reopened'
  closed_at: string
  closed_by: string
  created_by: string
  created_at: string
  updated_at: string
}

export type CashClosingExpenseItemRow = {
  cash_closing_id: string
  expense_id: string
  amount_snapshot: number
  concept_snapshot: string
  payment_method_snapshot: PaymentMethod
  created_at: string
}

export type CashClosingTransferItemRow = {
  cash_closing_id: string
  transfer_id: string
  amount_snapshot: number
  ticket_number_snapshot: string
  created_at: string
}

export type CashClosingPaymentItemRow = {
  cash_closing_id: string
  payment_id: string
  amount_snapshot: number
  collaborator_name_snapshot: string
  created_at: string
}

export type CashClosingPurchaseItemRow = {
  cash_closing_id: string
  purchase_id: string
  purchase_payment_id: string
  supplier_id: string
  supplier_name_snapshot: string
  folio_snapshot: string | null
  amount_snapshot: number
  payment_method_snapshot: PaymentMethod
  business_date_snapshot: string
  created_at: string
}

export type CashClosingAdjustmentRow = {
  id: string
  cash_closing_id: string
  type: 'inflow' | 'outflow'
  amount: number
  concept: string
  notes: string | null
  bills: CentralCashBills
  coins_amount: number
  created_by: string
  created_at: string
}

export type CashClosingCandidatesResult = {
  expenses: Array<
    Pick<
      ExpenseRow,
      | 'id'
      | 'store_id'
      | 'business_date'
      | 'amount'
      | 'concept'
      | 'payment_method'
      | 'notes'
      | 'created_by'
      | 'created_at'
      | 'updated_at'
      | 'version'
    >
  >
  transfers: MerchandiseTransferRow[]
  payments: PaymentRow[]
  purchases: Array<{
    purchase: PurchaseRow
    payment: PurchasePaymentRow
  }>
}

export type CentralCashMovementRow = {
  id: string
  movement_type: CentralCashMovementType
  source_type: CentralCashSourceType
  source_id: string
  amount: number
  business_date: string
  concept: string
  notes: string | null
  bills_snapshot: CentralCashBills
  coins_amount: number
  store_id_snapshot: string | null
  store_name_snapshot: string | null
  sequence_number_snapshot: number | null
  created_by: string
  created_by_name_snapshot: string
  created_at: string
}

export type PurchaseRow = {
  id: string
  supplier_id: string
  supplier_name_snapshot: string
  business_date: string
  folio: string | null
  amount: number
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export type PurchasePaymentRow = {
  id: string
  purchase_id: string
  amount: number
  funding_source: PaymentFundingSource
  source_store_id: string | null
  payment_method: PaymentMethod
  bills: CentralCashBills | null
  coins_amount: number
  paid_at: string
  created_by: string
  created_at: string
}

export type CentralCashReceiptRow = {
  id: string
  cash_closing_id: string
  movement_id: string
  amount_snapshot: number
  bills_snapshot: CentralCashBills
  coins_amount_snapshot: number
  store_id_snapshot: string
  store_name_snapshot: string
  sequence_number_snapshot: number
  business_date: string
  notes: string | null
  received_by: string
  received_by_name_snapshot: string
  received_at: string
}

export type CentralCashPendingClosingRow = {
  id: string
  store_id: string
  store_name: string
  business_date: string
  sequence_number: number
  cash_to_withdraw: number
  withdraw_bills: Bills
  closed_at: string
}

export type CentralCashSummaryResult = {
  balance: number
  today_inflows: number
  today_outflows: number
  today_net: number
  bills: CentralCashBills
  coins_amount: number
  pending_closings_count: number
  pending_closings_amount: number
}

export type ExportCandidateRow = {
  id: string
  store_id: string
  store_name: string
  business_date: string
  sequence_number: number
  gross_cash: number
  expenses_total: number
  cash_expenses_total: number
  store_cash_payments_total: number
  purchases_total: number
  cash_purchases_total: number
  net_cash: number
  cash_balance: number
  physical_cash_amount: number
  transfers_total: number
  closed_at: string
}

export type ExportBatchRow = {
  id: string
  contract_version: '2.0'
  status: ExportBatchStatus
  payload_snapshot: OperationsExportFile
  created_by: string
  created_at: string
  confirmed_by: string | null
  confirmed_at: string | null
  cancelled_by: string | null
  cancelled_at: string | null
}

export type ExportBatchItemRow = {
  batch_id: string
  source_type: string
  source_id: string
  cash_closing_id: string | null
  reservation_status: 'reserved' | 'confirmed' | 'released'
  created_at: string
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
      suppliers: TableDefinition<
        SupplierRow,
        Pick<SupplierRow, 'id' | 'name'>,
        Partial<Pick<SupplierRow, 'name' | 'is_active'>>
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
      collaborator_compensation_history: TableDefinition<
        CollaboratorCompensationHistoryRow,
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
      collaborator_payments: TableDefinition<PaymentRow, never, never>
      purchases: TableDefinition<PurchaseRow, never, never>
      purchase_payments: TableDefinition<PurchasePaymentRow, never, never>
      payment_attendance_items: TableDefinition<
        PaymentAttendanceItemRow,
        never,
        never
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
      merchandise_transfers: TableDefinition<
        MerchandiseTransferRow,
        Pick<
          MerchandiseTransferRow,
          | 'id'
          | 'origin_store_id'
          | 'destination_store_id'
          | 'ticket_number'
          | 'amount'
          | 'business_date'
          | 'created_by'
          | 'created_at'
          | 'updated_at'
          | 'version'
        > &
          Partial<Pick<MerchandiseTransferRow, 'notes'>>,
        Partial<
          Pick<
            MerchandiseTransferRow,
            | 'destination_store_id'
            | 'ticket_number'
            | 'amount'
            | 'business_date'
            | 'notes'
            | 'updated_at'
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
              | 'closing_number'
          | 'gross_sales'
          | 'expense_total'
          | 'cash_expense_total'
          | 'other_movements'
          | 'opening_balance'
          | 'counted_cash'
          | 'cash_balance'
          | 'cash_to_withdraw'
          | 'expected_cash'
          | 'difference'
          | 'bills'
          | 'balance_bills'
          | 'withdraw_bills'
          | 'closed_at'
          | 'closed_by'
          | 'created_by'
        > &
          Partial<
            Pick<
              CashClosingRow,
              | 'expenses_total_snapshot'
              | 'cash_expenses_total_snapshot'
              | 'outgoing_transfers_total_snapshot'
              | 'store_cash_payments_total_snapshot'
              | 'purchases_total_snapshot'
              | 'cash_purchases_total_snapshot'
              | 'operational_outflows_total_snapshot'
              | 'cash_outflows_total_snapshot'
              | 'store_name_snapshot'
              | 'notes'
              | 'status'
            >
          >,
        Partial<
          Pick<
            CashClosingRow,
            | 'gross_sales'
            | 'expense_total'
            | 'cash_expense_total'
            | 'other_movements'
            | 'opening_balance'
            | 'counted_cash'
            | 'cash_balance'
            | 'cash_to_withdraw'
            | 'expected_cash'
            | 'difference'
            | 'bills'
            | 'balance_bills'
            | 'withdraw_bills'
            | 'notes'
            | 'status'
            | 'closed_at'
            | 'closed_by'
          >
        >
      >
      cash_closing_expense_items: TableDefinition<
        CashClosingExpenseItemRow,
        Pick<
          CashClosingExpenseItemRow,
          | 'cash_closing_id'
          | 'expense_id'
          | 'amount_snapshot'
          | 'concept_snapshot'
          | 'payment_method_snapshot'
        >,
        never
      >
      cash_closing_transfer_items: TableDefinition<
        CashClosingTransferItemRow,
        Pick<
          CashClosingTransferItemRow,
          | 'cash_closing_id'
          | 'transfer_id'
          | 'amount_snapshot'
          | 'ticket_number_snapshot'
        >,
        never
      >
      cash_closing_payment_items: TableDefinition<
        CashClosingPaymentItemRow,
        Pick<
          CashClosingPaymentItemRow,
          | 'cash_closing_id'
          | 'payment_id'
          | 'amount_snapshot'
          | 'collaborator_name_snapshot'
        >,
        never
      >
      central_cash_movements: TableDefinition<
        CentralCashMovementRow,
        never,
        never
      >
      cash_closing_purchase_items: TableDefinition<
        CashClosingPurchaseItemRow,
        never,
        never
      >
      cash_closing_adjustments: TableDefinition<
        CashClosingAdjustmentRow,
        never,
        never
      >
      central_cash_receipts: TableDefinition<
        CentralCashReceiptRow,
        never,
        never
      >
      export_batches: TableDefinition<ExportBatchRow, never, never>
      export_batch_items: TableDefinition<ExportBatchItemRow, never, never>
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
      sync_merchandise_transfer: {
        Args: {
          p_id: string
          p_base_version: number
          p_origin_store_id: string
          p_destination_store_id: string
          p_ticket_number: string
          p_amount: number
          p_business_date: string
          p_notes: string | null
          p_created_at: string
          p_updated_at: string
          p_created_by: string
        }
        Returns: MerchandiseTransferRow
      }
      close_cash_closing: {
        Args: {
          p_id: string
          p_store_id: string
          p_business_date: string
          p_gross_sales: number
          p_bills: Bills
          p_balance_bills: Bills
          p_notes: string | null
          p_expense_ids: string[]
          p_transfer_ids: string[]
          p_payment_ids: string[]
          p_purchase_payment_ids: string[]
        }
        Returns: CashClosingRow
      }
      get_cash_closing_candidates: {
        Args: {
          p_store_id: string
          p_business_date: string
        }
        Returns: CashClosingCandidatesResult
      }
      create_paid_purchase: {
        Args: {
          p_purchase_id: string
          p_payment_id: string
          p_supplier_id: string
          p_business_date: string
          p_folio: string | null
          p_amount: number
          p_notes: string | null
          p_funding_source: PaymentFundingSource
          p_source_store_id: string | null
          p_payment_method: PaymentMethod
          p_bills: CentralCashBills | null
          p_coins_amount: number
          p_created_at: string
        }
        Returns: {
          purchase: PurchaseRow
          payment: PurchasePaymentRow
          movement: CentralCashMovementRow | null
          coin_compensation: CentralCashMovementRow | null
        }
      }
      get_central_cash_summary: {
        Args: Record<never, never>
        Returns: CentralCashSummaryResult
      }
      list_pending_central_cash_closings: {
        Args: {
          p_store_id: string | null
          p_date_from: string | null
          p_date_to: string | null
        }
        Returns: CentralCashPendingClosingRow[]
      }
      receive_cash_closing_into_central_cash: {
        Args: {
          p_receipt_id: string
          p_cash_closing_id: string
          p_notes: string | null
        }
        Returns: {
          receipt: CentralCashReceiptRow
          movement: CentralCashMovementRow
        }
      }
      create_central_cash_adjustment: {
        Args: {
          p_movement_id: string
          p_movement_type: CentralCashMovementType
          p_amount: number
          p_business_date: string
          p_concept: string
          p_notes: string | null
          p_bills: CentralCashBills
          p_coins_amount: number
        }
        Returns: CentralCashMovementRow
      }
      create_cash_closing_adjustment: {
        Args: {
          p_id: string
          p_cash_closing_id: string
          p_type: 'inflow' | 'outflow'
          p_amount: number
          p_concept: string
          p_notes: string | null
          p_bills: CentralCashBills
          p_coins_amount: number
        }
        Returns: CashClosingAdjustmentRow
      }
      get_export_candidates: {
        Args: {
          p_store_id: string | null
          p_date_from: string | null
          p_date_to: string | null
        }
        Returns: ExportCandidateRow[]
      }
      prepare_export_batch: {
        Args: {
          p_batch_id: string
          p_closing_ids: string[]
        }
        Returns: ExportBatchRow
      }
      confirm_export_batch: {
        Args: { p_batch_id: string }
        Returns: ExportBatchRow
      }
      cancel_export_batch: {
        Args: { p_batch_id: string }
        Returns: ExportBatchRow
      }
      create_collaborator: {
        Args: {
          p_id: string
          p_name: string
          p_store_id: string
          p_rest_day: number
          p_weekly_pay: number
          p_pay_cycle_end_weekday: number
        }
        Returns: CollaboratorRow
      }
      update_collaborator: {
        Args: {
          p_id: string
          p_name: string
          p_store_id: string
          p_rest_day: number
          p_weekly_pay: number
          p_pay_cycle_end_weekday: number
        }
        Returns: CollaboratorRow
      }
      set_collaborator_status: {
        Args: {
          p_id: string
          p_status: Extract<EntityStatus, 'active' | 'inactive'>
        }
        Returns: CollaboratorRow
      }
      confirm_collaborator_payment: {
        Args: {
          p_payment_id: string
          p_collaborator_id: string
          p_attendance_ids: string[]
          p_paid_amount: number
          p_funding_source: PaymentFundingSource
          p_source_store_id: string | null
          p_notes: string | null
        }
        Returns: {
          payment: PaymentRow
          items: PaymentAttendanceItemRow[]
        }
      }
      get_payment_module_data: {
        Args: Record<never, never>
        Returns: {
          payments: PaymentRow[]
          items: PaymentAttendanceItemRow[]
          compensation_history: CollaboratorCompensationHistoryRow[]
          attendance: AttendanceRow[]
        }
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
