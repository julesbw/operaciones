import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AppModal } from '../components/AppModal'
import type { AppAccount, AppAccountRole, Collaborator, Store } from '../domain/models'
import {
  appAccountService,
  assertAppAccountPin,
  type AppAccountInput,
} from '../services/appAccountService'

type ModalMode = 'create' | 'edit'

type AppAccountsSectionProps = {
  canMutate: boolean
  collaborators: Collaborator[]
  stores: Store[]
}

const emptyForm = {
  displayName: '',
  username: '',
  role: 'cashier' as AppAccountRole,
  storeId: '',
  collaboratorId: '',
  pin: '',
  pinConfirmation: '',
}

function roleLabel(role: AppAccountRole): string {
  return role === 'store_manager' ? 'Encargado' : 'Cajero'
}

export function AppAccountsSection({
  canMutate,
  collaborators,
  stores,
}: AppAccountsSectionProps) {
  const activeStores = stores.filter((store) => store.status === 'active')
  const [accounts, setAccounts] = useState<AppAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [modalMode, setModalMode] = useState<ModalMode>()
  const [editingAccount, setEditingAccount] = useState<AppAccount>()
  const [form, setForm] = useState(emptyForm)
  const [resettingAccount, setResettingAccount] = useState<AppAccount>()
  const [resetPin, setResetPin] = useState('')
  const [resetPinConfirmation, setResetPinConfirmation] = useState('')
  const formInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    void appAccountService.list()
      .then((items) => {
        if (active) setAccounts(items)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(cause instanceof Error ? cause.message : 'No fue posible cargar los usuarios.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  function updateForm<Key extends keyof typeof emptyForm>(
    key: Key,
    value: (typeof emptyForm)[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function openCreate() {
    setEditingAccount(undefined)
    setForm({ ...emptyForm, storeId: activeStores[0]?.id ?? '' })
    setError(undefined)
    setModalMode('create')
  }

  function openEdit(account: AppAccount) {
    setEditingAccount(account)
    setForm({
      ...emptyForm,
      displayName: account.displayName,
      username: account.username,
      role: account.role,
      storeId: account.storeId,
      collaboratorId: account.collaboratorId ?? '',
    })
    setError(undefined)
    setModalMode('edit')
  }

  function closeForm() {
    if (saving) return
    setForm(emptyForm)
    setEditingAccount(undefined)
    setModalMode(undefined)
  }

  function toInput(): AppAccountInput {
    return {
      displayName: form.displayName,
      username: form.username,
      role: form.role,
      storeId: form.storeId,
      collaboratorId: form.collaboratorId || null,
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(undefined)
    try {
      let account: AppAccount
      if (modalMode === 'create') {
        assertAppAccountPin(form.pin)
        if (form.pin !== form.pinConfirmation) {
          throw new Error('Los PIN no coinciden.')
        }
        account = await appAccountService.create({ ...toInput(), pin: form.pin })
      } else if (editingAccount) {
        account = await appAccountService.update(editingAccount.id, toInput())
      } else {
        throw new Error('El usuario no es válido.')
      }
      setAccounts((current) =>
        current.some((item) => item.id === account.id)
          ? current.map((item) => item.id === account.id ? account : item)
          : [...current, account],
      )
      setMessage(
        modalMode === 'create'
          ? `${account.displayName} se creó correctamente.`
          : `${account.displayName} se actualizó correctamente.`,
      )
      closeForm()
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'No fue posible guardar el usuario.')
    } finally {
      // Nunca conservar PIN en estado después del envío, sea exitoso o no.
      setForm((current) => ({ ...current, pin: '', pinConfirmation: '' }))
      setSaving(false)
    }
  }

  async function toggleStatus(account: AppAccount) {
    setSaving(true)
    setError(undefined)
    try {
      const updated = await appAccountService.setStatus(account.id, !account.isActive)
      setAccounts((current) => current.map((item) => item.id === updated.id ? updated : item))
      setMessage(
        updated.isActive
          ? `${updated.displayName} se activó correctamente.`
          : `${updated.displayName} se desactivó y sus sesiones se revocaron.`,
      )
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'No fue posible cambiar el estado.')
    } finally {
      setSaving(false)
    }
  }

  async function submitPinReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!resettingAccount) return
    setSaving(true)
    setError(undefined)
    try {
      assertAppAccountPin(resetPin)
      if (resetPin !== resetPinConfirmation) throw new Error('Los PIN no coinciden.')
      await appAccountService.resetPin(resettingAccount.id, resetPin)
      setMessage(`El PIN de ${resettingAccount.displayName} se restableció y sus sesiones se revocaron.`)
      setResettingAccount(undefined)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'No fue posible restablecer el PIN.')
    } finally {
      setResetPin('')
      setResetPinConfirmation('')
      setSaving(false)
    }
  }

  const hasUnsavedChanges = Object.values(form).some((value) => value !== '')

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-950">Usuarios</h2>
          <p className="mt-1 text-sm text-slate-500">
            Identidades operativas con username y PIN. No cambian permisos de la aplicación todavía.
          </p>
        </div>
        <button
          className="button-primary"
          disabled={!canMutate || saving || activeStores.length === 0}
          type="button"
          onClick={openCreate}
        >
          Nuevo usuario
        </button>
      </div>

      {error && <p className="alert-error mt-5" role="alert">{error}</p>}
      {message && <p className="alert-success mt-5">{message}</p>}
      {!canMutate && (
        <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          La administración de usuarios requiere conexión y Supabase configurado.
        </p>
      )}

      <article className="panel mt-5 p-0">
        <div className="divide-y divide-slate-100">
          {loading ? (
            <p className="p-5 text-sm text-slate-500">Cargando usuarios…</p>
          ) : accounts.length === 0 ? (
            <div className="empty-state">
              <p className="font-bold text-slate-700">Aún no hay usuarios operativos</p>
              <p className="mt-1 text-sm text-slate-500">Crea un cajero o encargado para preparar el acceso por PIN.</p>
            </div>
          ) : accounts.map((account) => (
            <div className="flex flex-wrap items-center gap-4 px-5 py-4 sm:px-6" key={account.id}>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-900">{account.displayName}</p>
                <p className="mt-1 text-xs text-slate-500">@{account.username} · {roleLabel(account.role)} · {account.storeName ?? 'Tienda sin identificar'}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${account.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {account.isActive ? 'Activo' : 'Inactivo'}
              </span>
              <div className="flex flex-wrap gap-2">
                <button className="small-button" disabled={!canMutate || saving} type="button" onClick={() => openEdit(account)}>Editar</button>
                <button className="small-button" disabled={!canMutate || saving} type="button" onClick={() => setResettingAccount(account)}>Restablecer PIN</button>
                <button className="small-button" disabled={!canMutate || saving} type="button" onClick={() => void toggleStatus(account)}>
                  {account.isActive ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </article>

      <AppModal
        closeDisabled={saving}
        closeLabel="Cerrar formulario de usuario"
        eyebrow="Administración"
        hasUnsavedChanges={hasUnsavedChanges}
        initialFocusRef={formInputRef}
        open={Boolean(modalMode)}
        title={modalMode === 'edit' ? 'Editar usuario' : 'Nuevo usuario'}
        onClose={closeForm}
      >
        <form onSubmit={save}>
          <div className="mt-6 space-y-4">
            <label className="field-label">Nombre
              <input className="field" maxLength={120} ref={formInputRef} required value={form.displayName} onChange={(event) => updateForm('displayName', event.target.value)} />
            </label>
            <label className="field-label">Username
              <input className="field" autoCapitalize="none" maxLength={60} placeholder="ej. caja1" required value={form.username} onChange={(event) => updateForm('username', event.target.value)} />
              <span className="text-xs font-normal text-slate-500">Sólo letras, números, punto, guion y guion bajo.</span>
            </label>
            <label className="field-label">Rol
              <select className="field" value={form.role} onChange={(event) => updateForm('role', event.target.value as AppAccountRole)}>
                <option value="cashier">Cajero</option>
                <option value="store_manager">Encargado</option>
              </select>
            </label>
            <label className="field-label">Tienda
              <select className="field" required value={form.storeId} onChange={(event) => updateForm('storeId', event.target.value)}>
                {activeStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
            <label className="field-label">Colaborador relacionado (opcional)
              <select className="field" value={form.collaboratorId} onChange={(event) => updateForm('collaboratorId', event.target.value)}>
                <option value="">Sin asociar</option>
                {collaborators.filter((collaborator) => collaborator.storeId === form.storeId).map((collaborator) => (
                  <option key={collaborator.id} value={collaborator.id}>{collaborator.name}</option>
                ))}
              </select>
            </label>
            {modalMode === 'create' && <>
              <label className="field-label">PIN de 6 dígitos
                <input className="field" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" required type="password" value={form.pin} onChange={(event) => updateForm('pin', event.target.value)} />
              </label>
              <label className="field-label">Confirmar PIN
                <input className="field" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" required type="password" value={form.pinConfirmation} onChange={(event) => updateForm('pinConfirmation', event.target.value)} />
              </label>
            </>}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button className="button-secondary" disabled={saving} type="button" onClick={closeForm}>Cancelar</button>
            <button className="button-primary" disabled={!canMutate || saving || activeStores.length === 0} type="submit">{saving ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      </AppModal>

      <AppModal
        closeDisabled={saving}
        closeLabel="Cerrar restablecimiento de PIN"
        eyebrow="Seguridad"
        open={Boolean(resettingAccount)}
        title="Restablecer PIN"
        onClose={() => {
          setResettingAccount(undefined)
          setResetPin('')
          setResetPinConfirmation('')
        }}
      >
        <form onSubmit={submitPinReset}>
          <p className="mt-5 text-sm text-slate-600">El PIN anterior no se puede consultar. Las sesiones operativas activas se revocarán.</p>
          <div className="mt-5 space-y-4">
            <label className="field-label">Nuevo PIN de 6 dígitos
              <input className="field" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" required type="password" value={resetPin} onChange={(event) => setResetPin(event.target.value)} />
            </label>
            <label className="field-label">Confirmar nuevo PIN
              <input className="field" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" required type="password" value={resetPinConfirmation} onChange={(event) => setResetPinConfirmation(event.target.value)} />
            </label>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button className="button-secondary" disabled={saving} type="button" onClick={() => setResettingAccount(undefined)}>Cancelar</button>
            <button className="button-primary" disabled={!canMutate || saving} type="submit">{saving ? 'Restableciendo…' : 'Restablecer'}</button>
          </div>
        </form>
      </AppModal>
    </div>
  )
}
