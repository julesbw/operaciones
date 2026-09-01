import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ToastProvider } from './components/ToastProvider'
import { ThemeProvider } from './theme/ThemeProvider'
import './index.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('No se encontró el elemento raíz de la aplicación')
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.error('No fue posible registrar el modo offline', error)
    })
  })
}
