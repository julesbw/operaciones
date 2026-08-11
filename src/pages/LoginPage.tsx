import { useState, type FormEvent } from 'react'
import type { AppRole, UserProfile } from '../domain/models'
import { isSupabaseConfigured } from '../lib/supabase'
import { authService } from '../services/authService'

type LoginPageProps = {
  notice?: string
  onSignedIn: (profile: UserProfile) => void
}

export function LoginPage({ notice, onSignedIn }: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError(undefined)
    try {
      onSignedIn(await authService.signIn(email, password))
    } catch (cause: unknown) {
      console.error('No fue posible iniciar sesión', cause)
      setError('Revisa tu correo y contraseña e intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  function enterDemo(role: AppRole) {
    onSignedIn(authService.signInDemo(role))
  }

  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="relative z-10 max-w-xl">
          <div className="flex items-center gap-4 text-white">
            <img
              alt="Símbolo de La Piedad Operaciones"
              className="size-24 rounded-full border border-white/25 object-cover shadow-2xl"
              src="/la-piedad-operaciones-ui.png"
            />
            <div>
              <p className="brand-display text-3xl font-bold leading-none">La Piedad</p>
              <p className="mt-2 text-[11px] font-extrabold uppercase tracking-[0.24em] text-[#e8ca83]">
                Operaciones
              </p>
            </div>
          </div>

          <div className="mt-20 lg:mt-32">
            <span className="eyebrow-light">Todo en un solo lugar</span>
            <h1 className="brand-display mt-5 max-w-lg text-4xl font-bold leading-[1.08] tracking-[-0.035em] text-white lg:text-6xl">
              Tu tienda, al día. Sin complicaciones.
            </h1>
            <p className="mt-6 max-w-md text-base leading-7 text-teal-50/80 lg:text-lg">
              Registra gastos y asistencias en segundos, incluso cuando la conexión no coopera.
            </p>
          </div>
        </div>
        <div className="login-orb login-orb-one" />
        <div className="login-orb login-orb-two" />
      </section>

      <section className="flex min-h-dvh items-center justify-center bg-slate-50 px-5 py-10 sm:px-10 lg:px-16">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_70px_rgba(100,21,45,0.08)] sm:p-9">
          <div className="mb-9 flex flex-col items-center text-center lg:hidden">
            <img
              alt="Símbolo de La Piedad Operaciones"
              className="size-28 rounded-full border border-slate-200 object-cover shadow-lg"
              src="/la-piedad-operaciones-ui.png"
            />
            <p className="brand-display mt-4 text-3xl font-bold leading-none text-slate-950">
              La Piedad
            </p>
            <p className="brand-kicker mt-2">Operaciones</p>
          </div>
          <p className="text-sm font-bold text-teal-700">Bienvenido de vuelta</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
            Inicia sesión
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Accede con la cuenta asignada a tu tienda.
          </p>

          {notice && (
            <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              {notice}
            </p>
          )}

          {isSupabaseConfigured ? (
            <form className="mt-8 space-y-5" onSubmit={submit}>
              {error && <p className="alert-error">{error}</p>}
              <label className="field-label">
                Correo electrónico
                <input
                  autoComplete="email"
                  className="field"
                  placeholder="nombre@tienda.com"
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="field-label">
                Contraseña
                <input
                  autoComplete="current-password"
                  className="field"
                  minLength={6}
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button className="button-primary w-full" disabled={loading} type="submit">
                {loading ? 'Entrando…' : 'Entrar a Operaciones'}
              </button>
            </form>
          ) : (
            <div className="mt-8">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-800">
                  Modo demostración
                </p>
                <p className="mt-1.5 text-sm leading-6 text-amber-950/75">
                  Supabase aún no está conectado. Puedes revisar ambos perfiles con datos locales.
                </p>
              </div>
              <div className="mt-5 grid gap-3">
                <button
                  className="button-primary w-full"
                  type="button"
                  onClick={() => enterDemo('cashier')}
                >
                  Entrar como cajera
                </button>
                <button
                  className="button-secondary w-full"
                  type="button"
                  onClick={() => enterDemo('admin')}
                >
                  Entrar como administradora
                </button>
              </div>
            </div>
          )}

          <p className="mt-10 text-center text-xs text-slate-400">
            Los registros operativos se guardan primero en este dispositivo.
          </p>
        </div>
      </section>
    </main>
  )
}
