import { useState, type FormEvent } from 'react'
import type { Store } from '../domain/models'
import { operatorSessionService } from '../services/operatorSessionService'

type OperatorLoginPageProps = {
  networkAvailable: boolean
  notice?: string
  store?: Store
  technicalUserId: string
  onSignedIn: () => Promise<void> | void
}

export function OperatorLoginPage({
  networkAvailable,
  notice,
  store,
  technicalUserId,
  onSignedIn,
}: OperatorLoginPageProps) {
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!networkAvailable) return
    setLoading(true)
    setError(undefined)
    try {
      await operatorSessionService.login(username, pin, technicalUserId)
      setPin('')
      await onSignedIn()
    } catch {
      setPin('')
      setError('Revisa tu usuario y PIN e intenta nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-5 py-10">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-xl sm:p-9">
        <div className="text-center">
          <img
            alt="La Piedad Operaciones"
            className="mx-auto size-24 rounded-full border border-slate-200 object-cover shadow-lg"
            src="/la-piedad-operaciones-ui.png"
          />
          <p className="brand-display mt-4 text-3xl font-bold text-slate-950">La Piedad</p>
          <p className="brand-kicker mt-2">{store?.name ?? 'Operaciones'}</p>
          <h1 className="mt-7 text-2xl font-black text-slate-950">Inicia sesión de operador</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Identifica a la persona que usará esta terminal.
          </p>
        </div>

        {!networkAvailable && (
          <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            Necesitas conexión para iniciar sesión de operador.
          </p>
        )}

        {notice && (
          <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            {notice}
          </p>
        )}

        <form className="mt-7 space-y-5" onSubmit={submit}>
          {error && <p className="alert-error">{error}</p>}
          <label className="field-label">
            Usuario
            <input
              autoCapitalize="none"
              autoComplete="username"
              className="field"
              disabled={!networkAvailable || loading}
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="field-label">
            PIN
            <input
              autoComplete="current-password"
              className="field"
              disabled={!networkAvailable || loading}
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              pattern="[0-9]{6}"
              required
              type="password"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            />
          </label>
          <button
            className="button-primary w-full"
            disabled={!networkAvailable || loading}
            type="submit"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  )
}
