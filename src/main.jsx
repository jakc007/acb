import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import App from './App.jsx'
import './index.css'

const pk = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

const application = pk ? (
  <ClerkProvider publishableKey={pk}>
    <App />
  </ClerkProvider>
) : (
  <App authEnabled={false} />
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {application}
  </React.StrictMode>,
)
