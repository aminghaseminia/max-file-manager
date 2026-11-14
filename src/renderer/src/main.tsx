import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'vazirmatn/Vazirmatn-Variable-font-face.css'
import App from './App'
import { PortalPicker } from './PortalPicker'
import './style.css'

const portal = new URLSearchParams(window.location.search).get('portal') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {portal ? <PortalPicker /> : <App />}
  </StrictMode>
)
